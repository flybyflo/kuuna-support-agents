import { desc, eq, inArray } from "drizzle-orm";

import { groupBindings } from "../../db/schema.js";
import { createTRPCRouter, protectedProcedure } from "../init.js";

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
      group_title: binding.groupTitle,
      template_version_id: binding.templateVersionId,
      status: binding.status,
      runtime_mode: binding.runtimeMode,
      runtime_container_name: binding.runtimeContainerName,
      runtime_base_url: binding.runtimeBaseUrl,
      secrets_ref: binding.secretsRef,
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
          group_title: binding.groupTitle,
          template_version_id: binding.templateVersionId,
          status: binding.status,
          runtime_mode: binding.runtimeMode,
          runtime_container_name: binding.runtimeContainerName,
          runtime_base_url: binding.runtimeBaseUrl,
          secrets_ref: binding.secretsRef,
          created_at: binding.createdAt.toISOString(),
          updated_at: binding.updatedAt.toISOString(),
        }
      : null;
  }),
});
