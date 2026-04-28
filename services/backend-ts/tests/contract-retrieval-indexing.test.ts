import assert from "node:assert/strict";
import test from "node:test";

import { eq } from "drizzle-orm";

import {
  mediaAssets,
  messageLinks,
  messages,
  messageVersions,
  retrievalChunks,
  transcripts,
} from "../src/db/schema.js";
import { processRetrievalIndexingJob } from "../src/jobs/retrieval-indexing.js";
import { contractDatabaseUrl, createContractHarness } from "./contract-harness.js";

const skipReason = contractDatabaseUrl
  ? false
  : "set BACKEND_TS_CONTRACT_DATABASE_URL to run backend-ts contract tests";

test("contract: retrieval indexing writes latest non-deleted message chunk", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());

  const [message] = await harness.db
    .insert(messages)
    .values({
      providerGroupId: "group-123",
      providerMessageId: "msg-retrieval",
      senderProviderUserId: "user-1",
      latestVersionNo: 1,
    })
    .returning();
  assert.ok(message);

  const occurredAt = new Date();
  await harness.db.insert(messageVersions).values({
    messageId: message.id,
    versionNo: 1,
    eventType: "message_created",
    isDeleted: false,
    textContent: "hello retrieval world",
    rawEvent: { provider_payload: { kind: "MessageEv" } },
    occurredAt,
  });

  const result = await processRetrievalIndexingJob(harness.db, {
    sourceType: "message",
    sourceId: message.id,
    traceId: "trace-1",
  });

  assert.deepEqual(result, { indexed: true, chunkCount: 1 });

  const [chunk] = await harness.db
    .select()
    .from(retrievalChunks)
    .where(eq(retrievalChunks.sourceId, message.id))
    .limit(1);

  assert.ok(chunk);
  assert.equal(chunk.scope, "conversation");
  assert.equal(chunk.providerGroupId, "group-123");
  assert.equal(chunk.sourceType, "message");
  assert.equal(chunk.content, "hello retrieval world");
  assert.equal(chunk.tokenCount, 3);
  assert.equal((chunk.metadataJson as Record<string, unknown>).trace_id, "trace-1");
});

test("contract: retrieval indexing writes message link chunk", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());

  const [message] = await harness.db
    .insert(messages)
    .values({
      providerGroupId: "group-link",
      providerMessageId: "msg-link",
      latestVersionNo: 1,
    })
    .returning();
  assert.ok(message);
  const [link] = await harness.db
    .insert(messageLinks)
    .values({
      messageId: message.id,
      providerGroupId: "group-link",
      url: "HTTPS://Example.COM/path",
      normalizedUrl: "https://example.com/path",
      title: "Example Link",
      metadataJson: {},
    })
    .returning();
  assert.ok(link);

  const result = await processRetrievalIndexingJob(harness.db, {
    sourceType: "message_link",
    sourceId: link.id,
    traceId: "trace-link",
  });

  assert.deepEqual(result, { indexed: true, chunkCount: 1 });
  const [chunk] = await harness.db.select().from(retrievalChunks).where(eq(retrievalChunks.sourceId, link.id));
  assert.ok(chunk);
  assert.equal(chunk.sourceType, "message_link");
  assert.equal(chunk.content, "Example Link\nhttps://example.com/path");
  assert.equal((chunk.metadataJson as Record<string, unknown>).url, "HTTPS://Example.COM/path");
});

test("contract: retrieval indexing writes ready media transcript chunk", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());

  const [message] = await harness.db
    .insert(messages)
    .values({
      providerGroupId: "group-media",
      providerMessageId: "msg-media",
      latestVersionNo: 1,
    })
    .returning();
  assert.ok(message);
  const [asset] = await harness.db
    .insert(mediaAssets)
    .values({
      messageId: message.id,
      providerMediaId: "media-ready",
      mimeType: "audio/ogg",
      fileName: "voice.ogg",
      status: "ready",
      metadataJson: {},
    })
    .returning();
  assert.ok(asset);
  await harness.db.insert(transcripts).values({
    mediaAssetId: asset.id,
    textContent: "transcribed media text",
    language: "de",
    status: "ready",
  });

  const result = await processRetrievalIndexingJob(harness.db, {
    sourceType: "media_asset",
    sourceId: asset.id,
  });

  assert.deepEqual(result, { indexed: true, chunkCount: 1 });
  const [chunk] = await harness.db.select().from(retrievalChunks).where(eq(retrievalChunks.sourceId, asset.id));
  assert.ok(chunk);
  assert.equal(chunk.sourceType, "media_asset");
  assert.equal(chunk.content, "transcribed media text");
});

test("contract: retrieval indexing deletes stale chunks for deleted, empty, or pending sources", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());

  const [deletedMessage] = await harness.db
    .insert(messages)
    .values({
      providerGroupId: "group-cleanup",
      providerMessageId: "msg-deleted",
      latestVersionNo: 1,
    })
    .returning();
  assert.ok(deletedMessage);
  await harness.db.insert(messageVersions).values({
    messageId: deletedMessage.id,
    versionNo: 1,
    eventType: "message_deleted",
    isDeleted: true,
    textContent: "deleted",
    rawEvent: {},
    occurredAt: new Date(),
  });

  const [emptyMessage] = await harness.db
    .insert(messages)
    .values({
      providerGroupId: "group-cleanup",
      providerMessageId: "msg-empty",
      latestVersionNo: 1,
    })
    .returning();
  assert.ok(emptyMessage);
  await harness.db.insert(messageVersions).values({
    messageId: emptyMessage.id,
    versionNo: 1,
    eventType: "message_created",
    isDeleted: false,
    textContent: "   ",
    rawEvent: {},
    occurredAt: new Date(),
  });

  const [pendingMessage] = await harness.db
    .insert(messages)
    .values({
      providerGroupId: "group-cleanup",
      providerMessageId: "msg-pending-media",
      latestVersionNo: 1,
    })
    .returning();
  assert.ok(pendingMessage);
  const [pendingAsset] = await harness.db
    .insert(mediaAssets)
    .values({
      messageId: pendingMessage.id,
      providerMediaId: "media-pending",
      mimeType: "audio/ogg",
      status: "pending",
      metadataJson: {},
    })
    .returning();
  assert.ok(pendingAsset);

  for (const [sourceType, sourceId] of [
    ["message", deletedMessage.id],
    ["message", emptyMessage.id],
    ["media_asset", pendingAsset.id],
  ] as const) {
    await harness.db.insert(retrievalChunks).values({
      scope: "conversation",
      providerGroupId: "group-cleanup",
      sourceType,
      sourceId,
      chunkNo: 1,
      content: "stale",
      tokenCount: 1,
      embedding: "[0]",
      metadataJson: {},
    });
    const result = await processRetrievalIndexingJob(harness.db, { sourceType, sourceId });
    assert.deepEqual(result, { indexed: false, chunkCount: 0 });
    const chunks = await harness.db.select().from(retrievalChunks).where(eq(retrievalChunks.sourceId, sourceId));
    assert.equal(chunks.length, 0);
  }
});
