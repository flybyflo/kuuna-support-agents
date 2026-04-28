import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { runtimeRuns, templateBuilds } from "../../db/schema.js";
import { createTRPCRouter, protectedProcedure } from "../init.js";

export const internalRouter = createTRPCRouter({
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

  runtimeRuns: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(100) }).default({ limit: 100 }))
    .query(async ({ ctx, input }) => {
      return ctx.db.select().from(runtimeRuns).orderBy(desc(runtimeRuns.startedAt)).limit(input.limit);
    }),
});
