import { createHash } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import type { DbLike } from "../db/client.js";
import { mediaAssets, messageLinks, messages, messageVersions, todos } from "../db/schema.js";
import { publishRuntimeEvent } from "../runtime/events.js";

type MessageRow = typeof messages.$inferSelect;
type MessageVersionRow = typeof messageVersions.$inferSelect;
type MediaAssetRow = typeof mediaAssets.$inferSelect;
type MessageLinkRow = typeof messageLinks.$inferSelect;

export type AutomaticFollowupTodoResult =
  | { status: "not_required" }
  | { status: "existing"; todoId: string }
  | { status: "created"; todoId: string };

export async function ensureAutomaticFollowupTodo(
  database: DbLike,
  input: {
    providerGroupId: string;
    messageId: string;
    traceId?: string | null;
  },
): Promise<AutomaticFollowupTodoResult> {
  const [message] = await database
    .select()
    .from(messages)
    .where(and(eq(messages.id, input.messageId), eq(messages.providerGroupId, input.providerGroupId)))
    .limit(1);
  if (!message) return { status: "not_required" };

  const [latest] = await database
    .select()
    .from(messageVersions)
    .where(eq(messageVersions.messageId, input.messageId))
    .orderBy(desc(messageVersions.versionNo))
    .limit(1);
  if (!latest || latest.isDeleted) return { status: "not_required" };

  const [links, media] = await Promise.all([
    database.select().from(messageLinks).where(eq(messageLinks.messageId, input.messageId)),
    database.select().from(mediaAssets).where(eq(mediaAssets.messageId, input.messageId)),
  ]);
  const evidenceText = isEvidenceLikeText(latest.textContent ?? "");
  if (links.length === 0 && media.length === 0 && !evidenceText) return { status: "not_required" };

  const title = automaticTodoTitle(links, media);
  const [existing] = await database
    .select({ id: todos.id })
    .from(todos)
    .where(and(eq(todos.providerGroupId, input.providerGroupId), eq(todos.messageId, input.messageId)))
    .limit(1);
  if (existing) return { status: "existing", todoId: existing.id };

  const [todo] = await database
    .insert(todos)
    .values({
      providerGroupId: input.providerGroupId,
      messageId: input.messageId,
      title,
      description: automaticTodoDescription(message, latest, links, media),
      priority: "normal",
      metadataJson: automaticTodoMetadata(message, latest, links, media, input.traceId ?? null),
    })
    .returning({ id: todos.id, status: todos.status });

  await publishRuntimeEvent({
    type: "todo.updated",
    providerGroupId: input.providerGroupId,
    traceId: input.traceId ?? null,
    entityId: todo?.id ?? null,
    entityType: "todo",
    payload: {
      status: todo?.status ?? "open",
      action: "created",
      message_id: input.messageId,
      source: "automatic_followup",
    },
  });

  return todo ? { status: "created", todoId: todo.id } : { status: "not_required" };
}

export function automaticTodoTitle(links: MessageLinkRow[], media: MediaAssetRow[]): string {
  const hasImages = media.some((asset) => asset.mimeType.startsWith("image/"));
  if (hasImages) return "Review image attachment";
  if (media.length > 0) return "Review media attachment";
  if (links.length > 0) return "Review shared link";
  return "Review evidence text";
}

function automaticTodoDescription(
  message: MessageRow,
  latest: MessageVersionRow,
  links: MessageLinkRow[],
  media: MediaAssetRow[],
): string {
  const lines = [
    `Provider message: ${message.providerMessageId}`,
    `Sender: ${message.senderProviderUserId || "unknown"}`,
    `Occurred at: ${latest.occurredAt.toISOString()}`,
    (latest.textContent || "").trim() ? `Message text: ${(latest.textContent || "").trim()}` : "",
    links.length ? `Links: ${links.map((link) => link.normalizedUrl || link.url).join(", ")}` : "",
    media.length
      ? `Media: ${media.map((asset) => `${asset.fileName || asset.mimeType} | status=${asset.status}`).join("; ")}`
      : "",
  ];
  return lines.filter(Boolean).join("\n");
}

function automaticTodoMetadata(
  message: MessageRow,
  latest: MessageVersionRow,
  links: MessageLinkRow[],
  media: MediaAssetRow[],
  traceId: string | null,
): Record<string, unknown> {
  const rawEvent = objectRecord(latest.rawEvent);
  return {
    source: "automatic_followup",
    trace_id: traceId,
    source_chat: {
      provider_group_id: message.providerGroupId,
      message_id: message.id,
      provider_message_id: message.providerMessageId,
      occurred_at: latest.occurredAt.toISOString(),
    },
    sender: {
      provider_user_id: message.senderProviderUserId,
      display_name: stringValue(rawEvent.sender_push_name ?? rawEvent.push_name),
      phone: phoneFromJid(message.senderProviderUserId ?? ""),
    },
    links: links.map((link) => ({
      id: link.id,
      url: link.url,
      normalized_url: link.normalizedUrl,
      title: link.title,
    })),
    media: media.map((asset) => ({
      id: asset.id,
      provider_media_id: asset.providerMediaId,
      file_name: asset.fileName,
      mime_type: asset.mimeType,
      byte_size: asset.byteSize,
      storage_key: asset.s3Key,
      content_hash: mediaContentHash(asset),
      status: asset.status,
    })),
    text: {
      content_hash: latest.textContent ? sha256Text(latest.textContent) : null,
      evidence_like: isEvidenceLikeText(latest.textContent ?? ""),
    },
  };
}

export function isEvidenceLikeText(value: string): boolean {
  const text = value.toLowerCase();
  if (!text.trim()) return false;
  return [
    "beweis",
    "screenshot",
    "screen shot",
    "hass",
    "beleidigung",
    "drohung",
    "bedrohung",
    "morddrohung",
    "hetze",
    "harassment",
    "hate speech",
    "insult",
    "threat",
    "verleumdung",
  ].some((term) => text.includes(term));
}

function mediaContentHash(asset: MediaAssetRow): string | null {
  const metadata = objectRecord(asset.metadataJson);
  const inlineBase64 = stringValue(metadata.inline_data_base64);
  if (inlineBase64) {
    try {
      return createHash("sha256").update(Buffer.from(inlineBase64, "base64")).digest("hex");
    } catch {
      return sha256Text(inlineBase64);
    }
  }
  return null;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function phoneFromJid(jid: string): string | null {
  const [user, server] = jid.split("@", 2);
  if (server !== "s.whatsapp.net" || !user) return null;
  const digits = user.replace(/[^0-9]/g, "");
  return digits || null;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
