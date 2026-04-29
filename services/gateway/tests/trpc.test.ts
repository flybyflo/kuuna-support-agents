import assert from "node:assert/strict";
import test from "node:test";

import { TRPCError } from "@trpc/server";

import { createGatewayRouter } from "../src/trpc.js";
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
    async listGroupParticipants() {
      return [
        {
          jid: "43664111222@s.whatsapp.net",
          phone: "43664111222",
          display_name: "Client One",
          is_admin: false,
          is_self: false,
          metadata: { admin: null, lid: null },
        },
      ];
    },
    selfIdentity() {
      return {
        jid: "43664000000@s.whatsapp.net",
        phone: "43664000000",
        display_name: "Kuuna Bot",
        metadata: {},
      };
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

function caller(input: { opsToken?: string | null; serviceToken?: string | null; headers?: Headers }) {
  return createGatewayRouter({
    client: fakeClient(),
    opsToken: input.opsToken ?? null,
    serviceToken: input.serviceToken ?? null,
  }).createCaller({ headers: input.headers ?? new Headers() });
}

test("ops groups require tRPC token", async () => {
  await assert.rejects(
    caller({ opsToken: "secret" }).ops.groups(),
    (error) => error instanceof TRPCError && error.code === "FORBIDDEN",
  );
});

test("ops groups return name and jid over tRPC", async () => {
  const result = await caller({ opsToken: "secret", headers: new Headers({ "x-internal-token": "secret" }) }).ops.groups();

  assert.deepEqual(result.items, [
    { jid: "120363000000000@g.us", name: "Support Team", participants_count: 3 },
  ]);
});

test("ops group participants return WhatsApp identity details over tRPC", async () => {
  const result = await caller({
    opsToken: "secret",
    headers: new Headers({ "x-internal-token": "secret" }),
  }).ops.groupParticipants({ providerGroupId: "120363000000000@g.us" });

  assert.deepEqual(result.items, [
    {
      jid: "43664111222@s.whatsapp.net",
      phone: "43664111222",
      display_name: "Client One",
      is_admin: false,
      is_self: false,
      metadata: { admin: null, lid: null },
    },
  ]);
});

test("ops self identity returns bot WhatsApp identity over tRPC", async () => {
  const result = await caller({
    opsToken: "secret",
    headers: new Headers({ "x-internal-token": "secret" }),
  }).ops.selfIdentity();

  assert.equal(result.jid, "43664000000@s.whatsapp.net");
  assert.equal(result.phone, "43664000000");
});

test("connection and qr status return tracker snapshots over tRPC", async () => {
  const api = caller({ opsToken: "secret", headers: new Headers({ "x-internal-token": "secret" }) });

  const connection = await api.ops.connection();
  const qr = await api.ops.qr();

  assert.equal(connection.connected, true);
  assert.equal(qr.qr, "qr-code");
});

test("create group normalizes participants over tRPC", async () => {
  const result = await caller({ opsToken: "secret", headers: new Headers({ "x-internal-token": "secret" }) }).ops.createGroup({
    name: "Ops Escalations",
    participants: ["+43664111222", "43664111333@s.whatsapp.net"],
  });

  assert.equal(result.group.jid, "120363999999999@g.us");
  assert.equal(result.group.participants_count, 2);
});

test("gateway outbound sends message and returns provider message id over tRPC", async () => {
  const client = fakeClient();
  const api = createGatewayRouter({ client, serviceToken: null, opsToken: null }).createCaller({ headers: new Headers() });

  const result = await api.outbound.sendText({
    trace_id: "trace-1",
    outbound_intent_id: "intent-1",
    provider_group_id: "120363000000000@g.us",
    text: "Hello from Kuuna",
    metadata: {},
  });

  assert.equal(result.provider_message_id, "provider-msg-123");
  assert.deepEqual(client.sent, [{ providerGroupId: "120363000000000@g.us", text: "Hello from Kuuna" }]);
});

test("gateway outbound requires service token over tRPC when configured", async () => {
  await assert.rejects(
    caller({ serviceToken: "service-secret" }).outbound.sendText({
      trace_id: "trace-1",
      outbound_intent_id: "intent-1",
      provider_group_id: "120363000000000@g.us",
      text: "Hello from Kuuna",
      metadata: {},
    }),
    (error) => error instanceof TRPCError && error.code === "FORBIDDEN",
  );
});
