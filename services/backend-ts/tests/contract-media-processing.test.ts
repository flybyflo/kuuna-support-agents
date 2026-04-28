import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { eq } from "drizzle-orm";

import { resetSettingsForTests } from "../src/config.js";
import { mediaAssets, messages, messageVersions, transcripts } from "../src/db/schema.js";
import { processMediaAssetJob } from "../src/jobs/media-processing.js";
import { parseRuntimeChatTask, type EnqueueRuntimeChatTaskOptions } from "../src/jobs/queues.js";
import { contractDatabaseUrl, createContractHarness } from "./contract-harness.js";

const skipReason = contractDatabaseUrl
  ? false
  : "set BACKEND_TS_CONTRACT_DATABASE_URL to run backend-ts contract tests";

test("contract: media processing inline text writes ready transcript and followups", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());
  const seeded = await seedMessageWithMedia(harness, {
    mimeType: "text/plain; charset=utf-8",
    metadataJson: { inline_data_base64: Buffer.from("hello transcript", "utf8").toString("base64") },
  });
  const runtimeChatTasks: string[] = [];
  const runtimeChatQueue: NonNullable<EnqueueRuntimeChatTaskOptions["redis"]> = {
    async rpush(_key, value) {
      runtimeChatTasks.push(value);
      return runtimeChatTasks.length;
    },
    async set() {
      return "OK";
    },
  };

  const result = await processMediaAssetJob(
    harness.db,
    { mediaAssetId: seeded.mediaAssetId, traceId: "trace-media" },
    {
      runtimeChatQueue,
      enqueueJob: async (name, data, jobId) => {
        harness.jobs.push({ name, data, jobId });
        return jobId ?? name;
      },
      uploadBytes: async ({ objectKey }) => `https://cdn.test/${objectKey}`,
    },
  );

  assert.deepEqual(result, { processed: true, status: "ready" });
  const asset = await findMediaAsset(harness, seeded.mediaAssetId);
  assert.equal(asset.status, "ready");
  assert.ok(asset.s3Key?.endsWith(".txt"));
  const metadata = asset.metadataJson as Record<string, unknown>;
  assert.equal(metadata.object_url, `https://cdn.test/${asset.s3Key}`);
  assert.equal(metadata.inline_data_base64, undefined);

  const transcript = await findTranscript(harness, seeded.mediaAssetId);
  assert.equal(transcript.status, "ready");
  assert.equal(transcript.textContent, "hello transcript");
  assert.deepEqual(harness.jobs.map((job) => job.name), ["retrieval_indexing", "runtime_chat_queue"]);
  assert.equal(harness.jobs[1]?.data.queued_task, undefined);
  assert.equal(parseRuntimeChatTask(runtimeChatTasks[0]).name, "passive_message_analysis");
});

test("contract: media processing missing download marks failed", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());
  const seeded = await seedMessageWithMedia(harness, {
    mimeType: "application/octet-stream",
    metadataJson: {},
  });

  const result = await processMediaAssetJob(harness.db, { mediaAssetId: seeded.mediaAssetId });

  assert.deepEqual(result, { processed: true, status: "failed" });
  const asset = await findMediaAsset(harness, seeded.mediaAssetId);
  assert.equal(asset.status, "failed");
  assert.equal((asset.metadataJson as Record<string, unknown>).error, "download_url_missing");
  const transcript = await findTranscript(harness, seeded.mediaAssetId);
  assert.equal(transcript.status, "failed");
});

test("contract: internal media reconcile snapshots and retries failed assets", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());
  process.env.INTERNAL_OPS_TOKEN = "media-token";
  resetSettingsForTests();
  t.after(() => {
    delete process.env.INTERNAL_OPS_TOKEN;
    resetSettingsForTests();
  });

  const pending = await seedMessageWithMedia(harness, { mimeType: "image/jpeg", metadataJson: {}, providerMediaId: "p1" });
  const failed = await seedMessageWithMedia(harness, {
    mimeType: "image/jpeg",
    metadataJson: { error: "old" },
    providerMediaId: "p2",
    status: "failed",
  });
  await seedMessageWithMedia(harness, {
    mimeType: "image/jpeg",
    metadataJson: { error: "bogus" },
    providerMediaId: "b''",
    status: "failed",
  });

  const caller = await harness.internalCaller("media-token");
  const body = await caller.internal.mediaReconcile({
      dry_run: false,
      enqueue_pending: true,
      retry_failed: true,
      cleanup_bogus: true,
    }) as {
    before: { pending: number; failed: number; bogus_failed: number };
    after: { pending: number; failed: number; bogus_failed: number };
    actions: { cleaned_bogus: number; enqueued_pending: number; retried_failed: number };
  };
  assert.deepEqual(body.before, { pending: 1, ready: 0, failed: 2, bogus_failed: 1 });
  assert.equal(body.actions.cleaned_bogus, 1);
  assert.equal(body.actions.enqueued_pending, 1);
  assert.equal(body.actions.retried_failed, 1);
  assert.equal(body.after.bogus_failed, 0);
  assert.ok(harness.jobs.some((job) => (job.data.media_asset_id as string) === pending.mediaAssetId));
  assert.ok(harness.jobs.some((job) => (job.data.media_asset_id as string) === failed.mediaAssetId));
});

async function seedMessageWithMedia(
  harness: Awaited<ReturnType<typeof createContractHarness>>,
  input: {
    mimeType: string;
    metadataJson: Record<string, unknown>;
    providerMediaId?: string;
    status?: "pending" | "ready" | "failed";
  },
) {
  const [message] = await harness.db
    .insert(messages)
    .values({
      providerGroupId: "media-group@g.us",
      providerMessageId: `msg-${randomUUID()}`,
      senderProviderUserId: "user@s.whatsapp.net",
      latestVersionNo: 1,
    })
    .returning();
  assert.ok(message);
  await harness.db.insert(messageVersions).values({
    messageId: message.id,
    versionNo: 1,
    eventType: "message_created",
    isDeleted: false,
    textContent: "media message",
    rawEvent: {},
    occurredAt: new Date(),
  });
  const [asset] = await harness.db
    .insert(mediaAssets)
    .values({
      messageId: message.id,
      providerMediaId: input.providerMediaId ?? `media-${randomUUID()}`,
      mimeType: input.mimeType,
      status: input.status ?? "pending",
      metadataJson: input.metadataJson,
    })
    .returning();
  assert.ok(asset);
  return { messageId: message.id, mediaAssetId: asset.id };
}

async function findMediaAsset(harness: Awaited<ReturnType<typeof createContractHarness>>, mediaAssetId: string) {
  const [asset] = await harness.db.select().from(mediaAssets).where(eq(mediaAssets.id, mediaAssetId)).limit(1);
  assert.ok(asset);
  return asset;
}

async function findTranscript(harness: Awaited<ReturnType<typeof createContractHarness>>, mediaAssetId: string) {
  const [transcript] = await harness.db
    .select()
    .from(transcripts)
    .where(eq(transcripts.mediaAssetId, mediaAssetId))
    .limit(1);
  assert.ok(transcript);
  return transcript;
}
