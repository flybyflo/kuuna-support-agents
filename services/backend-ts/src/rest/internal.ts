import type { FastifyInstance } from "fastify";

import { getSettings } from "../config.js";

function requireInternalToken(header: string | undefined): void {
  const expected = getSettings().INTERNAL_OPS_TOKEN;
  if (!expected) {
    const error = new Error("internal ops token not configured");
    Object.assign(error, { statusCode: 503 });
    throw error;
  }
  if (header !== expected) {
    const error = new Error("invalid internal ops token");
    Object.assign(error, { statusCode: 403 });
    throw error;
  }
}

export function registerInternalRoutes(app: FastifyInstance): void {
  app.post("/internal/media/reconcile", async (request, reply) => {
    requireInternalToken(request.headers["x-internal-token"] as string | undefined);
    return reply.send({
      provider_group_id: null,
      dry_run: true,
      before: { pending: 0, ready: 0, failed: 0, bogus_failed: 0 },
      after: { pending: 0, ready: 0, failed: 0, bogus_failed: 0 },
      actions: { cleaned_bogus: 0, enqueued_pending: 0, retried_failed: 0 },
      message: "backend-ts media reconcile endpoint is scaffolded",
    });
  });
}
