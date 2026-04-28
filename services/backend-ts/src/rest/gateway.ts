import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db/client.js";
import { mediaAssets, messages, messageVersions, outboundIntents } from "../db/schema.js";
import { enqueueKuunaJob } from "../jobs/queues.js";
import { logger } from "../logging.js";

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
          text: event.message.text ?? null,
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
            kind: mediaKindFromMimeType(media.mime_type),
            mimeType: media.mime_type ?? null,
            fileName: media.file_name ?? null,
            byteSize: media.byte_size ?? null,
            status: "pending",
            metadata: {
              download_url: media.download_url ?? null,
            },
          });
        }
      }

      return { messageId: message.id, deduped };
    });

    if (!result.deduped) {
      await enqueueKuunaJob(
        "media_processing",
        { message_id: result.messageId, trace_id: event.trace_id },
        `media:${result.messageId}`,
      );
      await enqueueKuunaJob(
        "inbound_execution",
        {
          message_id: result.messageId,
          provider_group_id: event.provider_group_id,
          trace_id: event.trace_id,
        },
        `inbound:${result.messageId}`,
      );
    }

    logger.info("gateway_inbound_accepted", {
      trace_id: event.trace_id,
      provider_group_id: event.provider_group_id,
      provider_message_id: event.provider_message_id,
      event_type: event.event_type,
      deduped: result.deduped,
    });

    return reply.code(202).send({
      accepted: true,
      trace_id: event.trace_id,
      deduped: result.deduped,
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
        providerMessageId: event.provider_message_id ?? null,
        lastErrorCode: event.error_code ?? null,
        lastErrorMessage: event.error_message ?? null,
        updatedAt: new Date(event.occurred_at),
      })
      .where(eq(outboundIntents.id, intent.id));

    return reply.code(202).send({ accepted: true, found: true });
  });
}
