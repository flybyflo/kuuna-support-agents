import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { type AuthContext } from "../../auth.js";
import { type DbLike } from "../../db/client.js";
import {
  auditEvents,
  agentRuns,
  mediaAssets,
  messageDecisions,
  outboundIntents,
  todos,
  toolInvocations,
  transcripts,
} from "../../db/schema.js";
import { createPresignedGetUrl } from "../../integrations/s3.js";
import { publishRuntimeEvent } from "../../runtime/events.js";
import { createTRPCRouter, protectedProcedure } from "../init.js";

const providerGroupInput = z
  .object({
    providerGroupId: z.string().optional(),
    limit: z.number().int().min(1).max(200).default(100),
  })
  .default({ limit: 100 });
const todoStatusInput = z.enum(["open", "in_progress", "done", "cancelled"]);
const todoStatusUpdateInput = z.object({
  todoId: z.string().uuid(),
  status: todoStatusInput,
});

type TodoRow = typeof todos.$inferSelect;
type MediaAssetRow = typeof mediaAssets.$inferSelect;
type TranscriptRow = typeof transcripts.$inferSelect;

function canReadAll(role: string): boolean {
  return role === "owner" || role === "admin";
}

function canWriteTodos(role: string): boolean {
  return role === "owner" || role === "admin" || role === "operator";
}

