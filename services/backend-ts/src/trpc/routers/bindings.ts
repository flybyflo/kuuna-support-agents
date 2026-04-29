import { createHash, randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { agentInstances, groupBindings, outboundIntents, templateVersions } from "../../db/schema.js";
import { enqueueKuunaJob } from "../../jobs/queues.js";
import { createTRPCRouter, protectedProcedure, roleProcedure } from "../init.js";

const createBindingInput = z.object({
  providerGroupId: z.string().trim().min(1).max(255),
  templateVersionId: z.string().uuid(),
});

function safeContainerSuffix(providerGroupId: string): string {
  const normalized = providerGroupId
    .toLowerCase()
    .replaceAll("@", "-at-")
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  const digest = createHash("sha256").update(providerGroupId).digest("hex").slice(0, 12);
  const prefix = (normalized || "group").slice(0, 80 - digest.length - 1).replace(/^[.-]+|[.-]+$/g, "") || "group";
  return `${prefix}-${digest}`;
}

function buildModelPath(modelConfig: unknown): string[] {
  if (!modelConfig || typeof modelConfig !== "object") return [];
  const config = modelConfig as Record<string, unknown>;
  const direct = config.model_path;
  if (Array.isArray(direct)) return direct.filter((item): item is string => typeof item === "string" && Boolean(item));
  if (typeof direct === "string" && direct) return direct.split("/").filter(Boolean);
  const rawModel = config.model;
  if (rawModel && typeof rawModel === "object") return buildModelPath(rawModel);
  const provider = typeof config.provider === "string" ? config.provider : null;
  const modelName =
    typeof config.model_name === "string"
      ? config.model_name
      : typeof config.model_id === "string"
        ? config.model_id
        : typeof config.model === "string"
          ? config.model
          : null;
  return [provider, modelName].filter((item): item is string => Boolean(item));
}

export const bindingsRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.auth) {
      return [];
    }

    const base = ctx.db.select().from(groupBindings);
    const rows =
      ctx.auth.role === "owner" || ctx.auth.role === "admin"
        ? await base.orderBy(desc(groupBindings.updatedAt))
        : ctx.auth.groupScope.length > 0
          ? await base
              .where(inArray(groupBindings.providerGroupId, ctx.auth.groupScope))
              .orderBy(desc(groupBindings.updatedAt))
          : [];

    return rows.map((binding) => ({
      id: binding.id,
      provider_group_id: binding.providerGroupId,
      template_version_id: binding.templateVersionId,
      status: binding.status,
      created_at: binding.createdAt.toISOString(),
      updated_at: binding.updatedAt.toISOString(),
    }));
  }),

  byId: protectedProcedure.input((value: unknown) => String(value)).query(async ({ ctx, input }) => {
    const [binding] = await ctx.db
      .select()
      .from(groupBindings)
      .where(eq(groupBindings.id, input))
      .limit(1);
    return binding
      ? {
          id: binding.id,
          provider_group_id: binding.providerGroupId,
          template_version_id: binding.templateVersionId,
          status: binding.status,
          created_at: binding.createdAt.toISOString(),
          updated_at: binding.updatedAt.toISOString(),
        }
      : null;
  }),

  create: roleProcedure("owner", "admin").input(createBindingInput).mutation(async ({ ctx, input }) => {
    const [templateVersion] = await ctx.db
      .select()
      .from(templateVersions)
      .where(eq(templateVersions.id, input.templateVersionId))
      .limit(1);
    if (!templateVersion) {
      throw new TRPCError({ code: "NOT_FOUND", message: "template version not found" });
    }
    if (templateVersion.status !== "published") {
      throw new TRPCError({ code: "CONFLICT", message: "template version must be published" });
    }
    const [existing] = await ctx.db
      .select({ id: groupBindings.id })
      .from(groupBindings)
      .where(and(eq(groupBindings.providerGroupId, input.providerGroupId), eq(groupBindings.status, "active")))
      .limit(1);
    if (existing) {
      throw new TRPCError({ code: "CONFLICT", message: "active binding already exists" });
    }

    const [binding] = await ctx.db
      .insert(groupBindings)
      .values({
        providerGroupId: input.providerGroupId,
        templateVersionId: input.templateVersionId,
        status: "active",
      })
      .returning();
    if (!binding) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "binding creation failed" });
    }

    const safeGroup = safeContainerSuffix(input.providerGroupId);
    const [agentInstance] = await ctx.db
      .insert(agentInstances)
      .values({
        groupBindingId: binding.id,
        runtimeMode: "on_demand",
        status: "pending",
        runtimeContainerName: `kuuna-runtime-${safeGroup}`,
        runtimeBaseUrl: null,
        secretsRef: `runtime/${safeGroup}`,
      })
      .returning();

    const outboundIntentId = randomUUID();
    await ctx.db.insert(outboundIntents).values({
      outboundIntentId,
      providerGroupId: input.providerGroupId,
      status: "pending",
      attemptCount: 0,
      payload: {
        trace_id: randomUUID(),
        outbound_intent_id: outboundIntentId,
        provider_group_id: input.providerGroupId,
        text: "Hallo! Ich bin jetzt als automatisierter Support-Agent für diese Gruppe aktiviert und unterstütze bei Bedarf.",
        metadata: {
          agent_instance_id: agentInstance?.id ?? null,
          model_path: buildModelPath(templateVersion.modelConfig),
        },
        _dispatch: {
          created_at: new Date().toISOString(),
          last_status: "pending",
        },
      },
    });
    await enqueueKuunaJob(
      "outbound_dispatch",
      { outbound_intent_id: outboundIntentId },
      `outbound_dispatch_${jobToken(outboundIntentId)}`,
    );

    return {
      id: binding.id,
      provider_group_id: binding.providerGroupId,
      template_version_id: binding.templateVersionId,
      status: binding.status,
      created_at: binding.createdAt.toISOString(),
      updated_at: binding.updatedAt.toISOString(),
      agent_instance: agentInstance
        ? {
            id: agentInstance.id,
            group_binding_id: agentInstance.groupBindingId,
            runtime_mode: agentInstance.runtimeMode,
            status: agentInstance.status,
            runtime_container_name: agentInstance.runtimeContainerName,
            runtime_base_url: agentInstance.runtimeBaseUrl,
            secrets_ref: agentInstance.secretsRef,
            created_at: agentInstance.createdAt.toISOString(),
            updated_at: agentInstance.updatedAt.toISOString(),
          }
        : null,
    };
  }),

  unbind: roleProcedure("owner", "admin")
    .input(z.object({ bindingId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [binding] = await ctx.db
        .update(groupBindings)
        .set({ status: "inactive", updatedAt: new Date() })
        .where(eq(groupBindings.id, input.bindingId))
        .returning();
      if (!binding) {
        throw new TRPCError({ code: "NOT_FOUND", message: "binding not found" });
      }
      await ctx.db
        .update(agentInstances)
        .set({
          status: "stopped",
          runtimeContainerName: null,
          runtimeBaseUrl: null,
          updatedAt: new Date(),
        })
        .where(eq(agentInstances.groupBindingId, binding.id));
      return {
        id: binding.id,
        provider_group_id: binding.providerGroupId,
        template_version_id: binding.templateVersionId,
        status: binding.status,
        created_at: binding.createdAt.toISOString(),
        updated_at: binding.updatedAt.toISOString(),
      };
    }),
});

function jobToken(value: string): string {
  return value.replaceAll("-", "_").replaceAll(" ", "_");
}
