import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { auditEvents, mediaAssets, messageVersions, messages, outboundIntents } from "../../db/schema.js";
import { createTRPCRouter, protectedProcedure } from "../init.js";

export const auditRouter = createTRPCRouter({
  events: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(100) }).default({ limit: 100 }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(auditEvents)
        .orderBy(desc(auditEvents.createdAt))
        .limit(input.limit);
      return rows.map((event) => ({
        id: event.id,
        actor_user_id: event.actorUserId,
        event_type: event.eventType,
        entity_type: event.entityType,
        entity_id: event.entityId,
        payload: event.payload,
        created_at: event.createdAt.toISOString(),
      }));
    }),

  messageTrace: protectedProcedure
    .input(z.object({ providerGroupId: z.string(), providerMessageId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [message] = await ctx.db
        .select()
        .from(messages)
        .where(and(eq(messages.providerGroupId, input.providerGroupId), eq(messages.providerMessageId, input.providerMessageId)))
        .limit(1);

      if (!message) {
        return {
          provider_group_id: input.providerGroupId,
          provider_message_id: input.providerMessageId,
          message_id: null,
          ingest: null,
          versions: [],
          media: [],
          outbound: [],
        };
      }

      const versions = await ctx.db
        .select()
        .from(messageVersions)
        .where(eq(messageVersions.messageId, message.id))
        .orderBy(messageVersions.versionNo);
      const media = await ctx.db.select().from(mediaAssets).where(eq(mediaAssets.messageId, message.id));
      const outbound = await ctx.db
        .select()
        .from(outboundIntents)
        .where(eq(outboundIntents.providerGroupId, input.providerGroupId))
        .orderBy(desc(outboundIntents.createdAt));

      return {
        provider_group_id: input.providerGroupId,
        provider_message_id: input.providerMessageId,
        message_id: message.id,
        ingest: {
          id: message.id,
          provider_group_id: message.providerGroupId,
          provider_message_id: message.providerMessageId,
          latest_version_no: message.latestVersionNo,
          created_at: message.createdAt.toISOString(),
          updated_at: message.updatedAt.toISOString(),
        },
        versions: versions.map((version) => ({
          id: version.id,
          version_no: version.versionNo,
          event_type: version.eventType,
          is_deleted: version.isDeleted,
          text_content: version.textContent,
          occurred_at: version.occurredAt.toISOString(),
        })),
        media: media.map((asset) => ({
          id: asset.id,
          kind: asset.mimeType.startsWith("image/")
            ? "image"
            : asset.mimeType.startsWith("audio/")
              ? "audio"
              : asset.mimeType.startsWith("video/")
                ? "video"
                : "file",
          mime_type: asset.mimeType,
          file_name: asset.fileName,
          status: asset.status,
          s3_key: asset.s3Key,
          metadata_json: asset.metadataJson,
          created_at: asset.createdAt.toISOString(),
          updated_at: asset.updatedAt.toISOString(),
        })),
        outbound: outbound
          .filter((intent) => {
            const payload = intent.payload as Record<string, unknown>;
            return payload.reply_to_provider_message_id === input.providerMessageId;
          })
          .map((intent) => ({
            id: intent.id,
            outbound_intent_id: intent.outboundIntentId,
            provider_group_id: intent.providerGroupId,
            status: intent.status,
            attempt_count: intent.attemptCount,
            payload: intent.payload,
            trace_id: typeof (intent.payload as Record<string, unknown>).trace_id === "string"
              ? (intent.payload as Record<string, unknown>).trace_id
              : null,
            model_path:
              typeof (intent.payload as { metadata?: { model_path?: unknown } }).metadata === "object" &&
              Array.isArray((intent.payload as { metadata?: { model_path?: unknown } }).metadata?.model_path)
                ? (intent.payload as { metadata: { model_path: unknown[] } }).metadata.model_path
                : [],
            retrieval_refs:
              typeof (intent.payload as { metadata?: { retrieval_refs?: unknown } }).metadata === "object" &&
              Array.isArray((intent.payload as { metadata?: { retrieval_refs?: unknown } }).metadata?.retrieval_refs)
                ? (intent.payload as { metadata: { retrieval_refs: unknown[] } }).metadata.retrieval_refs
                : [],
            provider_message_id:
              typeof (intent.payload as Record<string, unknown>)._dispatch === "object" &&
              (intent.payload as { _dispatch?: { provider_message_id?: unknown } })._dispatch
                ? String(
                    (intent.payload as { _dispatch: { provider_message_id?: unknown } })._dispatch
                      .provider_message_id ?? "",
                  ) || null
                : null,
            created_at: intent.createdAt.toISOString(),
            updated_at: intent.updatedAt.toISOString(),
          })),
      };
    }),
});
