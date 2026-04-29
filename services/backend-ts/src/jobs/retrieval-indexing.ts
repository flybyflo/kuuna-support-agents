import { and, eq, inArray } from "drizzle-orm";

import type { DbLike } from "../db/client.js";
import {
  mediaAssets,
  groupClientProfiles,
  groupMembers,
  knowledgeClaims,
  knowledgeStatements,
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
    await deleteMessageKnowledge(database, messageId);
    await deleteSourceChunks(database, "message", messageId);
    return { indexed: false, chunkCount: 0 };
  }

  const statementResult = await replaceMessageKnowledge(database, {
    message: row.message,
    version: row.version,
    traceId,
  });
  const rawResult = await replaceSourceChunks(database, {
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
  return {
    indexed: rawResult.indexed || statementResult.indexed,
    chunkCount: rawResult.chunkCount + statementResult.chunkCount,
  };
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
      embeddingVector: vectorLiteral(embeddings[index] ?? []),
      metadataJson: { ...input.metadata, indexed_at: new Date().toISOString() },
    });
  }

  return { indexed: chunkCount > 0, chunkCount };
}

async function replaceMessageKnowledge(
  database: DbLike,
  input: {
    message: typeof messages.$inferSelect;
    version: typeof messageVersions.$inferSelect;
    traceId: string | null;
  },
) {
  await deleteMessageKnowledge(database, input.message.id);
  const context = await statementContext(database, input.message);
  const statementText = input.version.textContent?.trim() ?? "";
  if (!statementText) {
    return { indexed: false, chunkCount: 0 };
  }
  const classification = classifyKnowledgeStatement(statementText, context.speakerRole);
  if (!classification) {
    return { indexed: false, chunkCount: 0 };
  }
  const [statement] = await database
    .insert(knowledgeStatements)
    .values({
      scope: classification.scope,
      providerGroupId: input.message.providerGroupId,
      clientProfileId: classification.scope === "personal" ? context.clientProfileId : null,
      sourceMessageId: input.message.id,
      sourceMessageVersionId: input.version.id,
      providerMessageId: input.message.providerMessageId,
      speakerProviderUserId: input.message.senderProviderUserId,
      speakerRole: context.speakerRole,
      speakerDisplayName: context.speakerDisplayName,
      statementText,
      attributionLabel: attributionLabel(context.speakerRole),
      occurredAt: input.version.occurredAt,
      metadataJson: {
        trace_id: input.traceId,
        source_kind: "original_message",
        knowledge_kind: classification.kind,
        provider_group_id: input.message.providerGroupId,
        client_profile_id: context.clientProfileId,
      },
    })
    .returning();
  if (!statement) {
    return { indexed: false, chunkCount: 0 };
  }

  let chunkCount = await insertRetrievalChunks(database, {
    scope: statement.scope,
    providerGroupId: statement.providerGroupId,
    clientProfileId: statement.clientProfileId,
    sourceType: "knowledge_statement",
    sourceId: statement.id,
    content: attributedContent(statement.attributionLabel, statement.speakerDisplayName, statementText),
    metadata: statementMetadata(statement),
  });

  for (const claimText of extractClaims(statementText, classification.kind)) {
    const [claim] = await database
      .insert(knowledgeClaims)
      .values({
        statementId: statement.id,
        scope: statement.scope,
        providerGroupId: statement.providerGroupId,
        clientProfileId: statement.clientProfileId,
        claimText,
        claimKind: claimKind(claimText, classification.kind),
        attributionLabel: statement.attributionLabel,
        confidence: 100,
        extractionMethod: "sentence_split_v1",
        metadataJson: {
          source_statement_id: statement.id,
          source_message_id: statement.sourceMessageId,
          provider_message_id: statement.providerMessageId,
        },
      })
      .returning();
    if (!claim) continue;
    chunkCount += await insertRetrievalChunks(database, {
      scope: claim.scope,
      providerGroupId: claim.providerGroupId,
      clientProfileId: claim.clientProfileId,
      sourceType: "knowledge_claim",
      sourceId: claim.id,
      content: attributedContent(claim.attributionLabel, statement.speakerDisplayName, claim.claimText),
      metadata: {
        ...statementMetadata(statement),
        knowledge_claim_id: claim.id,
        claim_kind: claim.claimKind,
        extraction_method: claim.extractionMethod,
      },
    });
  }

  return { indexed: chunkCount > 0, chunkCount };
}

async function insertRetrievalChunks(
  database: DbLike,
  input: {
    scope: string;
    providerGroupId: string | null;
    clientProfileId: string | null;
    sourceType: string;
    sourceId: string;
    content: string;
    metadata: Record<string, unknown>;
  },
): Promise<number> {
  const chunks = chunkMarkdown(input.content);
  const embeddings = await createEmbeddings(chunks, {
    fallbackLogMessage: "retrieval_embedding_failed_using_pseudo_embeddings",
  });
  let chunkCount = 0;
  for (const [index, chunk] of chunks.entries()) {
    const normalizedContent = chunk.trim();
    if (!normalizedContent) continue;
    chunkCount += 1;
    await database.insert(retrievalChunks).values({
      scope: input.scope,
      providerGroupId: input.providerGroupId,
      clientProfileId: input.clientProfileId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      chunkNo: index + 1,
      content: normalizedContent,
      tokenCount: tokenCount(normalizedContent),
      embedding: vectorLiteral(embeddings[index] ?? []),
      embeddingVector: vectorLiteral(embeddings[index] ?? []),
      metadataJson: { ...input.metadata, indexed_at: new Date().toISOString() },
    });
  }
  return chunkCount;
}

