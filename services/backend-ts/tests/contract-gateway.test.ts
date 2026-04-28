import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { eq } from "drizzle-orm";

import { outboundIntents, messageLinks, messageVersions } from "../src/db/schema.js";
import { buildServer } from "../src/server.js";
import { contractDatabaseUrl, createContractHarness } from "./contract-harness.js";

const skipReason = contractDatabaseUrl
  ? false
  : "set BACKEND_TS_CONTRACT_DATABASE_URL to run backend-ts contract tests";

function inboundPayload(messageId: string, eventType = "message_created"): {
  trace_id: string;
  provider: "whatsapp-baileys";
  provider_group_id: string;
  provider_message_id: string;
  sender_provider_user_id: string;
  event_type: string;
  occurred_at: string;
  message: {
    text: string | null;
    reply_to_provider_message_id: string | null;
    mentions: string[];
    media: unknown[];
  };
  raw_event: Record<string, unknown>;
} {
  return {
    trace_id: randomUUID(),
    provider: "whatsapp-baileys",
    provider_group_id: "group-123",
    provider_message_id: messageId,
    sender_provider_user_id: "user-1",
    event_type: eventType,
    occurred_at: new Date().toISOString(),
    message: {
      text: "hello",
      reply_to_provider_message_id: null,
      mentions: [],
      media: [],
    },
    raw_event: {
      provider_payload: { kind: "MessageEv", message_id: messageId },
      raw_flags: { from_me: false },
    },
  };
}

test("contract: gateway inbound accepts and versions event", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  const app = await buildServer({
    db: harness.db,
    enqueueJob: async (name, data, jobId) => {
      harness.jobs.push({ name, data, jobId });
      return jobId ?? name;
    },
  });
  t.after(async () => {
    await app.close();
    await harness.close();
  });

  const payload = inboundPayload("msg-123");
  const response = await app.inject({
    method: "POST",
    url: "/gateway/inbound",
    payload,
  });

  assert.equal(response.statusCode, 202);
  assert.equal(response.json().accepted, true);
  assert.equal(response.json().trace_id, payload.trace_id);
  assert.equal(response.json().deduped, false);

  const [storedVersion] = await harness.db.select().from(messageVersions).limit(1);
  assert.ok(storedVersion);
  assert.equal((storedVersion.rawEvent as Record<string, { kind?: string }>).provider_payload.kind, "MessageEv");
  assert.deepEqual(
    harness.jobs.map((job) => job.name),
    ["retrieval_indexing", "passive_message_analysis"],
  );
});

test("contract: gateway inbound dedupes duplicate created event", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  const app = await buildServer({
    db: harness.db,
    enqueueJob: async (name, data, jobId) => {
      harness.jobs.push({ name, data, jobId });
      return jobId ?? name;
    },
  });
  t.after(async () => {
    await app.close();
    await harness.close();
  });

  const firstResponse = await app.inject({
    method: "POST",
    url: "/gateway/inbound",
    payload: inboundPayload("msg-dedupe"),
  });
  const secondResponse = await app.inject({
    method: "POST",
    url: "/gateway/inbound",
    payload: inboundPayload("msg-dedupe"),
  });

  assert.equal(firstResponse.statusCode, 202);
  assert.equal(firstResponse.json().deduped, false);
  assert.equal(secondResponse.statusCode, 202);
  assert.equal(secondResponse.json().deduped, true);
});

test("contract: gateway inbound fills a contentless duplicate created event", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  const app = await buildServer({
    db: harness.db,
    enqueueJob: async (name, data, jobId) => {
      harness.jobs.push({ name, data, jobId });
      return jobId ?? name;
    },
  });
  t.after(async () => {
    await app.close();
    await harness.close();
  });

  const emptyPayload = inboundPayload("msg-content-fill");
  emptyPayload.message.text = null;
  emptyPayload.raw_event = { Message: { senderKeyDistributionMessage: { groupID: "group-123" } } };
  const contentPayload = inboundPayload("msg-content-fill");
  contentPayload.message.text = "actual text";

  const firstResponse = await app.inject({
    method: "POST",
    url: "/gateway/inbound",
    payload: emptyPayload,
  });
  const secondResponse = await app.inject({
    method: "POST",
    url: "/gateway/inbound",
    payload: contentPayload,
  });

  assert.equal(firstResponse.statusCode, 202);
  assert.equal(secondResponse.statusCode, 202);
  assert.equal(secondResponse.json().deduped, false);

  const versions = await harness.db.select().from(messageVersions);
  assert.equal(versions.length, 2);
  assert.equal(versions.some((version) => version.textContent === "actual text"), true);
});

test("contract: gateway inbound strips closing URL delimiters", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  const app = await buildServer({
    db: harness.db,
    enqueueJob: async (name, data, jobId) => {
      harness.jobs.push({ name, data, jobId });
      return jobId ?? name;
    },
  });
  t.after(async () => {
    await app.close();
    await harness.close();
  });

  const payload = inboundPayload("msg-url-delimiter");
  payload.message.text = "Please read https://example.com/path] before replying.";

  const response = await app.inject({
    method: "POST",
    url: "/gateway/inbound",
    payload,
  });

  assert.equal(response.statusCode, 202);
  const [link] = await harness.db.select().from(messageLinks).limit(1);
  assert.ok(link);
  assert.equal(link.url, "https://example.com/path");
  assert.equal(link.normalizedUrl, "https://example.com/path");
});

test("contract: gateway outbound status persists dispatch status", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  const app = await buildServer({ db: harness.db });
  t.after(async () => {
    await app.close();
    await harness.close();
  });

  const outboundIntentId = randomUUID();
  await harness.db.insert(outboundIntents).values({
    outboundIntentId,
    providerGroupId: "group-123",
    status: "pending",
    attemptCount: 0,
    payload: { kind: "reply", _dispatch: { last_status: "pending" } },
  });

  const payload = {
    trace_id: randomUUID(),
    outbound_intent_id: outboundIntentId,
    status: "sent",
    provider_message_id: "msg-456",
    error_code: null,
    error_message: null,
    occurred_at: new Date().toISOString(),
  };
  const response = await app.inject({
    method: "POST",
    url: "/gateway/outbound/status",
    payload,
  });

  assert.equal(response.statusCode, 202);
  assert.equal(response.json().accepted, true);
  assert.equal(response.json().found, true);

  const [storedIntent] = await harness.db
    .select()
    .from(outboundIntents)
    .where(eq(outboundIntents.outboundIntentId, outboundIntentId))
    .limit(1);

  assert.ok(storedIntent);
  assert.equal(storedIntent.status, "sent");
  const dispatch = (storedIntent.payload as { _dispatch: Record<string, unknown> })._dispatch;
  assert.equal(dispatch.last_status, "sent");
  assert.equal(dispatch.provider_message_id, "msg-456");
  assert.equal(dispatch.last_error_code, null);
  assert.equal(dispatch.last_error_message, null);
});
