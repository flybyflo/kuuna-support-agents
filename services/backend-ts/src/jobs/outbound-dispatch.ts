import { eq } from "drizzle-orm";
import type { GatewayRouter } from "@kuuna/gateway/trpc";
import { createTRPCClient, httpLink, TRPCClientError } from "@trpc/client";
import { gatewayOutboundIntentSchema } from "@kuuna/contracts";

import { getSettings } from "../config.js";
import type { DbLike } from "../db/client.js";
import { outboundIntents } from "../db/schema.js";
import { logger } from "../logging.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class OutboundDispatchError extends Error {}
export class OutboundDispatchRetryableError extends OutboundDispatchError {}

type GatewaySender = (gatewayBaseUrl: string, payload: Record<string, unknown>, input: {
  serviceToken: string | null;
  timeoutSeconds: number;
}) => Promise<Record<string, unknown>>;

export async function processOutboundDispatchJob(
  database: DbLike,
  input: { outboundIntentId: string },
  options: {
    gatewaySender?: GatewaySender;
    retryAvailable?: boolean;
    retryInSeconds?: number | null;
    gatewayBaseUrl?: string;
    serviceToken?: string | null;
    timeoutSeconds?: number;
  } = {},
): Promise<{ dispatched: boolean; status: "sent" | "failed" | "retrying" | "already_sent" | "not_found" | "invalid" }> {
  if (!uuidPattern.test(input.outboundIntentId)) {
    logger.error("outbound_dispatch_invalid_intent_id", { outbound_intent_id: input.outboundIntentId });
    return { dispatched: false, status: "invalid" };
  }

  const [intent] = await database
    .select()
    .from(outboundIntents)
    .where(eq(outboundIntents.outboundIntentId, input.outboundIntentId))
    .limit(1);
  if (!intent) {
    logger.warn("outbound_intent_not_found", { outbound_intent_id: input.outboundIntentId });
    return { dispatched: false, status: "not_found" };
  }

  const traceId = traceIdFromPayload(intent.payload);
  if (intent.status === "sent") {
    logger.info("outbound_intent_already_sent", {
      trace_id: traceId,
      outbound_intent_id: input.outboundIntentId,
      status: intent.status,
    });
    return { dispatched: false, status: "already_sent" };
  }

  const sending = await markOutboundIntentSending(database, input.outboundIntentId);
  if (!sending) {
    return { dispatched: false, status: "not_found" };
  }

  const settings = getSettings();
  const gatewayBaseUrl = (options.gatewayBaseUrl ?? settings.GATEWAY_BASE_URL).replace(/\/$/, "");
  const serviceToken = options.serviceToken ?? settings.GATEWAY_SERVICE_TOKEN ?? null;
  const timeoutSeconds = options.timeoutSeconds ?? settings.OUTBOUND_DISPATCH_TIMEOUT_SECONDS;

  try {
    const responsePayload = await (options.gatewaySender ?? sendGatewayOutboundViaTrpc)(gatewayBaseUrl, objectPayload(sending.payload), {
      serviceToken,
      timeoutSeconds,
    });
    const providerMessageId = extractProviderMessageId(responsePayload);

    await markOutboundIntentSent(database, input.outboundIntentId, {
      providerMessageId,
      responsePayload,
    });
    logger.info("outbound_intent_dispatched", {
      trace_id: traceId,
      outbound_intent_id: input.outboundIntentId,
      provider_group_id: sending.providerGroupId,
      provider_message_id: providerMessageId,
    });
    return { dispatched: true, status: "sent" };
  } catch (error) {
    if (error instanceof OutboundDispatchError) {
      throw error;
    }

    if (options.retryAvailable) {
      await markOutboundIntentRetrying(database, input.outboundIntentId, {
        errorCode: "gateway_transport_error",
        errorMessage: error instanceof Error ? error.message : String(error),
        retryInSeconds: options.retryInSeconds ?? null,
      });
      throw new OutboundDispatchRetryableError(`gateway transport failed for outbound intent ${input.outboundIntentId}`);
    }

    await markOutboundIntentFailed(database, input.outboundIntentId, {
      errorCode: "gateway_transport_error",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw new OutboundDispatchError(`gateway transport failed for outbound intent ${input.outboundIntentId}`);
  }
}

async function sendGatewayOutboundViaTrpc(
  gatewayBaseUrl: string,
  payload: Record<string, unknown>,
  input: { serviceToken: string | null; timeoutSeconds: number },
): Promise<Record<string, unknown>> {
  const client = createTRPCClient<GatewayRouter>({
    links: [
      httpLink({
        url: `${gatewayBaseUrl.replace(/\/$/, "")}/trpc`,
        headers: input.serviceToken ? { Authorization: `Bearer ${input.serviceToken}` } : {},
        fetch(url, init) {
          return fetch(url, {
            ...init,
            signal: AbortSignal.timeout(input.timeoutSeconds * 1000),
          });
        },
      }),
    ],
  });
  try {
    return objectPayload(await client.outbound.sendText.mutate(gatewayOutboundIntentSchema.parse(payload)));
  } catch (error) {
    if (error instanceof TRPCClientError) {
      throw new Error(`gateway_trpc_error: ${error.message}`);
    }
    throw error;
  }
}

export async function markOutboundIntentSending(database: DbLike, outboundIntentId: string) {
  const [intent] = await database
    .select()
    .from(outboundIntents)
    .where(eq(outboundIntents.outboundIntentId, outboundIntentId))
    .limit(1);
  if (!intent) return null;

  const [updated] = await database
    .update(outboundIntents)
    .set({
      status: "sending",
      attemptCount: intent.attemptCount + 1,
      payload: mergeDispatchMetadata(intent.payload, {
        last_status: "sending",
        last_attempt_at: utcTimestamp(),
        last_error_code: null,
        last_error_message: null,
        next_retry_in_seconds: null,
      }),
      updatedAt: new Date(),
    })
    .where(eq(outboundIntents.outboundIntentId, outboundIntentId))
    .returning();
  return updated ?? null;
}

export async function markOutboundIntentSent(
  database: DbLike,
  outboundIntentId: string,
  input: { providerMessageId?: string | null; responsePayload?: Record<string, unknown> | null },
) {
  return updateDispatch(database, outboundIntentId, "sent", {
    last_status: "sent",
    sent_at: utcTimestamp(),
    provider_message_id: input.providerMessageId ?? null,
    last_error_code: null,
    last_error_message: null,
    last_response: optionalPayload(input.responsePayload),
    next_retry_in_seconds: null,
  });
}

export async function markOutboundIntentRetrying(
  database: DbLike,
  outboundIntentId: string,
  input: {
    errorCode?: string | null;
    errorMessage?: string | null;
    providerMessageId?: string | null;
    responsePayload?: Record<string, unknown> | null;
    retryInSeconds?: number | null;
  },
) {
  return updateDispatch(database, outboundIntentId, "sending", {
    last_status: "retrying",
    retrying_at: utcTimestamp(),
    provider_message_id: input.providerMessageId ?? null,
    last_error_code: input.errorCode ?? null,
    last_error_message: input.errorMessage ?? null,
    last_response: optionalPayload(input.responsePayload),
    next_retry_in_seconds: input.retryInSeconds ?? null,
  });
}

export async function markOutboundIntentFailed(
  database: DbLike,
  outboundIntentId: string,
  input: {
    errorCode?: string | null;
    errorMessage?: string | null;
    providerMessageId?: string | null;
    responsePayload?: Record<string, unknown> | null;
  },
) {
  return updateDispatch(database, outboundIntentId, "failed", {
    last_status: "failed",
    failed_at: utcTimestamp(),
    provider_message_id: input.providerMessageId ?? null,
    last_error_code: input.errorCode ?? null,
    last_error_message: input.errorMessage ?? null,
    last_response: optionalPayload(input.responsePayload),
    next_retry_in_seconds: null,
  });
}

async function updateDispatch(
  database: DbLike,
  outboundIntentId: string,
  status: "sending" | "sent" | "failed",
  updates: Record<string, unknown>,
) {
  const [intent] = await database
    .select()
    .from(outboundIntents)
    .where(eq(outboundIntents.outboundIntentId, outboundIntentId))
    .limit(1);
  if (!intent) return null;

  const [updated] = await database
    .update(outboundIntents)
    .set({
      status,
      payload: mergeDispatchMetadata(intent.payload, updates),
      updatedAt: new Date(),
    })
    .where(eq(outboundIntents.outboundIntentId, outboundIntentId))
    .returning();
  return updated ?? null;
}

function objectPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mergeDispatchMetadata(payload: unknown, updates: Record<string, unknown>): Record<string, unknown> {
  const mergedPayload = payload && typeof payload === "object" && !Array.isArray(payload)
    ? { ...(payload as Record<string, unknown>) }
    : {};
  const dispatch = mergedPayload._dispatch && typeof mergedPayload._dispatch === "object" && !Array.isArray(mergedPayload._dispatch)
    ? { ...(mergedPayload._dispatch as Record<string, unknown>) }
    : {};
  mergedPayload._dispatch = { ...dispatch, ...updates };
  return mergedPayload;
}

function extractProviderMessageId(responsePayload: Record<string, unknown>): string | null {
  for (const key of ["provider_message_id", "message_id", "id"]) {
    const value = responsePayload[key];
    if (typeof value === "string" && value) {
      return value;
    }
  }
  return null;
}

function traceIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const traceId = (payload as Record<string, unknown>).trace_id;
  return typeof traceId === "string" && traceId ? traceId : null;
}

function optionalPayload(payload: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  return payload && Object.keys(payload).length > 0 ? payload : null;
}

function utcTimestamp(): string {
  return new Date().toISOString();
}
