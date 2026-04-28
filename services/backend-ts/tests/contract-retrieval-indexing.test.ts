import assert from "node:assert/strict";
import test from "node:test";

import { eq } from "drizzle-orm";

import { messages, messageVersions, retrievalChunks } from "../src/db/schema.js";
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
