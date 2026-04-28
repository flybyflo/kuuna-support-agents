import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { knowledgeCommonDocs, knowledgeGroupDocs, knowledgeVersions } from "../../db/schema.js";
import { createTRPCRouter, protectedProcedure } from "../init.js";

export const knowledgeRouter = createTRPCRouter({
  commonDocs: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(knowledgeCommonDocs)
      .orderBy(desc(knowledgeCommonDocs.updatedAt));
    return rows.map((doc) => ({
      id: doc.id,
      doc_key: doc.docKey,
      scope: "common" as const,
      provider_group_id: null,
      title: doc.title,
      created_at: doc.createdAt.toISOString(),
      updated_at: doc.updatedAt.toISOString(),
    }));
  }),

  groupDocs: protectedProcedure
    .input(z.object({ providerGroupId: z.string() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(knowledgeGroupDocs)
        .where(eq(knowledgeGroupDocs.providerGroupId, input.providerGroupId))
        .orderBy(desc(knowledgeGroupDocs.updatedAt));
      return rows.map((doc) => ({
        id: doc.id,
        doc_key: doc.docKey,
        scope: "group" as const,
        provider_group_id: doc.providerGroupId,
        title: doc.title,
        created_at: doc.createdAt.toISOString(),
        updated_at: doc.updatedAt.toISOString(),
      }));
    }),

  versions: protectedProcedure
    .input(z.object({ docRefId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(knowledgeVersions)
        .where(eq(knowledgeVersions.docRefId, input.docRefId))
        .orderBy(desc(knowledgeVersions.versionNo));
      return rows.map((version) => ({
        id: version.id,
        scope: version.scope,
        doc_ref_id: version.docRefId,
        version_no: version.versionNo,
        status: version.status,
        content_markdown: version.contentMarkdown,
        updated_by: version.updatedBy,
        created_at: version.createdAt.toISOString(),
        updated_at: version.updatedAt.toISOString(),
      }));
    }),
});
