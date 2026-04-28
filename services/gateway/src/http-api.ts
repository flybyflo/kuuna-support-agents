import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { GatewayClient } from "./types.js";

const outboundRequestSchema = z.object({
  trace_id: z.string().min(1).max(120),
  outbound_intent_id: z.string().min(1).max(120),
  provider_group_id: z.string().min(1).max(255),
  reply_to_provider_message_id: z.string().nullable().optional(),
  text: z.string().min(1).max(8000),
  metadata: z.record(z.unknown()).default({}),
});

const createGroupSchema = z.object({
  name: z.string().min(1).max(120),
  participants: z.array(z.string()).default([]),
});

export function registerHttpApi(
  app: FastifyInstance,
  input: {
    client: GatewayClient;
    opsToken?: string | null;
    serviceToken?: string | null;
  },
): void {
  app.get("/healthz", async () => ({ status: "ok" }));

  app.get("/ops/groups", async (request, reply) => {
    requireOpsToken(headerValue(request.headers["x-internal-token"]), input.opsToken);
    try {
      const items = await input.client.listGroups();
      return { items };
    } catch (error) {
      return reply.code(502).send({
        detail: `failed to list WhatsApp groups: ${errorMessage(error)}`,
      });
    }
  });

  app.get("/ops/connection", async (request) => {
    requireOpsToken(headerValue(request.headers["x-internal-token"]), input.opsToken);
    return input.client.connectionSnapshot();
  });

  app.get("/ops/qr", async (request) => {
    requireOpsToken(headerValue(request.headers["x-internal-token"]), input.opsToken);
    return input.client.qrSnapshot();
  });

  app.post("/ops/groups", async (request, reply) => {
    requireOpsToken(headerValue(request.headers["x-internal-token"]), input.opsToken);
    const payload = createGroupSchema.parse(request.body);
    try {
      const group = await input.client.createGroup(
        payload.name.trim(),
        payload.participants.map(normalizeParticipantJid),
      );
      return { ok: true, group };
    } catch (error) {
      return reply.code(502).send({
        detail: `failed to create WhatsApp group: ${errorMessage(error)}`,
      });
    }
  });

  app.post("/gateway/outbound", async (request, reply) => {
    requireServiceToken(headerValue(request.headers.authorization), input.serviceToken);
    const payload = outboundRequestSchema.parse(request.body);

    try {
      const providerMessageId = await input.client.sendText({
        providerGroupId: payload.provider_group_id,
        text: payload.text,
        replyToProviderMessageId: payload.reply_to_provider_message_id ?? null,
      });
      return {
        accepted: true,
        trace_id: payload.trace_id,
        outbound_intent_id: payload.outbound_intent_id,
        provider_group_id: payload.provider_group_id,
        provider_message_id: providerMessageId,
      };
    } catch (error) {
      return reply.code(502).send({
        detail: `outbound send failed: ${errorMessage(error)}`,
      });
    }
  });
}

function requireOpsToken(token: string | null, expected: string | null | undefined): void {
  if (!expected) {
    throw httpError(503, "gateway ops token not configured");
  }
  if (token !== expected) {
    throw httpError(403, "invalid gateway ops token");
  }
}

function requireServiceToken(authorization: string | null, expected: string | null | undefined): void {
  if (!expected) return;
  const token = extractBearerToken(authorization);
  if (token !== expected) {
    throw httpError(403, "invalid gateway service token");
  }
}

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

function extractBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const prefix = "bearer ";
  if (!authorization.toLowerCase().startsWith(prefix)) return null;
  return authorization.slice(prefix.length).trim() || null;
}

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function normalizeParticipantJid(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("participant jid is empty");
  if (normalized.includes("@")) {
    const [user, server] = normalized.split("@", 2);
    const cleanUser = user?.trim().replace(/^\+/, "");
    const cleanServer = server?.trim();
    if (!cleanUser || !cleanServer) throw new Error(`invalid participant jid: ${value}`);
    return `${cleanUser}@${cleanServer}`;
  }
  const digits = normalized.replace(/[^0-9]/g, "");
  if (!digits) throw new Error(`invalid participant phone: ${value}`);
  return `${digits}@s.whatsapp.net`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