function canAccessTodo(auth: AuthContext, providerGroupId: string): boolean {
  return canReadAll(auth.role) || auth.groupScope.includes(providerGroupId);
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

async function mapMediaAsset(asset: MediaAssetRow, transcript: TranscriptRow | undefined) {
  const metadata = objectRecord(asset.metadataJson);
  const objectUrl = stringField(metadata, "object_url");
  const downloadUrl =
    objectUrl && asset.s3Key
      ? (await createPresignedGetUrl({ objectKey: asset.s3Key })) ?? objectUrl
      : objectUrl;
  const previewUrl =
    stringField(metadata, "preview_url") ??
    (asset.mimeType.startsWith("image/") ? downloadUrl : null);

  return {
    id: asset.id,
    message_id: asset.messageId,
    provider_media_id: asset.providerMediaId,
    mime_type: asset.mimeType,
    file_name: asset.fileName,
    byte_size: asset.byteSize,
    status: asset.status,
    s3_key: asset.s3Key,
    preview_url: previewUrl,
    download_url: downloadUrl,
    transcript: transcript?.textContent ?? null,
    created_at: asset.createdAt.toISOString(),
    updated_at: asset.updatedAt.toISOString(),
  };
}

type MediaAttachmentRead = Awaited<ReturnType<typeof mapMediaAsset>>;

function mapTodo(todo: TodoRow, attachments: MediaAttachmentRead[] = []) {
  return {
    id: todo.id,
    provider_group_id: todo.providerGroupId,
    message_id: todo.messageId,
    agent_run_id: todo.agentRunId,
    title: todo.title,
    description: todo.description,
    status: todo.status,
    priority: todo.priority,
    due_at: todo.dueAt?.toISOString() ?? null,
    completed_at: todo.completedAt?.toISOString() ?? null,
    exported_at: todo.exportedAt?.toISOString() ?? null,
    export_attempt_count: todo.exportAttemptCount,
    external_ref: todo.externalRef,
    last_export_error: todo.lastExportError,
    attachments,
    created_at: todo.createdAt.toISOString(),
    updated_at: todo.updatedAt.toISOString(),
  };
}

async function loadAttachmentsByMessageId(database: DbLike, rows: TodoRow[]) {
  const messageIds = Array.from(
    new Set(
      rows
        .map((todo) => todo.messageId)
        .filter((messageId): messageId is string => Boolean(messageId)),
    ),
  );
  if (messageIds.length === 0) {
    return new Map<string, MediaAttachmentRead[]>();
  }

  const mediaRows = await database
    .select()
    .from(mediaAssets)
    .where(inArray(mediaAssets.messageId, messageIds))
    .orderBy(desc(mediaAssets.createdAt));
  const transcriptRows =
    mediaRows.length > 0
      ? await database
          .select()
          .from(transcripts)
          .where(
            inArray(
              transcripts.mediaAssetId,
              mediaRows.map((asset) => asset.id),
            ),
          )
      : [];
  const transcriptByMediaId = new Map(transcriptRows.map((row) => [row.mediaAssetId, row]));
  const grouped = new Map<string, MediaAttachmentRead[]>();
  const mappedRows = await Promise.all(
    mediaRows.map(async (asset) => ({
      asset,
      mapped: await mapMediaAsset(asset, transcriptByMediaId.get(asset.id)),
    })),
  );

  for (const { asset, mapped } of mappedRows) {
    const existing = grouped.get(asset.messageId) ?? [];
    existing.push(mapped);
    grouped.set(asset.messageId, existing);
  }

  return grouped;
}

export const agentStateRouter = createTRPCRouter({
  todos: protectedProcedure.input(providerGroupInput).query(async ({ ctx, input }) => {
    if (!ctx.auth) return [];
    const rows = input.providerGroupId
      ? await ctx.db.select().from(todos).where(eq(todos.providerGroupId, input.providerGroupId)).orderBy(desc(todos.updatedAt)).limit(input.limit)
      : canReadAll(ctx.auth.role)
        ? await ctx.db.select().from(todos).orderBy(desc(todos.updatedAt)).limit(input.limit)
        : ctx.auth.groupScope.length > 0
          ? await ctx.db
              .select()
              .from(todos)
              .where(inArray(todos.providerGroupId, ctx.auth.groupScope))
              .orderBy(desc(todos.updatedAt))
              .limit(input.limit)
          : [];

    const groupedAttachments = await loadAttachmentsByMessageId(ctx.db, rows);
    return rows.map((todo) =>
      mapTodo(
        todo,
        todo.messageId ? (groupedAttachments.get(todo.messageId) ?? []) : [],
      ),
    );
  }),

  updateTodoStatus: protectedProcedure
    .input(todoStatusUpdateInput)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.auth) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "missing auth context" });
      }
      if (!canWriteTodos(ctx.auth.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "insufficient role" });
      }

      const [todo] = await ctx.db.select().from(todos).where(eq(todos.id, input.todoId)).limit(1);
      if (!todo) {
        throw new TRPCError({ code: "NOT_FOUND", message: "todo not found" });
      }
      if (!canAccessTodo(ctx.auth, todo.providerGroupId)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "todo outside group scope" });
      }

      const now = new Date();
      const [updated] = await ctx.db
        .update(todos)
        .set({
          status: input.status,
          completedAt: input.status === "done" ? (todo.completedAt ?? now) : null,
          updatedAt: now,
        })
        .where(and(eq(todos.id, input.todoId), eq(todos.providerGroupId, todo.providerGroupId)))
        .returning();
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "todo not found" });
      }

      await ctx.db.insert(auditEvents).values({
        actorUserId: ctx.auth.userId,
        eventType: "todo.status_updated",
        entityType: "todo",
        entityId: updated.id,
        payload: {
          provider_group_id: updated.providerGroupId,
          before: { status: todo.status, completed_at: todo.completedAt?.toISOString() ?? null },
          after: { status: updated.status, completed_at: updated.completedAt?.toISOString() ?? null },
        },
      });
      await publishRuntimeEvent({
        type: "todo.updated",
        providerGroupId: updated.providerGroupId,
        entityId: updated.id,
        entityType: "todo",
        payload: {
          status: updated.status,
          completed_at: updated.completedAt?.toISOString() ?? null,
          updated_by: ctx.auth.userId,
        },
      });

      return mapTodo(updated);
    }),

  agentRuns: protectedProcedure.input(providerGroupInput).query(async ({ ctx, input }) => {
    if (!ctx.auth) return [];
    const rows = input.providerGroupId
      ? await ctx.db.select().from(agentRuns).where(eq(agentRuns.providerGroupId, input.providerGroupId)).orderBy(desc(agentRuns.startedAt)).limit(input.limit)
      : canReadAll(ctx.auth.role)
        ? await ctx.db.select().from(agentRuns).orderBy(desc(agentRuns.startedAt)).limit(input.limit)
        : ctx.auth.groupScope.length > 0
          ? await ctx.db.select().from(agentRuns).where(inArray(agentRuns.providerGroupId, ctx.auth.groupScope)).orderBy(desc(agentRuns.startedAt)).limit(input.limit)
          : [];
    return rows.map((run) => ({
      id: run.id,
      message_id: run.messageId,
      provider_group_id: run.providerGroupId,
      trace_id: run.traceId,
      status: run.status,
      model_path: run.modelPath,
      model_used: run.modelUsed,
      reasoning_effort: run.reasoningEffort,
      allowed_tools: run.allowedTools,
      retrieval_refs: run.retrievalRefs,
      system_prompt: run.systemPrompt,
      user_prompt: run.userPrompt,
      input_context: run.inputContext,
      response_text: run.responseText,
      error: run.error,
      started_at: run.startedAt.toISOString(),
      completed_at: run.completedAt?.toISOString() ?? null,
    }));
  }),

  messageDecisions: protectedProcedure.input(providerGroupInput).query(async ({ ctx, input }) => {
    if (!ctx.auth) return [];
    const rows = input.providerGroupId
      ? await ctx.db.select().from(messageDecisions).where(eq(messageDecisions.providerGroupId, input.providerGroupId)).orderBy(desc(messageDecisions.createdAt)).limit(input.limit)
      : canReadAll(ctx.auth.role)
        ? await ctx.db.select().from(messageDecisions).orderBy(desc(messageDecisions.createdAt)).limit(input.limit)
        : ctx.auth.groupScope.length > 0
          ? await ctx.db.select().from(messageDecisions).where(inArray(messageDecisions.providerGroupId, ctx.auth.groupScope)).orderBy(desc(messageDecisions.createdAt)).limit(input.limit)
          : [];
    return rows.map((decision) => ({
      id: decision.id,
      message_id: decision.messageId,
      provider_group_id: decision.providerGroupId,
      decision_type: decision.decisionType,
      reason: decision.reason,
      should_execute: decision.shouldExecute,
      payload: decision.payload,
      created_at: decision.createdAt.toISOString(),
    }));
  }),

  outboundIntents: protectedProcedure.input(providerGroupInput).query(async ({ ctx, input }) => {
    if (!ctx.auth) return [];
    const rows = input.providerGroupId
      ? await ctx.db
          .select()
          .from(outboundIntents)
          .where(eq(outboundIntents.providerGroupId, input.providerGroupId))
          .orderBy(desc(outboundIntents.createdAt))
          .limit(input.limit)
      : canReadAll(ctx.auth.role)
        ? await ctx.db
            .select()
            .from(outboundIntents)
            .orderBy(desc(outboundIntents.createdAt))
            .limit(input.limit)
        : ctx.auth.groupScope.length > 0
          ? await ctx.db
              .select()
              .from(outboundIntents)
              .where(inArray(outboundIntents.providerGroupId, ctx.auth.groupScope))
              .orderBy(desc(outboundIntents.createdAt))
              .limit(input.limit)
          : [];
    return rows.map((intent) => {
      const payload = objectRecord(intent.payload);
      const metadata = objectRecord(payload.metadata);
      const dispatch = objectRecord(payload._dispatch);
      return {
        id: intent.id,
        outbound_intent_id: intent.outboundIntentId,
        provider_group_id: intent.providerGroupId,
        status: intent.status,
        attempt_count: intent.attemptCount,
        text: stringField(payload, "text") ?? "",
        reply_to_provider_message_id: stringField(payload, "reply_to_provider_message_id"),
        agent_run_id: stringField(metadata, "agent_run_id"),
        agent_instance_id: stringField(metadata, "agent_instance_id"),
        last_error: stringField(dispatch, "last_error"),
        created_at: intent.createdAt.toISOString(),
        updated_at: intent.updatedAt.toISOString(),
      };
    });
  }),

  toolInvocations: protectedProcedure.input(providerGroupInput).query(async ({ ctx, input }) => {
    if (!ctx.auth) return [];
    const rows = input.providerGroupId
      ? await ctx.db.select().from(toolInvocations).where(eq(toolInvocations.providerGroupId, input.providerGroupId)).orderBy(desc(toolInvocations.createdAt)).limit(input.limit)
      : canReadAll(ctx.auth.role)
        ? await ctx.db.select().from(toolInvocations).orderBy(desc(toolInvocations.createdAt)).limit(input.limit)
        : ctx.auth.groupScope.length > 0
          ? await ctx.db.select().from(toolInvocations).where(inArray(toolInvocations.providerGroupId, ctx.auth.groupScope)).orderBy(desc(toolInvocations.createdAt)).limit(input.limit)
          : [];
    return rows.map((invocation) => ({
      id: invocation.id,
      agent_run_id: invocation.agentRunId,
      message_id: invocation.messageId,
      provider_group_id: invocation.providerGroupId,
      tool_name: invocation.toolName,
      ok: invocation.ok,
      stdout: invocation.stdout,
      stderr: invocation.stderr,
      timed_out: invocation.timedOut,
      duration_ms: invocation.durationMs,
      details: invocation.details,
      created_at: invocation.createdAt.toISOString(),
    }));
  }),
});
