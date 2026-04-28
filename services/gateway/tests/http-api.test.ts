import assert from "node:assert/strict";
import test from "node:test";

import { resetSettingsForTests } from "../src/config.js";
import { buildServer } from "../src/server.js";
import type { GatewayClient } from "../src/types.js";

function fakeClient(): GatewayClient & { sent: Array<{ providerGroupId: string; text: string }> } {
  const sent: Array<{ providerGroupId: string; text: string }> = [];
  return {
    sent,
    async start() {},
    async stop() {},
    async listGroups() {
      return [{ jid: "120363000000000@g.us", name: "Support Team", participants_count: 3 }];
    },
    async createGroup(name, participants) {
      return { jid: "120363999999999@g.us", name, participants_count: participants.length };
    },
    async sendText(input) {
      sent.push({ providerGroupId: input.providerGroupId, text: input.text });
      return "provider-msg-123";
    },
    connectionSnapshot() {
      return {
        connected: true,
        last_event: "connected",
        last_changed_at: "2026-04-18T14:00:00.000Z",
        checked_at: "2026-04-18T14:00:15.000Z",
        last_error: null,
      };
    },
    qrSnapshot() {
      return { qr: "qr-code", updated_at: "2026-04-18T14:00:00.000Z" };
    },
  };
}

test("ops groups require token", async (t) => {
  process.env.GATEWAY_OPS_TOKEN = "secret";
  delete process.env.GATEWAY_SERVICE_TOKEN;
  resetSettingsForTests();
  const app = await buildServer({ client: fakeClient() });
  t.after(async () => app.close());

  const response = await app.inject({ method: "GET", url: "/ops/groups" });
  assert.equal(response.statusCode, 403);
});

test("ops groups return name and jid", async (t) => {
  process.env.GATEWAY_OPS_TOKEN = "secret";
  delete process.env.GATEWAY_SERVICE_TOKEN;
  resetSettingsForTests();
  const app = await buildServer({ client: fakeClient() });
  t.after(async () => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/ops/groups",
    headers: { "X-Internal-Token": "secret" },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().items, [
    { jid: "120363000000000@g.us", name: "Support Team", participants_count: 3 },
  ]);
});

test("connection and qr status return tracker snapshots", async (t) => {
  process.env.GATEWAY_OPS_TOKEN = "secret";
  delete process.env.GATEWAY_SERVICE_TOKEN;
  resetSettingsForTests();
  const app = await buildServer({ client: fakeClient() });
  t.after(async () => app.close());

  const connection = await app.inject({
    method: "GET",
    url: "/ops/connection",
    headers: { "X-Internal-Token": "secret" },
  });
  const qr = await app.inject({
    method: "GET",
    url: "/ops/qr",
    headers: { "X-Internal-Token": "secret" },
  });

  assert.equal(connection.statusCode, 200);
  assert.equal(connection.json().connected, true);
  assert.equal(qr.statusCode, 200);
  assert.equal(qr.json().qr, "qr-code");
});

test("create group normalizes participants", async (t) => {
  process.env.GATEWAY_OPS_TOKEN = "secret";
  delete process.env.GATEWAY_SERVICE_TOKEN;
  resetSettingsForTests();
  const app = await buildServer({ client: fakeClient() });
  t.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/ops/groups",
    headers: { "X-Internal-Token": "secret" },
    payload: {
      name: "Ops Escalations",
      participants: ["+43664111222", "43664111333@s.whatsapp.net"],
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().group.jid, "120363999999999@g.us");
  assert.equal(response.json().group.participants_count, 2);
});

test("gateway outbound sends message and returns provider message id", async (t) => {
  delete process.env.GATEWAY_SERVICE_TOKEN;
  resetSettingsForTests();
  const client = fakeClient();
  const app = await buildServer({ client });
  t.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/gateway/outbound",
    payload: {
      trace_id: "trace-1",
      outbound_intent_id: "intent-1",
      provider_group_id: "120363000000000@g.us",
      text: "Hello from Kuuna",
      metadata: {},
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().provider_message_id, "provider-msg-123");
  assert.deepEqual(client.sent, [{ providerGroupId: "120363000000000@g.us", text: "Hello from Kuuna" }]);
});

test("gateway outbound requires service token when configured", async (t) => {
  process.env.GATEWAY_SERVICE_TOKEN = "service-secret";
  resetSettingsForTests();
  const app = await buildServer({ client: fakeClient() });
  t.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/gateway/outbound",
    payload: {
      trace_id: "trace-1",
      outbound_intent_id: "intent-1",
      provider_group_id: "120363000000000@g.us",
      text: "Hello from Kuuna",
      metadata: {},
    },
  });

  assert.equal(response.statusCode, 403);
  delete process.env.GATEWAY_SERVICE_TOKEN;
});