async function statementContext(
  database: DbLike,
  message: typeof messages.$inferSelect,
): Promise<{
  clientProfileId: string | null;
  speakerRole: string | null;
  speakerDisplayName: string | null;
}> {
  const [member] = message.senderProviderUserId
    ? await database
        .select()
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.providerGroupId, message.providerGroupId),
            eq(groupMembers.providerUserId, message.senderProviderUserId),
          ),
        )
        .limit(1)
    : [];
  const [primary] = await database
    .select({ clientProfileId: groupClientProfiles.clientProfileId })
    .from(groupClientProfiles)
    .where(and(eq(groupClientProfiles.providerGroupId, message.providerGroupId), eq(groupClientProfiles.isPrimary, true)))
    .limit(1);
  const speakerRole = member?.role ?? null;
  const clientProfileId = member?.clientProfileId ?? primary?.clientProfileId ?? null;
  return { clientProfileId, speakerRole, speakerDisplayName: member?.displayName ?? member?.pushName ?? null };
}

async function deleteMessageKnowledge(database: DbLike, messageId: string): Promise<void> {
  const rows = await database
    .select({ statementId: knowledgeStatements.id, claimId: knowledgeClaims.id })
    .from(knowledgeStatements)
    .leftJoin(knowledgeClaims, eq(knowledgeClaims.statementId, knowledgeStatements.id))
    .where(eq(knowledgeStatements.sourceMessageId, messageId));
  const statementIds = Array.from(new Set(rows.map((row) => row.statementId).filter(Boolean)));
  const claimIds = Array.from(new Set(rows.map((row) => row.claimId).filter((id): id is string => Boolean(id))));
  if (claimIds.length > 0) {
    await database
      .delete(retrievalChunks)
      .where(and(eq(retrievalChunks.sourceType, "knowledge_claim"), inArray(retrievalChunks.sourceId, claimIds)));
  }
  if (statementIds.length > 0) {
    await database
      .delete(retrievalChunks)
      .where(and(eq(retrievalChunks.sourceType, "knowledge_statement"), inArray(retrievalChunks.sourceId, statementIds)));
    await database.delete(knowledgeStatements).where(inArray(knowledgeStatements.id, statementIds));
  }
}

async function deleteSourceChunks(database: DbLike, sourceType: string, sourceId: string): Promise<void> {
  await database
    .delete(retrievalChunks)
    .where(and(eq(retrievalChunks.sourceType, sourceType), eq(retrievalChunks.sourceId, sourceId)));
}

function attributionLabel(role: string | null): string {
  if (role === "client") return "client_statement";
  if (role === "lawyer") return "lawyer_statement";
  if (role === "company_staff") return "company_staff_statement";
  if (role === "bot") return "bot_statement";
  return "participant_statement";
}

function attributedContent(label: string, speakerDisplayName: string | null, text: string): string {
  const speaker = speakerDisplayName ? ` by ${speakerDisplayName}` : "";
  return `${label}${speaker}: ${text}`;
}

function statementMetadata(statement: typeof knowledgeStatements.$inferSelect): Record<string, unknown> {
  return {
    knowledge_statement_id: statement.id,
    source_message_id: statement.sourceMessageId,
    source_message_version_id: statement.sourceMessageVersionId,
    provider_message_id: statement.providerMessageId,
    speaker_provider_user_id: statement.speakerProviderUserId,
    speaker_role: statement.speakerRole,
    speaker_display_name: statement.speakerDisplayName,
    attribution_label: statement.attributionLabel,
    occurred_at: statement.occurredAt.toISOString(),
    client_profile_id: statement.clientProfileId,
  };
}

function extractClaims(text: string, kind: KnowledgeStatementKind): string[] {
  const normalizedStatement = normalizeClaimText(text);
  const claims = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 12)
    .filter((part) => normalizeClaimText(part) !== normalizedStatement);
  if (kind === "profile" || claims.length === 0) {
    return [];
  }
  return Array.from(new Set(claims)).slice(0, 8);
}

function claimKind(text: string, fallback: KnowledgeStatementKind): string {
  const lowered = text.toLowerCase();
  if (isProfileStatement(lowered)) return "profile_statement";
  if (/\b(beweis|screenshot|hass|beleidigung|drohung|bedrohung|harassment|threat|insult)\b/.test(lowered)) {
    return "incident_or_evidence_statement";
  }
  if (fallback === "case") return "case_statement";
  return "general_statement";
}

type KnowledgeStatementKind = "profile" | "case" | "staff_note";

function classifyKnowledgeStatement(
  text: string,
  speakerRole: string | null,
): { scope: "group" | "personal"; kind: KnowledgeStatementKind } | null {
  const lowered = text.toLowerCase();
  if (speakerRole === "bot") {
    return null;
  }
  if (speakerRole === "client" && isProfileStatement(lowered)) {
    return { scope: "personal", kind: "profile" };
  }
  if (isCaseStatement(lowered)) {
    return { scope: "group", kind: "case" };
  }
  if (speakerRole === "lawyer" || speakerRole === "company_staff") {
    return { scope: "group", kind: "staff_note" };
  }
  return null;
}

function isProfileStatement(lowered: string): boolean {
  return /\b(ich heiße|mein name ist|ich bin [0-9]{1,3}( jahre alt)?|i am [0-9]{1,3}( years old)?|my name is)\b/.test(lowered);
}

function isCaseStatement(lowered: string): boolean {
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
    "verleumdung",
    "harassment",
    "hate speech",
    "insult",
    "threat",
    "strafbar",
    "anzeige",
    "polizei",
    "gericht",
    "anwalt",
    "täter",
    "opfer",
  ].some((term) => lowered.includes(term));
}

function normalizeClaimText(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
