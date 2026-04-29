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
  if (links.length === 0 && media.length === 0) return { status: "not_required" };

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
  return "Review shared link";
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
