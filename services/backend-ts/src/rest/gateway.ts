import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db/client.js";
import {
  groupBindings,
  mediaAssets,
  messageDecisions,
  messageLinks,
  messages,
  messageVersions,
  outboundIntents,
} from "../db/schema.js";
import { enqueueKuunaJob } from "../jobs/queues.js";
import { logger } from "../logging.js";
import { evaluateTrigger } from "../trigger.js";

const inboundEventSchema = z.object({
  trace_id: z.string().uuid().default(() => randomUUID()),
  provider: z.literal("whatsapp-neonize"),
  provider_group_id: z.string().min(1),
  provider_message_id: z.string().min(1),
  sender_provider_user_id: z.string().nullable().optional(),
  event_type: z.enum(["message_created", "message_edited", "message_deleted"]),
  occurred_at: z.string().datetime({ offset: true }),
  message: z.object({
    text: z.string().nullable().optional(),
    reply_to_provider_message_id: z.string().nullable().optional(),
    mentions: z.array(z.string()).default([]),
    media: z
      .array(
        z.object({
          provider_media_id: z.string().min(1),
          mime_type: z.string().nullable().optional(),
          file_name: z.string().nullable().optional(),
          byte_size: z.number().int().nonnegative().nullable().optional(),
          download_url: z.string().nullable().optional(),
        }),
      )
      .default([]),
  }),
  raw_event: z.record(z.unknown()).nullable().optional(),
});

const outboundStatusSchema = z.object({
  trace_id: z.string().uuid(),
  outbound_intent_id: z.string().uuid(),
  status: z.enum(["sent", "failed", "retrying"]),
  provider_message_id: z.string().nullable().optional(),
  error_code: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  occurred_at: z.string().datetime({ offset: true }),
});

function mediaKindFromMimeType(mimeType: string | null | undefined): string {
  if (!mimeType) return "file";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "file";
}

