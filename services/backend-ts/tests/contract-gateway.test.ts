import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { eq } from "drizzle-orm";
import type { GatewayInboundEvent, GatewayOutboundStatusEvent } from "@kuuna/contracts";

import { outboundIntents, messageLinks, messageVersions, todos } from "../src/db/schema.js";
import { parseRuntimeChatTask } from "../src/jobs/queues.js";
import { contractDatabaseUrl, createContractHarness } from "./contract-harness.js";

const skipReason = contractDatabaseUrl
  ? false
  : "set BACKEND_TS_CONTRACT_DATABASE_URL to run backend-ts contract tests";

function inboundPayload(
  messageId: string,
  eventType: GatewayInboundEvent["event_type"] = "message_created",
): GatewayInboundEvent {
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
  const caller = await harness.caller();
  t.after(async () => {
    await harness.close();
  });

  const payload = inboundPayload("msg-123");
  const response = await caller.gateway.inbound.ingest(payload);

  assert.equal(response.accepted, true);
  assert.equal(response.trace_id, payload.trace_id);
  assert.equal(response.deduped, false);

  const [storedVersion] = await harness.db.select().from(messageVersions).limit(1);
  assert.ok(storedVersion);
  assert.equal((storedVersion.rawEvent as Record<string, { kind?: string }>).provider_payload.kind, "MessageEv");
  assert.deepEqual(
    harness.jobs.map((job) => job.name),
    ["retrieval_indexing", "runtime_chat_queue"],
  );
  assert.equal(harness.jobs[1]?.data.provider_group_id, payload.provider_group_id);
  assert.equal(harness.jobs[1]?.data.queued_task, undefined);
  assert.equal(parseRuntimeChatTask(harness.runtimeChatTasks[0]).name, "passive_message_analysis");
});

test("contract: gateway inbound dedupes duplicate created event", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  const caller = await harness.caller();
  t.after(async () => {
    await harness.close();
  });

  const firstResponse = await caller.gateway.inbound.ingest(inboundPayload("msg-dedupe"));
  const secondResponse = await caller.gateway.inbound.ingest(inboundPayload("msg-dedupe"));

  assert.equal(firstResponse.deduped, false);
  assert.equal(secondResponse.deduped, true);
});

test("contract: gateway inbound fills a contentless duplicate created event", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  const caller = await harness.caller();
  t.after(async () => {
    await harness.close();
  });

  const emptyPayload = inboundPayload("msg-content-fill");
  emptyPayload.message.text = null;
  emptyPayload.raw_event = { Message: { senderKeyDistributionMessage: { groupID: "group-123" } } };
  const contentPayload = inboundPayload("msg-content-fill");
  contentPayload.message.text = "actual text";

  const firstResponse = await caller.gateway.inbound.ingest(emptyPayload);
  const secondResponse = await caller.gateway.inbound.ingest(contentPayload);

  assert.equal(firstResponse.accepted, true);
  assert.equal(secondResponse.accepted, true);
  assert.equal(secondResponse.deduped, false);

  const versions = await harness.db.select().from(messageVersions);
  assert.equal(versions.length, 2);
  assert.equal(versions.some((version) => version.textContent === "actual text"), true);
});

test("contract: gateway inbound strips closing URL delimiters", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  const caller = await harness.caller();
  t.after(async () => {
    await harness.close();
  });

  const payload = inboundPayload("msg-url-delimiter");
  payload.message.text = "Please read https://example.com/path] before replying.";

  const response = await caller.gateway.inbound.ingest(payload);

  assert.equal(response.accepted, true);
  const [link] = await harness.db.select().from(messageLinks).limit(1);
  assert.ok(link);
  assert.equal(link.url, "https://example.com/path");
  assert.equal(link.normalizedUrl, "https://example.com/path");
  const [todo] = await harness.db.select().from(todos).limit(1);
  assert.ok(todo);
  assert.equal(todo.title, "Review shared link");
  assert.equal(todo.messageId, link.messageId);
});

test("contract: gateway outbound status persists dispatch status", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  const caller = await harness.caller();
  t.after(async () => {
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

  const payload: GatewayOutboundStatusEvent = {
    trace_id: randomUUID(),
    outbound_intent_id: outboundIntentId,
    status: "sent",
    provider_message_id: "msg-456",
    error_code: null,
    error_message: null,
    occurred_at: new Date().toISOString(),
  };
  const response = await caller.gateway.outbound.status(payload);

  assert.equal(response.accepted, true);
  assert.equal(response.found, true);

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
