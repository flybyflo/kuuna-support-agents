import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { eq } from "drizzle-orm";

import { outboundIntents } from "../src/db/schema.js";
import {
  OutboundDispatchRetryableError,
  processOutboundDispatchJob,
} from "../src/jobs/outbound-dispatch.js";
import { contractDatabaseUrl, createContractHarness } from "./contract-harness.js";

const skipReason = contractDatabaseUrl
  ? false
  : "set BACKEND_TS_CONTRACT_DATABASE_URL to run backend-ts contract tests";

test("contract: outbound dispatch sent response marks intent sent", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());

  const outboundIntentId = randomUUID();
  await harness.db.insert(outboundIntents).values({
    outboundIntentId,
    providerGroupId: "group-outbound@g.us",
    status: "pending",
    attemptCount: 0,
    payload: {
      kind: "reply",
      text: "hello",
      trace_id: "trace-outbound",
      _dispatch: { last_status: "pending" },
    },
  });

  const result = await processOutboundDispatchJob(
    harness.db,
    { outboundIntentId },
    {
      gatewaySender: async () => ({ provider_message_id: "provider-msg-1", accepted: true }),
      gatewayBaseUrl: "http://gateway.test",
    },
  );

  assert.deepEqual(result, { dispatched: true, status: "sent" });
  const stored = await findIntent(harness, outboundIntentId);
  assert.equal(stored.status, "sent");
  assert.equal(stored.attemptCount, 1);
  const dispatch = dispatchPayload(stored.payload);
  assert.equal(dispatch.last_status, "sent");
  assert.equal(dispatch.provider_message_id, "provider-msg-1");
  assert.deepEqual(dispatch.last_response, { provider_message_id: "provider-msg-1", accepted: true });
});

test("contract: transient outbound response with retry keeps sending and marks retrying", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());

  const outboundIntentId = randomUUID();
  await harness.db.insert(outboundIntents).values({
    outboundIntentId,
    providerGroupId: "group-outbound@g.us",
    status: "pending",
    attemptCount: 0,
    payload: { kind: "reply", _dispatch: { last_status: "pending" } },
  });

  await assert.rejects(
    () =>
      processOutboundDispatchJob(
        harness.db,
        { outboundIntentId },
        {
          retryAvailable: true,
          retryInSeconds: 30,
          gatewaySender: async () => {
            throw new Error("rate limited");
          },
        },
      ),
    OutboundDispatchRetryableError,
  );

  const stored = await findIntent(harness, outboundIntentId);
  assert.equal(stored.status, "sending");
  assert.equal(stored.attemptCount, 1);
  const dispatch = dispatchPayload(stored.payload);
  assert.equal(dispatch.last_status, "retrying");
  assert.equal(dispatch.last_error_code, "gateway_transport_error");
  assert.equal(dispatch.next_retry_in_seconds, 30);
});

test("contract: non-transient outbound response marks intent failed", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());

  const outboundIntentId = randomUUID();
  await harness.db.insert(outboundIntents).values({
    outboundIntentId,
    providerGroupId: "group-outbound@g.us",
    status: "pending",
    attemptCount: 0,
    payload: { kind: "reply", _dispatch: { last_status: "pending" } },
  });

  const result = await processOutboundDispatchJob(
    harness.db,
    { outboundIntentId },
    {
      gatewaySender: async () => {
        throw new Error("bad request");
      },
    },
  ).catch(() => ({ dispatched: false, status: "failed" as const }));

  assert.deepEqual(result, { dispatched: false, status: "failed" });
  const stored = await findIntent(harness, outboundIntentId);
  assert.equal(stored.status, "failed");
  const dispatch = dispatchPayload(stored.payload);
  assert.equal(dispatch.last_status, "failed");
  assert.equal(dispatch.last_error_code, "gateway_http_400");
});

test("contract: invalid or unknown outbound intent mutates nothing", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());

  assert.deepEqual(
    await processOutboundDispatchJob(harness.db, { outboundIntentId: "not-a-uuid" }),
    { dispatched: false, status: "invalid" },
  );
  assert.deepEqual(
    await processOutboundDispatchJob(harness.db, { outboundIntentId: randomUUID() }),
    { dispatched: false, status: "not_found" },
  );

  const rows = await harness.db.select().from(outboundIntents);
  assert.equal(rows.length, 0);
});

async function findIntent(harness: Awaited<ReturnType<typeof createContractHarness>>, outboundIntentId: string) {
  const [stored] = await harness.db
    .select()
    .from(outboundIntents)
    .where(eq(outboundIntents.outboundIntentId, outboundIntentId))
    .limit(1);
  assert.ok(stored);
  return stored;
}

function dispatchPayload(payload: unknown): Record<string, unknown> {
  assert.ok(payload && typeof payload === "object" && !Array.isArray(payload));
  const dispatch = (payload as Record<string, unknown>)._dispatch;
  assert.ok(dispatch && typeof dispatch === "object" && !Array.isArray(dispatch));
  return dispatch as Record<string, unknown>;
}
