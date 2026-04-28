import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { hashPassword } from "../auth.js";
import { getSettings } from "../config.js";
import { db, type Database } from "../db/client.js";
import { roles, runtimeRuns, userRoles, users } from "../db/schema.js";
import { enqueueKuunaJob, type EnqueueKuunaJob } from "../jobs/queues.js";
import { reconcileMediaAssets } from "../jobs/media-processing.js";
import {
  formatTemplateBuild,
  getTemplateBuild,
  listTemplateBuildsForVersion,
  queueTemplateBuild,
  TemplateBuildNotFoundError,
  TemplateBuildValidationError,
} from "../jobs/template-build.js";

const templateBuildCreateSchema = z.object({
  actor_user_id: z.string().uuid(),
  base_image: z.string(),
  allowed_tools: z.array(z.string()).nullable().optional(),
});

const mediaReconcileSchema = z.object({
  provider_group_id: z.string().nullable().optional(),
  dry_run: z.boolean().default(true),
  enqueue_pending: z.boolean().default(false),
  retry_failed: z.boolean().default(false),
  cleanup_bogus: z.boolean().default(false),
  limit: z.number().int().positive().max(5000).default(500),
});

const runtimeRunListQuerySchema = z.object({
  provider_group_id: z.string().optional(),
  message_id: z.string().uuid().optional(),
  template_version_id: z.string().uuid().optional(),
  binding_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

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

export function registerInternalRoutes(
  app: FastifyInstance,
  deps: { database?: Database; enqueueJob?: EnqueueKuunaJob } = {},
): void {
  const database = deps.database ?? db;
  const enqueueJob = deps.enqueueJob ?? enqueueKuunaJob;

  app.post("/internal/admin/bootstrap", async (request, reply) => {
    requireInternalToken(request.headers["x-internal-token"] as string | undefined);
    const result = await bootstrapRequiredAdmin(database);
    return reply.send(result);
  });

  app.post("/internal/media/reconcile", async (request, reply) => {
    requireInternalToken(request.headers["x-internal-token"] as string | undefined);
    const payload = mediaReconcileSchema.parse(request.body ?? {});
    const result = await reconcileMediaAssets(database, {
      providerGroupId: payload.provider_group_id ?? null,
      dryRun: payload.dry_run,
      enqueuePending: payload.enqueue_pending,
      retryFailed: payload.retry_failed,
      cleanupBogus: payload.cleanup_bogus,
      limit: payload.limit,
    }, {
      enqueueJob,
    });
    return reply.send(result);
  });

  app.get<{
    Params: { templateId: string; versionId: string };
  }>("/internal/templates/:templateId/versions/:versionId/builds", async (request, reply) => {
    requireInternalToken(request.headers["x-internal-token"] as string | undefined);
    try {
      const rows = await listTemplateBuildsForVersion(database, {
        templateId: request.params.templateId,
        versionId: request.params.versionId,
      });
      return reply.send({ items: rows.map(formatTemplateBuild) });
    } catch (error) {
      if (error instanceof TemplateBuildValidationError) {
        return reply.code(404).send({ detail: error.message });
      }
      throw error;
    }
  });

  app.post<{
    Params: { templateId: string; versionId: string };
  }>("/internal/templates/:templateId/versions/:versionId/builds", async (request, reply) => {
    requireInternalToken(request.headers["x-internal-token"] as string | undefined);
    const payload = templateBuildCreateSchema.parse(request.body);
    try {
      const build = await queueTemplateBuild(
        database,
        {
          actorUserId: payload.actor_user_id,
          templateId: request.params.templateId,
          versionId: request.params.versionId,
          baseImage: payload.base_image,
          allowedTools: payload.allowed_tools ?? null,
        },
        { enqueueJob },
      );
      return reply.code(201).send(formatTemplateBuild(build));
    } catch (error) {
      if (error instanceof TemplateBuildValidationError) {
        return reply.code(400).send({ detail: error.message });
      }
      throw error;
    }
  });

  app.get<{
    Params: { buildId: string };
  }>("/internal/template-builds/:buildId", async (request, reply) => {
    requireInternalToken(request.headers["x-internal-token"] as string | undefined);
    try {
      const build = await getTemplateBuild(database, request.params.buildId);
      return reply.send(formatTemplateBuild(build));
    } catch (error) {
      if (error instanceof TemplateBuildNotFoundError) {
        return reply.code(404).send({ detail: error.message });
      }
      throw error;
    }
  });

  app.get("/internal/runtime-runs", async (request, reply) => {
    requireInternalToken(request.headers["x-internal-token"] as string | undefined);
    const query = runtimeRunListQuerySchema.parse(request.query ?? {});
    const filters = [
      ...(query.provider_group_id ? [eq(runtimeRuns.providerGroupId, query.provider_group_id)] : []),
      ...(query.message_id ? [eq(runtimeRuns.messageId, query.message_id)] : []),
      ...(query.template_version_id ? [eq(runtimeRuns.templateVersionId, query.template_version_id)] : []),
      ...(query.binding_id ? [eq(runtimeRuns.bindingId, query.binding_id)] : []),
    ];
    const rows = await database
      .select()
      .from(runtimeRuns)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(runtimeRuns.startedAt), desc(runtimeRuns.id))
      .limit(query.limit);
    return reply.send({ items: rows.map(formatRuntimeRun) });
  });

  app.get<{
    Params: { runId: string };
  }>("/internal/runtime-runs/:runId", async (request, reply) => {
    requireInternalToken(request.headers["x-internal-token"] as string | undefined);
    const [run] = await database
      .select()
      .from(runtimeRuns)
      .where(eq(runtimeRuns.id, request.params.runId))
      .limit(1);
    if (!run) {
      return reply.code(404).send({ detail: "runtime run not found" });
    }
    return reply.send(formatRuntimeRun(run));
  });
}

async function bootstrapRequiredAdmin(database: Database) {
  const settings = getSettings();
  const now = new Date();

  const roleRows = await Promise.all(
    (["owner", "admin", "operator", "viewer"] as const).map(async (name) => {
      const [role] = await database
        .insert(roles)
        .values({ name })
        .onConflictDoUpdate({ target: roles.name, set: { name } })
        .returning();
      return role;
    }),
  );

  let [admin] = await database
    .select()
    .from(users)
    .where(eq(users.email, settings.REQUIRED_ADMIN_EMAIL.toLowerCase()))
    .limit(1);

  let created = false;
  if (!admin) {
    [admin] = await database
      .insert(users)
      .values({
        email: settings.REQUIRED_ADMIN_EMAIL.toLowerCase(),
        passwordHash: hashPassword(settings.DASHBOARD_REQUIRED_ADMIN_PASSWORD),
        mustChangePassword: true,
        isActive: true,
        failedLoginAttempts: 0,
      })
      .returning();
    created = Boolean(admin);
  } else {
    const update = {
      isActive: true,
      updatedAt: now,
      ...(settings.DASHBOARD_DEV_RESET_BOOTSTRAP_ADMIN_PASSWORD &&
      process.env.NODE_ENV !== "production" &&
      settings.APP_ENV !== "prod"
        ? {
            passwordHash: hashPassword(settings.DASHBOARD_REQUIRED_ADMIN_PASSWORD),
            mustChangePassword: true,
          }
        : {}),
    };
    [admin] = await database
      .update(users)
      .set(update)
      .where(eq(users.id, admin.id))
      .returning();
  }

  const adminRole = roleRows.find((role) => role?.name === "admin");
  if (admin && adminRole) {
    await database
      .insert(userRoles)
      .values({ userId: admin.id, roleId: adminRole.id })
      .onConflictDoNothing();
  }

  return {
    ok: Boolean(admin),
    created,
    user_id: admin?.id ?? null,
    email: admin?.email ?? settings.REQUIRED_ADMIN_EMAIL.toLowerCase(),
  };
}

function formatRuntimeRun(run: typeof runtimeRuns.$inferSelect) {
  return {
    id: run.id,
    provider_group_id: run.providerGroupId,
    message_id: run.messageId,
    binding_id: run.bindingId,
    template_version_id: run.templateVersionId,
    template_build_id: run.templateBuildId,
    image_ref: run.imageRef,
    status: run.status,
    started_at: run.startedAt.toISOString(),
    finished_at: run.finishedAt?.toISOString() ?? null,
    duration_ms: run.durationMs,
    error: run.error,
    execution: run.execution,
    created_at: run.createdAt.toISOString(),
    updated_at: run.updatedAt.toISOString(),
  };
}
