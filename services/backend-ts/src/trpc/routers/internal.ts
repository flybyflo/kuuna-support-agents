import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { hashPassword } from "../../auth.js";
import { getSettings } from "../../config.js";
import { roles, runtimeRuns, templateBuilds, userRoles, users } from "../../db/schema.js";
import { reconcileMediaAssets } from "../../jobs/media-processing.js";
import { createTRPCRouter, protectedProcedure, publicProcedure, roleProcedure } from "../init.js";

const mediaReconcileSchema = z.object({
  provider_group_id: z.string().nullable().optional(),
  dry_run: z.boolean().default(true),
  enqueue_pending: z.boolean().default(false),
  retry_failed: z.boolean().default(false),
  cleanup_bogus: z.boolean().default(false),
  limit: z.number().int().positive().max(5000).default(500),
});

const runtimeRunListSchema = z.object({
  providerGroupId: z.string().optional(),
  messageId: z.string().uuid().optional(),
  templateVersionId: z.string().uuid().optional(),
  bindingId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(200).default(50),
}).default({ limit: 50 });

const internalTokenProcedure = publicProcedure.use(({ ctx, next }) => {
  const expected = getSettings().INTERNAL_OPS_TOKEN;
  const actual = ctx.headers.get("x-internal-token");
  if (!expected) {
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "internal ops token not configured" });
  }
  if (actual !== expected) {
    throw new TRPCError({ code: "FORBIDDEN", message: "invalid internal ops token" });
  }
  return next();
});

export const internalRouter = createTRPCRouter({
  adminBootstrap: internalTokenProcedure.mutation(async ({ ctx }) => {
    const settings = getSettings();
    const now = new Date();

    const roleRows = await Promise.all(
      (["owner", "admin", "operator", "viewer"] as const).map(async (name) => {
        const [role] = await ctx.rootDb
          .insert(roles)
          .values({ name })
          .onConflictDoUpdate({ target: roles.name, set: { name } })
          .returning();
        return role;
      }),
    );

    let [admin] = await ctx.rootDb
      .select()
      .from(users)
      .where(eq(users.email, settings.REQUIRED_ADMIN_EMAIL.toLowerCase()))
      .limit(1);

    let created = false;
    if (!admin) {
      [admin] = await ctx.rootDb
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
      [admin] = await ctx.rootDb
        .update(users)
        .set({
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
        })
        .where(eq(users.id, admin.id))
        .returning();
    }

    const adminRole = roleRows.find((role) => role?.name === "admin");
    if (admin && adminRole) {
      await ctx.rootDb
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
  }),

  mediaReconcile: internalTokenProcedure
    .input(mediaReconcileSchema)
    .mutation(({ ctx, input }) =>
      reconcileMediaAssets(ctx.rootDb, {
        providerGroupId: input.provider_group_id ?? null,
        dryRun: input.dry_run,
        enqueuePending: input.enqueue_pending,
        retryFailed: input.retry_failed,
        cleanupBogus: input.cleanup_bogus,
        limit: input.limit,
      }, { enqueueJob: ctx.enqueueJob }),
    ),

  templateBuilds: protectedProcedure
    .input(z.object({ templateId: z.string().uuid(), versionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(templateBuilds)
        .where(eq(templateBuilds.templateVersionId, input.versionId))
        .orderBy(desc(templateBuilds.createdAt));
      return rows.filter((row) => row.templateId === input.templateId);
    }),

  runtimeRuns: roleProcedure("owner", "admin")
    .input(runtimeRunListSchema)
    .query(async ({ ctx, input }) => {
      const filters = [
        ...(input.providerGroupId ? [eq(runtimeRuns.providerGroupId, input.providerGroupId)] : []),
        ...(input.messageId ? [eq(runtimeRuns.messageId, input.messageId)] : []),
        ...(input.templateVersionId ? [eq(runtimeRuns.templateVersionId, input.templateVersionId)] : []),
        ...(input.bindingId ? [eq(runtimeRuns.bindingId, input.bindingId)] : []),
      ];
      return ctx.db
        .select()
        .from(runtimeRuns)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(runtimeRuns.startedAt), desc(runtimeRuns.id))
        .limit(input.limit)
        .then((rows) => rows.map(formatRuntimeRun));
    }),

  runtimeRunById: roleProcedure("owner", "admin")
    .input(z.object({ runId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [run] = await ctx.db
        .select()
        .from(runtimeRuns)
        .where(eq(runtimeRuns.id, input.runId))
        .limit(1);
      if (!run) {
        throw new TRPCError({ code: "NOT_FOUND", message: "runtime run not found" });
      }
      return formatRuntimeRun(run);
    }),
});

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
  };
}
