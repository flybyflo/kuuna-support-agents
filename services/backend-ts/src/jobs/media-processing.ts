import { createDecipheriv, hkdfSync } from "node:crypto";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { getSettings } from "../config.js";
import type { Database, DbLike } from "../db/client.js";
import { mediaAssets, messages, messageVersions, transcripts } from "../db/schema.js";
import { createPresignedGetUrl, publicUrlFromKey, uploadBytes as uploadS3Bytes } from "../integrations/s3.js";
import { logger } from "../logging.js";
import { publishRuntimeEvent } from "../runtime/events.js";
import { enqueueKuunaJob, type EnqueueKuunaJob } from "./queues.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MediaAssetRow = typeof mediaAssets.$inferSelect;

type HttpClient = (url: string, init?: RequestInit) => Promise<Response>;
type UploadBytes = (input: {
  bucketName: string;
  objectKey: string;
  data: Uint8Array;
  contentType: string;
}) => Promise<string | null | undefined>;

export type MediaProcessingResult =
  | { processed: false; status: "disabled" | "invalid" | "not_found" | "already_processed" }
  | { processed: true; status: "ready" | "failed" };

export async function processMediaAssetJob(
  database: DbLike,
  input: { mediaAssetId: string; traceId?: string | null },
  options: {
    httpClient?: HttpClient;
    uploadBytes?: UploadBytes;
    enqueueJob?: EnqueueKuunaJob;
  } = {},
): Promise<MediaProcessingResult> {
  const settings = getSettings();
  if (!settings.MEDIA_PROCESSING_ENABLED) {
    logger.info("media_processing_disabled", { trace_id: input.traceId, media_asset_id: input.mediaAssetId });
    return { processed: false, status: "disabled" };
  }
  if (!uuidPattern.test(input.mediaAssetId)) {
    logger.error("media_asset_invalid_id", { trace_id: input.traceId, media_asset_id: input.mediaAssetId });
    return { processed: false, status: "invalid" };
  }

  const [asset] = await database
    .select()
    .from(mediaAssets)
    .where(eq(mediaAssets.id, input.mediaAssetId))
    .limit(1);
  if (!asset) {
    logger.warn("media_asset_not_found", { trace_id: input.traceId, media_asset_id: input.mediaAssetId });
    return { processed: false, status: "not_found" };
  }
  if (asset.status !== "pending") {
    logger.info("media_asset_already_processed", {
      trace_id: input.traceId,
      media_asset_id: input.mediaAssetId,
      status: asset.status,
    });
    return { processed: false, status: "already_processed" };
  }

  try {
    const result = await processPendingAsset(database, asset, input.traceId ?? null, options);
    return { processed: true, status: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markMediaFailed(database, asset, message);
    await publishRuntimeEvent({
      type: "media.updated",
      providerGroupId: null,
      traceId: input.traceId ?? null,
      entityId: asset.id,
      entityType: "media_asset",
      payload: { status: "failed", message_id: asset.messageId, error: message },
    });
    logger.error("media_asset_processing_failed", {
      trace_id: input.traceId,
      media_asset_id: input.mediaAssetId,
      error: message,
    });
    return { processed: true, status: "failed" };
  }
}

export async function reconcileMediaAssets(
  database: Database,
  input: {
    providerGroupId?: string | null;
    dryRun?: boolean;
    enqueuePending?: boolean;
    retryFailed?: boolean;
    cleanupBogus?: boolean;
    limit?: number;
  },
  options: { enqueueJob?: EnqueueKuunaJob } = {},
) {
  const providerGroupId = input.providerGroupId ?? null;
  const dryRun = input.dryRun ?? true;
  const limit = Math.max(1, Math.min(input.limit ?? 500, 5000));
  const enqueueJob = options.enqueueJob ?? enqueueKuunaJob;
  const before = await mediaSnapshot(database, providerGroupId);
  const actions = { cleaned_bogus: 0, enqueued_pending: 0, retried_failed: 0 };

  if (!dryRun && input.cleanupBogus) {
    const bogusRows = await scopedMediaRows(database, providerGroupId, ["failed"], limit, true);
    const ids = bogusRows.map((asset) => asset.id);
    if (ids.length > 0) {
      await database.delete(mediaAssets).where(inArray(mediaAssets.id, ids));
      actions.cleaned_bogus = ids.length;
    }
  }

  if (input.enqueuePending) {
    const rows = await scopedMediaRows(database, providerGroupId, ["pending"], limit, false);
    if (!dryRun) {
      for (const asset of rows) {
        await enqueueJob("media_processing", { media_asset_id: asset.id }, `media_processing_${jobToken(asset.id)}`);
      }
    }
    actions.enqueued_pending = rows.length;
  }

  if (input.retryFailed) {
    const rows = await scopedMediaRows(database, providerGroupId, ["failed"], limit, false);
    if (!dryRun) {
      for (const asset of rows) {
        const metadata = objectRecord(asset.metadataJson);
        delete metadata.error;
        await database
          .update(mediaAssets)
          .set({ status: "pending", metadataJson: metadata, updatedAt: new Date() })
          .where(eq(mediaAssets.id, asset.id));
        await enqueueJob("media_processing", { media_asset_id: asset.id }, `media_processing_${jobToken(asset.id)}`);
      }
    }
    actions.retried_failed = rows.length;
  }

  const after = dryRun ? before : await mediaSnapshot(database, providerGroupId);
  return {
    provider_group_id: providerGroupId,
    dry_run: dryRun,
    before,
    after,
    actions,
    message: dryRun ? "media reconcile dry run completed" : "media reconcile completed",
  };
}

async function processPendingAsset(
  database: DbLike,
  asset: MediaAssetRow,
  traceId: string | null,
  options: { httpClient?: HttpClient; uploadBytes?: UploadBytes; enqueueJob?: EnqueueKuunaJob },
): Promise<"ready" | "failed"> {
  const metadata = objectRecord(asset.metadataJson);
  const kind = kindFromMimeType(asset.mimeType);
  const [message] = await database
    .select()
    .from(messages)
    .where(eq(messages.id, asset.messageId))
    .limit(1);
  const providerGroupId = message?.providerGroupId ?? "unknown";
  const rawEvent = await latestRawEvent(database, asset.messageId);
  const mediaPayload = extractMediaPayload(rawEvent, kind);

  const payloadMimeType = lookupString(mediaPayload, ["mimetype", "mimeType", "Mimetype", "MimeType"]);
  const mimeType = payloadMimeType && asset.mimeType.startsWith("application/") ? payloadMimeType : asset.mimeType;

  const inlineData = typeof metadata.inline_data_base64 === "string" ? metadata.inline_data_base64 : null;
  let bytes: Uint8Array | null = null;
  let usedInlineData = false;
  if (inlineData) {
    try {
      bytes = Buffer.from(inlineData, "base64");
      usedInlineData = true;
    } catch {
      metadata.inline_data_invalid = true;
    }
  }

  if (kind === "image" && typeof metadata.preview_url !== "string") {
    const thumbnail = extractThumbnailDataUrl(mediaPayload);
    if (thumbnail) {
      metadata.preview_url = thumbnail;
    }
  }

  let downloadUrl = typeof metadata.download_url === "string" ? metadata.download_url : null;
  downloadUrl ??= lookupString(mediaPayload, ["url", "URL"]);
  if (downloadUrl) {
    metadata.download_url = downloadUrl;
  }

  if (!bytes && !downloadUrl) {
    if (kind === "image" && typeof metadata.preview_url === "string") {
      metadata.processing_mode = "thumbnail-only";
      await markMediaReady(database, asset, {
        metadata,
        mimeType,
        transcript: successTranscript({ kind, mimeType, mediaPayload }),
      });
      await publishRuntimeEvent({
        type: "media.updated",
        providerGroupId,
        traceId,
        entityId: asset.id,
        entityType: "media_asset",
        payload: { status: "ready", message_id: asset.messageId, kind, processing_mode: "thumbnail-only" },
      });
      await enqueueMediaFollowups(options.enqueueJob, asset, providerGroupId, traceId, "media_processed");
      return "ready";
    }
    metadata.error = "download_url_missing";
    await markMediaFailed(database, asset, "download_url_missing", metadata);
    await publishRuntimeEvent({
      type: "media.updated",
      providerGroupId,
      traceId,
      entityId: asset.id,
      entityType: "media_asset",
      payload: { status: "failed", message_id: asset.messageId, kind, error: "download_url_missing" },
    });
    return "failed";
  }

  if (!bytes && downloadUrl) {
    const response = await (options.httpClient ?? fetch)(downloadUrl, {
      method: "GET",
      signal: AbortSignal.timeout(getSettings().MEDIA_DOWNLOAD_TIMEOUT_SECONDS * 1000),
    });
    if (!response.ok) {
      throw new Error(`media_download_http_${response.status}`);
    }
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  if (!bytes) {
    throw new Error("media bytes unavailable after download stage");
  }
  if (!usedInlineData) {
    const decryptedBytes = decryptWhatsAppMediaIfNeeded({ bytes, kind, mediaPayload, downloadUrl });
    if (decryptedBytes !== bytes) {
      metadata.media_decrypted = true;
      metadata.encrypted_byte_size_downloaded = bytes.byteLength;
      bytes = decryptedBytes;
    }
  }

  const objectKey = buildObjectKey({ providerGroupId, messageId: asset.messageId, mediaId: asset.id, mimeType });
  const objectUrl = await uploadObject(objectKey, bytes, mimeType, options.uploadBytes);
  metadata.byte_size_downloaded = bytes.byteLength;
  metadata.object_url = objectUrl;
  metadata.source_download_url = downloadUrl;
  if (kind === "image") {
    const existingPreview = typeof metadata.preview_url === "string" ? metadata.preview_url : null;
    if (usedInlineData && inlineData) {
      metadata.preview_url = `data:${mimeType};base64,${inlineData}`;
    } else if (existingPreview?.startsWith("data:image/")) {
      metadata.preview_url = existingPreview;
    } else {
      metadata.preview_url = objectUrl ?? downloadUrl;
    }
  }
  delete metadata.inline_data_base64;

  await markMediaReady(database, asset, {
    metadata,
    mimeType,
    s3Key: objectKey,
    transcript: successTranscript({ kind, mimeType, mediaPayload, content: bytes }),
  });
  await publishRuntimeEvent({
    type: "media.updated",
    providerGroupId,
    traceId,
    entityId: asset.id,
    entityType: "media_asset",
    payload: { status: "ready", message_id: asset.messageId, kind },
  });
  await enqueueMediaFollowups(options.enqueueJob, asset, providerGroupId, traceId, "media_processed");
  logger.info("media_asset_processed", {
    trace_id: traceId,
    media_asset_id: asset.id,
    status: "ready",
    object_key: objectKey,
    kind,
  });
  return "ready";
}

async function markMediaReady(
  database: DbLike,
  asset: MediaAssetRow,
  input: { metadata: Record<string, unknown>; mimeType: string; s3Key?: string; transcript: { text: string; status: "ready" | "failed"; language?: string | null } },
): Promise<void> {
  await database
    .update(mediaAssets)
    .set({
      status: "ready",
      mimeType: input.mimeType,
      s3Key: input.s3Key ?? asset.s3Key,
      metadataJson: input.metadata,
      updatedAt: new Date(),
    })
    .where(eq(mediaAssets.id, asset.id));
  await upsertTranscript(database, asset.id, input.transcript);
}

async function markMediaFailed(
  database: DbLike,
  asset: MediaAssetRow,
  error: string,
  metadataInput?: Record<string, unknown>,
): Promise<void> {
  const metadata = metadataInput ?? objectRecord(asset.metadataJson);
  metadata.error = error;
  await database
    .update(mediaAssets)
    .set({ status: "failed", metadataJson: metadata, updatedAt: new Date() })
    .where(eq(mediaAssets.id, asset.id));
  await upsertTranscript(database, asset.id, { text: `Media processing failed: ${error}`, status: "failed" });
}

async function upsertTranscript(
  database: DbLike,
  mediaAssetId: string,
  transcript: { text: string; status: "ready" | "failed"; language?: string | null },
): Promise<void> {
  const [existing] = await database
    .select({ id: transcripts.id })
    .from(transcripts)
    .where(eq(transcripts.mediaAssetId, mediaAssetId))
    .limit(1);
  const values = {
    textContent: transcript.text,
    language: transcript.language ?? null,
    status: transcript.status,
    updatedAt: new Date(),
  };
  if (existing) {
    await database.update(transcripts).set(values).where(eq(transcripts.id, existing.id));
    return;
  }
  await database.insert(transcripts).values({ mediaAssetId, ...values });
}

async function enqueueMediaFollowups(
  enqueueJob: EnqueueKuunaJob | undefined,
  asset: MediaAssetRow,
  providerGroupId: string,
  traceId: string | null,
  reason: string,
): Promise<void> {
  const enqueue = enqueueJob ?? enqueueKuunaJob;
  await enqueue(
    "retrieval_indexing",
    { source_type: "media_asset", source_id: asset.id, trace_id: traceId },
    `retrieval_indexing_media_asset_${jobToken(asset.id)}_${jobToken(traceId)}`,
  );
  await enqueue(
    "passive_message_analysis",
    { message_id: asset.messageId, provider_group_id: providerGroupId, reason, trace_id: traceId },
    `passive_analysis_${jobToken(asset.messageId)}_${jobToken(reason)}_${jobToken(traceId)}`,
  );
}

async function latestRawEvent(database: DbLike, messageId: string): Promise<Record<string, unknown>> {
  const [version] = await database
    .select({ rawEvent: messageVersions.rawEvent })
    .from(messageVersions)
    .where(eq(messageVersions.messageId, messageId))
    .orderBy(sql`${messageVersions.versionNo} desc`)
    .limit(1);
  return objectRecord(version?.rawEvent);
}

function successTranscript(input: {
  kind: string;
  mimeType: string;
  mediaPayload: Record<string, unknown>;
  content?: Uint8Array;
}): { text: string; status: "ready"; language?: string | null } {
  const caption = lookupString(input.mediaPayload, ["caption", "Caption"]);
  if (caption?.trim()) {
    return { text: caption.trim(), status: "ready" };
  }
  if (isTextMimeType(input.mimeType) && input.content) {
    return { text: decodeText(input.content, input.mimeType).trim(), status: "ready" };
  }
  if (isPdfMimeType(input.mimeType)) {
    return { text: "Transcript pending for pdf media.", status: "ready" };
  }
  if (input.kind === "image") {
    return { text: "Transcript pending for image media.", status: "ready" };
  }
  if (input.kind === "audio" || input.kind === "video") {
    return { text: `Transcript pending for ${input.kind} media.`, status: "ready" };
  }
  return { text: `Transcript pending for ${input.mimeType || "file"} media.`, status: "ready" };
}

function decryptWhatsAppMediaIfNeeded(input: {
  bytes: Uint8Array;
  kind: string;
  mediaPayload: Record<string, unknown>;
  downloadUrl: string | null;
}): Uint8Array {
  if (!input.downloadUrl?.includes(".enc")) {
    return input.bytes;
  }

  const mediaKey = lookupString(input.mediaPayload, ["mediaKey", "MediaKey"]);
  if (!mediaKey) {
    throw new Error("media_decrypt_media_key_missing");
  }

  if (input.bytes.byteLength <= 10) {
    throw new Error("media_decrypt_payload_too_short");
  }

  const info = mediaKeyInfo(input.kind);
  const keyMaterial = Buffer.from(
    hkdfSync("sha256", Buffer.from(mediaKey, "base64"), Buffer.alloc(32), info, 112),
  );
  const iv = keyMaterial.subarray(0, 16);
  const cipherKey = keyMaterial.subarray(16, 48);
  const encryptedContent = Buffer.from(input.bytes).subarray(0, input.bytes.byteLength - 10);
  const decipher = createDecipheriv("aes-256-cbc", cipherKey, iv);
  return new Uint8Array(Buffer.concat([decipher.update(encryptedContent), decipher.final()]));
}

function mediaKeyInfo(kind: string): string {
  if (kind === "image") return "WhatsApp Image Keys";
  if (kind === "video") return "WhatsApp Video Keys";
  if (kind === "audio") return "WhatsApp Audio Keys";
  if (kind === "sticker") return "WhatsApp Image Keys";
  return "WhatsApp Document Keys";
}

async function uploadObject(
  objectKey: string,
  bytes: Uint8Array,
  contentType: string,
  uploadBytes?: UploadBytes,
): Promise<string | null> {
  const settings = getSettings();
  const uploadedUrl = uploadBytes
    ? await uploadBytes({ bucketName: settings.S3_BUCKET, objectKey, data: bytes, contentType })
    : null;
  if (uploadedUrl) {
    return uploadedUrl;
  }
  if (!uploadBytes) {
    await uploadS3Bytes({
      bucketName: settings.S3_BUCKET,
      objectKey,
      data: bytes,
      contentType,
    });
  }
  return publicUrlFromKey(objectKey, settings.S3_BUCKET) ?? createPresignedGetUrl({ bucketName: settings.S3_BUCKET, objectKey });
}

async function mediaSnapshot(database: DbLike, providerGroupId: string | null) {
  const rows = await scopedMediaRows(database, providerGroupId, ["pending", "ready", "failed"], 100000, false);
  return {
    pending: rows.filter((asset) => asset.status === "pending").length,
    ready: rows.filter((asset) => asset.status === "ready").length,
    failed: rows.filter((asset) => asset.status === "failed").length,
    bogus_failed: rows.filter((asset) => asset.status === "failed" && asset.providerMediaId === "b''").length,
  };
}

async function scopedMediaRows(
  database: DbLike,
  providerGroupId: string | null,
  statuses: Array<"pending" | "ready" | "failed">,
  limit: number,
  bogusOnly: boolean,
): Promise<MediaAssetRow[]> {
  const statusFilter = inArray(mediaAssets.status, statuses);
  const bogusFilter = bogusOnly ? eq(mediaAssets.providerMediaId, "b''") : undefined;
  if (!providerGroupId) {
    return database
      .select()
      .from(mediaAssets)
      .where(bogusFilter ? and(statusFilter, bogusFilter) : statusFilter)
      .orderBy(asc(mediaAssets.createdAt))
      .limit(limit);
  }
  const rows = await database
    .select()
    .from(mediaAssets)
    .innerJoin(messages, eq(messages.id, mediaAssets.messageId))
    .where(
      and(
        eq(messages.providerGroupId, providerGroupId),
        statusFilter,
        ...(bogusFilter ? [bogusFilter] : []),
      ),
    )
    .orderBy(asc(mediaAssets.createdAt))
    .limit(limit);
  return rows.map((row) => row.media_assets);
}

function kindFromMimeType(mimeType: string | null | undefined): string {
  const normalized = normalizeMimeType(mimeType);
  if (normalized.startsWith("image/") || normalized.endsWith("/image")) return "image";
  if (normalized.startsWith("video/") || normalized.endsWith("/video")) return "video";
  if (normalized.startsWith("audio/") || normalized.endsWith("/audio")) return "audio";
  if (normalized.startsWith("application/sticker") || normalized.endsWith("/sticker")) return "sticker";
  if (normalized.startsWith("application/document") || normalized.endsWith("/document")) return "document";
  return "file";
}

function normalizeMimeType(mimeType: string | null | undefined): string {
  return (mimeType ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function extractMediaPayload(rawEvent: Record<string, unknown>, kind: string): Record<string, unknown> {
  const fields = mediaFieldCandidates(kind);
  for (const container of [objectRecord(rawEvent.Message), objectRecord(rawEvent.Raw), rawEvent]) {
    for (const field of fields) {
      const payload = container[field];
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        return payload as Record<string, unknown>;
      }
    }
  }
  return {};
}

function mediaFieldCandidates(kind: string): string[] {
  if (kind === "image") return ["imageMessage", "ImageMessage"];
  if (kind === "video") return ["videoMessage", "VideoMessage"];
  if (kind === "audio") return ["audioMessage", "AudioMessage"];
  if (kind === "document") return ["documentMessage", "DocumentMessage"];
  if (kind === "sticker") return ["stickerMessage", "StickerMessage"];
  return [];
}

function lookupString(record: Record<string, unknown>, keys: string[]): string | null {
  const lowered = new Map(Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]));
  for (const key of keys) {
    const direct = record[key] ?? lowered.get(key.toLowerCase());
    if (typeof direct === "string" && direct) return direct;
  }
  return null;
}

function extractThumbnailDataUrl(mediaPayload: Record<string, unknown>): string | null {
  const thumbnail = lookupString(mediaPayload, ["jpegThumbnail", "JPEGThumbnail"]);
  return thumbnail ? `data:image/jpeg;base64,${thumbnail}` : null;
}

function buildObjectKey(input: { providerGroupId: string; messageId: string; mediaId: string; mimeType: string }): string {
  const safeGroup = input.providerGroupId.replaceAll("@", "_at_").replaceAll("/", "_");
  return `media/${safeGroup}/${input.messageId}/${input.mediaId}${extensionFromMime(input.mimeType)}`;
}

function extensionFromMime(mimeType: string): string {
  const normalized = normalizeMimeType(mimeType);
  if (normalized === "image/jpeg") return ".jpg";
  if (normalized === "image/png") return ".png";
  if (normalized === "image/webp") return ".webp";
  if (normalized === "application/pdf") return ".pdf";
  if (normalized === "text/plain") return ".txt";
  if (normalized === "text/markdown" || normalized === "application/markdown") return ".md";
  if (normalized === "audio/mpeg") return ".mp3";
  if (normalized === "video/mp4") return ".mp4";
  return "";
}

function isTextMimeType(mimeType: string): boolean {
  const normalized = normalizeMimeType(mimeType);
  return normalized.startsWith("text/") || normalized === "application/markdown" || normalized === "application/x-markdown";
}

function isPdfMimeType(mimeType: string): boolean {
  const normalized = normalizeMimeType(mimeType);
  return normalized === "application/pdf" || normalized === "application/x-pdf";
}

function decodeText(bytes: Uint8Array, mimeType: string): string {
  const charset = mimeType.split(";").find((part) => part.trim().toLowerCase().startsWith("charset="));
  const encodings = [
    charset?.split("=")[1]?.trim().replace(/^["']|["']$/g, ""),
    "utf-8",
    "utf-16le",
    "latin1",
  ].filter((item): item is string => Boolean(item));
  for (const encoding of encodings) {
    try {
      return Buffer.from(bytes).toString(encoding as BufferEncoding);
    } catch {
      continue;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function jobToken(value: string | null | undefined): string {
  return (value || "message").replaceAll("-", "_").replaceAll(" ", "_");
}
