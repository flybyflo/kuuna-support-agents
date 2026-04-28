import { and, eq } from "drizzle-orm";

import type { DbLike } from "../db/client.js";
import {
  mediaAssets,
  messageLinks,
  messages,
  messageVersions,
  retrievalChunks,
  transcripts,
} from "../db/schema.js";
import { logger } from "../logging.js";
import { chunkMarkdown, createEmbeddings, tokenCount, vectorLiteral } from "./indexing-utils.js";

export async function processRetrievalIndexingJob(
  database: DbLike,
  input: { sourceType: string; sourceId: string; traceId?: string | null },
): Promise<{ indexed: boolean; chunkCount: number }> {
  const sourceType = input.sourceType.trim().toLowerCase();
  if (sourceType === "message") {
    return indexMessage(database, input.sourceId, input.traceId ?? null);
  }
  if (sourceType === "message_link") {
    return indexMessageLink(database, input.sourceId, input.traceId ?? null);
  }
  if (sourceType === "media_asset") {
    return indexMediaAsset(database, input.sourceId, input.traceId ?? null);
  }

  logger.warn("retrieval_indexing_unknown_source_type", {
    source_type: input.sourceType,
    source_id: input.sourceId,
    trace_id: input.traceId,
  });
  return { indexed: false, chunkCount: 0 };
}

async function indexMessage(database: DbLike, messageId: string, traceId: string | null) {
  const [row] = await database
    .select({ message: messages, version: messageVersions })
    .from(messages)
    .innerJoin(
      messageVersions,
      and(
        eq(messageVersions.messageId, messages.id),
        eq(messageVersions.versionNo, messages.latestVersionNo),
      ),
    )
    .where(eq(messages.id, messageId))
    .limit(1);

  if (!row || row.version.isDeleted || !row.version.textContent?.trim()) {
    await deleteSourceChunks(database, "message", messageId);
    return { indexed: false, chunkCount: 0 };
  }

  return replaceSourceChunks(database, {
    scope: "conversation",
    providerGroupId: row.message.providerGroupId,
    sourceType: "message",
    sourceId: row.message.id,
    content: row.version.textContent,
    metadata: {
      trace_id: traceId,
      message_id: row.message.id,
      message_version_id: row.version.id,
      provider_message_id: row.message.providerMessageId,
      sender_provider_user_id: row.message.senderProviderUserId,
      occurred_at: row.version.occurredAt.toISOString(),
    },
  });
}

async function indexMessageLink(database: DbLike, messageLinkId: string, traceId: string | null) {
  const [row] = await database
    .select({ link: messageLinks, message: messages })
    .from(messageLinks)
    .innerJoin(messages, eq(messages.id, messageLinks.messageId))
    .where(eq(messageLinks.id, messageLinkId))
    .limit(1);

  if (!row) {
    await deleteSourceChunks(database, "message_link", messageLinkId);
    return { indexed: false, chunkCount: 0 };
  }

  const content = [row.link.title?.trim(), row.link.normalizedUrl || row.link.url]
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!content) {
    await deleteSourceChunks(database, "message_link", row.link.id);
    return { indexed: false, chunkCount: 0 };
  }

  return replaceSourceChunks(database, {
    scope: "conversation",
    providerGroupId: row.link.providerGroupId,
    sourceType: "message_link",
    sourceId: row.link.id,
    content,
    metadata: {
      trace_id: traceId,
      message_id: row.message.id,
      provider_message_id: row.message.providerMessageId,
      url: row.link.url,
      normalized_url: row.link.normalizedUrl,
      title: row.link.title,
    },
  });
}

async function indexMediaAsset(database: DbLike, mediaAssetId: string, traceId: string | null) {
  const [row] = await database
    .select({ asset: mediaAssets, message: messages, transcript: transcripts })
    .from(mediaAssets)
    .innerJoin(messages, eq(messages.id, mediaAssets.messageId))
    .leftJoin(transcripts, eq(transcripts.mediaAssetId, mediaAssets.id))
    .where(eq(mediaAssets.id, mediaAssetId))
    .limit(1);

  const content = row?.transcript?.textContent?.trim() ?? "";
  if (!row || row.asset.status !== "ready" || row.transcript?.status !== "ready" || !content) {
    await deleteSourceChunks(database, "media_asset", mediaAssetId);
    return { indexed: false, chunkCount: 0 };
  }

  return replaceSourceChunks(database, {
    scope: "conversation",
    providerGroupId: row.message.providerGroupId,
    sourceType: "media_asset",
    sourceId: row.asset.id,
    content,
    metadata: {
      trace_id: traceId,
      message_id: row.message.id,
      provider_message_id: row.message.providerMessageId,
      media_asset_id: row.asset.id,
      mime_type: row.asset.mimeType,
      file_name: row.asset.fileName,
      transcript_id: row.transcript.id,
    },
  });
}

async function replaceSourceChunks(
  database: DbLike,
  input: {
    scope: string;
    providerGroupId: string | null;
    sourceType: string;
    sourceId: string;
    content: string;
    metadata: Record<string, unknown>;
  },
) {
  const chunks = chunkMarkdown(input.content);
  const embeddings = await createEmbeddings(chunks, {
    fallbackLogMessage: "retrieval_embedding_failed_using_pseudo_embeddings",
  });
  await deleteSourceChunks(database, input.sourceType, input.sourceId);

  let chunkCount = 0;
  for (const [index, chunk] of chunks.entries()) {
    const normalizedContent = chunk.trim();
    if (!normalizedContent) {
      continue;
    }
    chunkCount += 1;
    await database.insert(retrievalChunks).values({
      scope: input.scope,
      providerGroupId: input.providerGroupId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      chunkNo: index + 1,
      content: normalizedContent,
      tokenCount: tokenCount(normalizedContent),
      embedding: vectorLiteral(embeddings[index] ?? []),
      metadataJson: { ...input.metadata, indexed_at: new Date().toISOString() },
    });
  }

  return { indexed: chunkCount > 0, chunkCount };
}

async function deleteSourceChunks(database: DbLike, sourceType: string, sourceId: string): Promise<void> {
  await database
    .delete(retrievalChunks)
    .where(and(eq(retrievalChunks.sourceType, sourceType), eq(retrievalChunks.sourceId, sourceId)));
}
