import { desc, eq } from "drizzle-orm";

import { groupTemplates, templateBuilds, templateVersions } from "../../db/schema.js";
import { createTRPCRouter, protectedProcedure } from "../init.js";
import { z } from "zod";

export const templatesRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(groupTemplates)
      .orderBy(groupTemplates.key)
      .then((rows) =>
        rows.map((template) => ({
          id: template.id,
          key: template.key,
          display_name: template.displayName,
          description: template.description,
          created_at: template.createdAt.toISOString(),
          updated_at: template.updatedAt.toISOString(),
        })),
      );
  }),

  versions: protectedProcedure
    .input(z.object({ templateId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(templateVersions)
        .where(eq(templateVersions.templateId, input.templateId))
        .orderBy(desc(templateVersions.versionNo));

      return rows.map((version) => ({
        id: version.id,
        template_id: version.templateId,
        version_no: version.versionNo,
        status: version.status,
        system_prompt: version.systemPrompt,
        model_settings: version.modelConfig,
        tools_config: version.toolsConfig,
        egress_policy: version.egressPolicy,
        created_at: version.createdAt.toISOString(),
        updated_at: version.updatedAt.toISOString(),
      }));
    }),

  builds: protectedProcedure
    .input(z.object({ templateId: z.string().uuid(), versionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(templateBuilds)
        .where(eq(templateBuilds.templateVersionId, input.versionId))
        .orderBy(desc(templateBuilds.createdAt));

      return rows
        .filter((build) => build.templateId === input.templateId)
        .map((build) => ({
          id: build.id,
          template_id: build.templateId,
          template_version_id: build.templateVersionId,
          status: build.status,
          image_ref: build.imageRef,
          image_tag: build.imageTag,
          build_inputs: build.buildInputs,
          logs_ref: build.logsRef,
          created_at: build.createdAt.toISOString(),
          updated_at: build.updatedAt.toISOString(),
        }));
    }),
});
