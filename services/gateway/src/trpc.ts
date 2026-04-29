import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import { gatewayOutboundIntentSchema } from "@kuuna/contracts";

import type { GatewayClient } from "./types.js";

const t = initTRPC.context<{ headers: Headers }>().create();

const createGroupSchema = z.object({
  name: z.string().min(1).max(120),
  participants: z.array(z.string()).default([]),
});

const groupParticipantsSchema = z.object({
  providerGroupId: z.string().trim().min(1).max(255),
});

export function createGatewayRouter(input: {
  client: GatewayClient;
  opsToken?: string | null;
  serviceToken?: string | null;
}) {
  const opsProcedure = t.procedure.use(({ ctx, next }) => {
    requireOpsToken(ctx.headers.get("x-internal-token"), input.opsToken);
    return next();
  });
  const serviceProcedure = t.procedure.use(({ ctx, next }) => {
    requireServiceToken(ctx.headers.get("authorization"), input.serviceToken);
    return next();
  });

  return t.router({
    health: t.procedure.query(() => ({ status: "ok" as const })),
    ops: t.router({
      groups: opsProcedure.query(async () => ({ items: await input.client.listGroups() })),
      selfIdentity: opsProcedure.query(() => input.client.selfIdentity()),
      groupParticipants: opsProcedure.input(groupParticipantsSchema).query(async ({ input: payload }) => ({
        items: await input.client.listGroupParticipants(payload.providerGroupId),
      })),
      connection: opsProcedure.query(() => input.client.connectionSnapshot()),
      qr: opsProcedure.query(() => input.client.qrSnapshot()),
      createGroup: opsProcedure.input(createGroupSchema).mutation(async ({ input: payload }) => ({
        ok: true,
        group: await input.client.createGroup(
          payload.name.trim(),
          payload.participants.map(normalizeParticipantJid),
        ),
      })),
    }),
    outbound: t.router({
      sendText: serviceProcedure.input(gatewayOutboundIntentSchema).mutation(async ({ input: payload }) => ({
        accepted: true,
        trace_id: payload.trace_id,
        outbound_intent_id: payload.outbound_intent_id,
        provider_group_id: payload.provider_group_id,
        provider_message_id: await input.client.sendText({
          providerGroupId: payload.provider_group_id,
          text: payload.text,
          replyToProviderMessageId: payload.reply_to_provider_message_id ?? null,
        }),
      })),
    }),
  });
}

export type GatewayRouter = ReturnType<typeof createGatewayRouter>;

function requireOpsToken(token: string | null, expected: string | null | undefined): void {
  if (!expected) {
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "gateway ops token not configured" });
  }
  if (token !== expected) {
    throw new TRPCError({ code: "FORBIDDEN", message: "invalid gateway ops token" });
  }
}

function requireServiceToken(authorization: string | null, expected: string | null | undefined): void {
  if (!expected) return;
  const token = extractBearerToken(authorization);
  if (token !== expected) {
    throw new TRPCError({ code: "FORBIDDEN", message: "invalid gateway service token" });
  }
}

function extractBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const prefix = "bearer ";
  if (!authorization.toLowerCase().startsWith(prefix)) return null;
  return authorization.slice(prefix.length).trim() || null;
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
