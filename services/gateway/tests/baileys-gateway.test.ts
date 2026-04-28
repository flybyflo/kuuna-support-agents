import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { BackendIngestClient } from "../src/backend.js";
import { BaileysGateway } from "../src/baileys-gateway.js";
import { GatewayConnectionStatus, GatewayQrStatus } from "../src/status.js";

type Handler = (...args: never[]) => void;

class FakeSocket {
  ev = new EventEmitter();
  sent: Array<{ jid: string; content: unknown }> = [];
  ended = false;

  async groupFetchAllParticipating() {
    return {
      "120363000000000@g.us": {
        id: "120363000000000@g.us",
        subject: "Support Team",
        participants: [{ id: "1@s.whatsapp.net" }, { id: "2@s.whatsapp.net" }],
      },
    };
  }

  async groupCreate(subject: string, participants: string[]) {
    return { id: "120363999999999@g.us", subject, participants: participants.map((id) => ({ id })) };
  }

  async sendMessage(jid: string, content: unknown) {
    this.sent.push({ jid, content });
    return { key: { id: "provider-msg-123" } };
  }

  end() {
    this.ended = true;
  }
}

function fakeBaileys(socket: FakeSocket) {
  return {
    DisconnectReason: { loggedOut: 401 },
    Browsers: { appropriate: () => ["Kuuna", "Chrome", "1.0"] },
    makeCacheableSignalKeyStore: (keys: unknown) => keys,
    useMultiFileAuthState: async () => ({
      state: { creds: {}, keys: {} },
      saveCreds: async () => undefined,
    }),
    fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 0], isLatest: true }),
    makeWASocket: () => socket,
  };
}

function makeGateway(socket: FakeSocket, calls: unknown[], overrides: Partial<ConstructorParameters<typeof BaileysGateway>[0]> = {}) {
  const connectionStatus = new GatewayConnectionStatus();
  const qrStatus = new GatewayQrStatus();
  const backendClient = new BackendIngestClient({
    backendBaseUrl: "http://backend.test",
    httpClient: async (_url, init) => {
      calls.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response("{}", { status: 202 });
    },
  });

  return new BaileysGateway({
    authDir: "/tmp/auth",
    sessionName: "kuuna-gateway",
    printQrToConsole: false,
    backendClient,
    connectionStatus,
    qrStatus,
    baileysModule: fakeBaileys(socket) as never,
    ...overrides,
  });
}

test("tracks QR and connection status", async () => {
  const socket = new FakeSocket();
  const calls: unknown[] = [];
  const rendered: string[] = [];
  const gateway = makeGateway(socket, calls, {
    printQrToConsole: true,
    qrRenderer: (qr) => rendered.push(qr),
  });

  await gateway.start();
  socket.ev.emit("connection.update", { qr: "qr-code" });
  assert.equal(gateway.qrSnapshot().qr, "qr-code");
  assert.equal(gateway.connectionSnapshot().last_event, "qr");
  assert.equal(gateway.connectionSnapshot().last_error?.includes("pairing required"), true);
  assert.deepEqual(rendered, ["qr-code"]);

  socket.ev.emit("connection.update", { connection: "open" });
  assert.equal(gateway.connectionSnapshot().connected, true);
  assert.equal(gateway.qrSnapshot().qr, null);
});

test("forwards inbound messages and skips self messages", async () => {
  const socket = new FakeSocket();
  const calls: unknown[] = [];
  const gateway = makeGateway(socket, calls);

  await gateway.start();
  socket.ev.emit("messages.upsert", {
    messages: [
      {
        key: { id: "self", remoteJid: "1203630-group@g.us", fromMe: true },
        message: { conversation: "ignore me" },
      },
      {
        key: {
          id: "msg-1",
          remoteJid: "1203630-group@g.us",
          participant: "4912345@s.whatsapp.net",
          fromMe: false,
        },
        messageTimestamp: 1776506400,
        message: { conversation: "hello" },
      },
    ],
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.length, 1);
  assert.equal((calls[0] as Record<string, unknown>).provider_message_id, "msg-1");
});

test("group and outbound methods delegate to socket", async () => {
  const socket = new FakeSocket();
  const calls: unknown[] = [];
  const gateway = makeGateway(socket, calls);

  await gateway.start();
  const groups = await gateway.listGroups();
  const created = await gateway.createGroup("Ops", ["1@s.whatsapp.net"]);
  const providerMessageId = await gateway.sendText({
    providerGroupId: "120363000000000@g.us",
    text: "Hello",
  });

  assert.equal(groups[0]?.name, "Support Team");
  assert.equal(created.participants_count, 1);
  assert.equal(providerMessageId, "provider-msg-123");
  assert.deepEqual(socket.sent, [{ jid: "120363000000000@g.us", content: { text: "Hello" } }]);
});

test("logged out close does not reconnect", async () => {
  const socket = new FakeSocket();
  const calls: unknown[] = [];
  const gateway = makeGateway(socket, calls);

  await gateway.start();
  socket.ev.emit("connection.update", {
    connection: "close",
    lastDisconnect: { error: { output: { statusCode: 401 }, message: "logged out" } },
  });

  assert.equal(gateway.connectionSnapshot().last_event, "logged_out");
});
