import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { agentRuns, messageDecisions, todos, toolInvocations } from "../../db/schema.js";
import { createTRPCRouter, protectedProcedure } from "../init.js";

const providerGroupInput = z.object({ providerGroupId: z.string().optional(), limit: z.number().int().min(1).max(200).default(100) }).default({ limit: 100 });

function canReadAll(role: string): boolean {
  return role === "owner" || role === "admin";
}

export const agentStateRouter = createTRPCRouter({
  todos: protectedProcedure.input(providerGroupInput).query(async ({ ctx, input }) => {
    if (!ctx.auth) return [];
    const rows = input.providerGroupId
      ? await ctx.db.select().from(todos).where(eq(todos.providerGroupId, input.providerGroupId)).orderBy(desc(todos.updatedAt)).limit(input.limit)
      : canReadAll(ctx.auth.role)
        ? await ctx.db.select().from(todos).orderBy(desc(todos.updatedAt)).limit(input.limit)
        : ctx.auth.groupScope.length > 0
          ? await ctx.db.select().from(todos).where(inArray(todos.providerGroupId, ctx.auth.groupScope)).orderBy(desc(todos.updatedAt)).limit(input.limit)
          : [];

    return rows.map((todo) => ({
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
      created_at: todo.createdAt.toISOString(),
      updated_at: todo.updatedAt.toISOString(),
    }));
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