export function registerGatewayRoutes(app: FastifyInstance): void {
  app.post("/gateway/inbound", async (request, reply) => {
    const event = inboundEventSchema.parse(request.body);
    const occurredAt = new Date(event.occurred_at);
    const triggerDecision = evaluateTrigger(event);

    const result = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.providerGroupId, event.provider_group_id),
            eq(messages.providerMessageId, event.provider_message_id),
          ),
        )
        .limit(1);

      const deduped = Boolean(existing && event.event_type === "message_created");
      const message =
        existing ??
        (
          await tx
            .insert(messages)
            .values({
              providerGroupId: event.provider_group_id,
              providerMessageId: event.provider_message_id,
              senderProviderUserId: event.sender_provider_user_id ?? null,
              latestVersionNo: 1,
            })
            .returning()
        )[0];

      if (!message) {
        throw new Error("failed to persist message");
      }

      if (!deduped) {
        const versionNo = existing ? existing.latestVersionNo + 1 : 1;
        await tx.insert(messageVersions).values({
          messageId: message.id,
          versionNo,
          eventType: event.event_type,
          isDeleted: event.event_type === "message_deleted",
          textContent: event.message.text ?? null,
          rawEvent: event.raw_event ?? {},
          occurredAt,
        });

        await tx
          .update(messages)
          .set({ latestVersionNo: versionNo, updatedAt: new Date() })
          .where(eq(messages.id, message.id));

        for (const media of event.message.media) {
          await tx.insert(mediaAssets).values({
            messageId: message.id,
            providerMediaId: media.provider_media_id,
            mimeType: media.mime_type ?? "application/octet-stream",
            fileName: media.file_name ?? null,
            byteSize: media.byte_size ?? null,
            status: "pending",
            metadataJson: {
              kind: mediaKindFromMimeType(media.mime_type),
              download_url: media.download_url ?? null,
            },
          });
        }

        await tx.insert(messageDecisions).values({
          messageId: message.id,
          providerGroupId: event.provider_group_id,
          decisionType: triggerDecision.triggerType ?? "ignore",
          reason: triggerDecision.reason,
          shouldExecute: triggerDecision.shouldExecute,
          payload: {
            trace_id: event.trace_id,
            provider_message_id: event.provider_message_id,
            event_type: event.event_type,
          },
        });

        for (const url of extractUrls(event.message.text ?? null)) {
          await tx.insert(messageLinks).values({
            messageId: message.id,
            providerGroupId: event.provider_group_id,
            url,
            normalizedUrl: normalizeUrl(url),
            metadataJson: { trace_id: event.trace_id },
          }).onConflictDoNothing();
        }
      }

      const [activeBinding] = await tx
        .select({ id: groupBindings.id })
        .from(groupBindings)
        .where(and(eq(groupBindings.providerGroupId, event.provider_group_id), eq(groupBindings.status, "active")))
        .limit(1);

      return { messageId: message.id, deduped, activeBinding: Boolean(activeBinding) };
    });

    if (!result.deduped) {
      await enqueueKuunaJob(
        "media_processing",
        { message_id: result.messageId, trace_id: event.trace_id },
        `media:${result.messageId}`,
      );
      await enqueueKuunaJob("retrieval_indexing", { source_type: "message", source_id: result.messageId, trace_id: event.trace_id }, `retrieval:message:${result.messageId}`);
      if (event.event_type !== "message_deleted") {
        await enqueueKuunaJob("passive_message_analysis", { message_id: result.messageId, provider_group_id: event.provider_group_id, trace_id: event.trace_id }, `passive:${result.messageId}`);
      }
      if (triggerDecision.shouldExecute && event.event_type !== "message_deleted" && result.activeBinding) {
        await enqueueKuunaJob(
          "inbound_execution",
          {
            message_id: result.messageId,
            provider_group_id: event.provider_group_id,
            reason: triggerDecision.reason,
            trace_id: event.trace_id,
          },
          `inbound:${result.messageId}`,
        );
      }
    }

    logger.info("gateway_inbound_accepted", {
      trace_id: event.trace_id,
      provider_group_id: event.provider_group_id,
      provider_message_id: event.provider_message_id,
      event_type: event.event_type,
      deduped: result.deduped,
      trigger_reason: triggerDecision.reason,
      trigger_type: triggerDecision.triggerType,
    });

    return reply.code(202).send({
      accepted: true,
      trace_id: event.trace_id,
      deduped: result.deduped,
      execution_enqueued:
        !result.deduped &&
        result.activeBinding &&
        event.event_type !== "message_deleted" &&
        triggerDecision.shouldExecute,
    });
  });

  app.post("/gateway/outbound/status", async (request, reply) => {
    const event = outboundStatusSchema.parse(request.body);
    const [intent] = await db
      .select()
      .from(outboundIntents)
      .where(eq(outboundIntents.outboundIntentId, event.outbound_intent_id))
      .limit(1);

    if (!intent) {
      logger.warn("gateway_outbound_intent_not_found", {
        trace_id: event.trace_id,
        outbound_intent_id: event.outbound_intent_id,
        status: event.status,
      });
      return reply.code(202).send({ accepted: true, found: false });
    }

    await db
      .update(outboundIntents)
      .set({
        status: event.status === "retrying" ? "sending" : event.status,
        payload: {
          ...(intent.payload as Record<string, unknown>),
          _dispatch: {
            provider_message_id: event.provider_message_id ?? null,
            last_error_code: event.error_code ?? null,
            last_error_message: event.error_message ?? null,
            last_status: event.status,
            occurred_at: event.occurred_at,
          },
        },
        updatedAt: new Date(event.occurred_at),
      })
      .where(eq(outboundIntents.id, intent.id));

    return reply.code(202).send({ accepted: true, found: true });
  });
}

function extractUrls(text: string | null): string[] {
  if (!text) return [];
  const matches = text.match(/https?:\/\/[^\s<>()]+/gi) ?? [];
  return Array.from(new Set(matches.map((url) => url.replace(/[.,;:!?)]}]+$/, ""))));
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url.trim());
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString();
  } catch {
    return url.trim();
  }
}
