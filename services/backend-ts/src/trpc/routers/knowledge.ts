import { TRPCError } from "@trpc/server";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { knowledgeCommonDocs, knowledgeGroupDocs, knowledgeVersions } from "../../db/schema.js";
import { enqueueKuunaJob } from "../../jobs/queues.js";
import { createTRPCRouter, protectedProcedure, roleProcedure } from "../init.js";

const commonDocInput = z.object({
  docKey: z.string().trim().min(1).max(255),
  title: z.string().trim().min(1).max(255),
});

const groupDocInput = commonDocInput.extend({
  providerGroupId: z.string().trim().min(1).max(255),
});

const versionInput = z.object({
  scope: z.enum(["common", "group"]),
  docRefId: z.string().uuid(),
  contentMarkdown: z.string(),
});

const versionTargetInput = z.object({
  scope: z.enum(["common", "group"]),
  docRefId: z.string().uuid(),
  versionId: z.string().uuid(),
});

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

  createCommonDoc: roleProcedure("owner", "admin").input(commonDocInput).mutation(async ({ ctx, input }) => {
    const [existing] = await ctx.db
      .select({ id: knowledgeCommonDocs.id })
      .from(knowledgeCommonDocs)
      .where(eq(knowledgeCommonDocs.docKey, input.docKey))
      .limit(1);
    if (existing) {
      throw new TRPCError({ code: "CONFLICT", message: "common knowledge doc already exists" });
    }
    const [doc] = await ctx.db
      .insert(knowledgeCommonDocs)
      .values({ docKey: input.docKey, title: input.title })
      .returning();
    return doc;
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

  createGroupDoc: roleProcedure("owner", "admin").input(groupDocInput).mutation(async ({ ctx, input }) => {
    const [existing] = await ctx.db
      .select({ id: knowledgeGroupDocs.id })
      .from(knowledgeGroupDocs)
      .where(
        and(
          eq(knowledgeGroupDocs.providerGroupId, input.providerGroupId),
          eq(knowledgeGroupDocs.docKey, input.docKey),
        ),
      )
      .limit(1);
    if (existing) {
      throw new TRPCError({ code: "CONFLICT", message: "group knowledge doc already exists" });
    }
    const [doc] = await ctx.db
      .insert(knowledgeGroupDocs)
      .values({ providerGroupId: input.providerGroupId, docKey: input.docKey, title: input.title })
      .returning();
    return doc;
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
        created_at: version.createdAt.toISOString(),
        updated_at: version.updatedAt.toISOString(),
      }));
    }),

  createVersion: roleProcedure("owner", "admin").input(versionInput).mutation(async ({ ctx, input }) => {
    const docTable = input.scope === "common" ? knowledgeCommonDocs : knowledgeGroupDocs;
    const [doc] = await ctx.db.select({ id: docTable.id }).from(docTable).where(eq(docTable.id, input.docRefId));
    if (!doc) {
      throw new TRPCError({ code: "NOT_FOUND", message: "knowledge doc not found" });
    }
    const [latest] = await ctx.db
      .select({ value: sql<number>`coalesce(max(${knowledgeVersions.versionNo}), 0)` })
      .from(knowledgeVersions)
      .where(and(eq(knowledgeVersions.scope, input.scope), eq(knowledgeVersions.docRefId, input.docRefId)));
    const [version] = await ctx.db
      .insert(knowledgeVersions)
      .values({
        scope: input.scope,
        docRefId: input.docRefId,
        versionNo: Number(latest?.value ?? 0) + 1,
        status: "draft",
        contentMarkdown: input.contentMarkdown,
      })
      .returning();
    return version;
  }),

  publishVersion: roleProcedure("owner", "admin").input(versionTargetInput).mutation(async ({ ctx, input }) => {
    const [target] = await ctx.db
      .select()
      .from(knowledgeVersions)
      .where(
        and(
          eq(knowledgeVersions.id, input.versionId),
          eq(knowledgeVersions.scope, input.scope),
          eq(knowledgeVersions.docRefId, input.docRefId),
        ),
      )
      .limit(1);
    if (!target) {
      throw new TRPCError({ code: "NOT_FOUND", message: "knowledge version not found" });
    }
    if (target.status === "archived") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "archived knowledge versions must be restored via rollback",
      });
    }
    await ctx.db
      .update(knowledgeVersions)
      .set({ status: "archived", updatedAt: new Date() })
      .where(
        and(
          eq(knowledgeVersions.scope, input.scope),
          eq(knowledgeVersions.docRefId, input.docRefId),
          eq(knowledgeVersions.status, "published"),
          ne(knowledgeVersions.id, input.versionId),
        ),
      );
    const [version] = await ctx.db
      .update(knowledgeVersions)
      .set({ status: "published", updatedAt: new Date() })
      .where(eq(knowledgeVersions.id, input.versionId))
      .returning();
    await enqueueKuunaJob("knowledge_indexing", { knowledge_version_id: input.versionId }, `knowledge:${input.versionId}`);
    return version;
  }),

  rollbackVersion: roleProcedure("owner", "admin").input(versionTargetInput).mutation(async ({ ctx, input }) => {
    const [target] = await ctx.db
      .select()
      .from(knowledgeVersions)
      .where(
        and(
          eq(knowledgeVersions.id, input.versionId),
          eq(knowledgeVersions.scope, input.scope),
          eq(knowledgeVersions.docRefId, input.docRefId),
        ),
      )
      .limit(1);
    if (!target) {
      throw new TRPCError({ code: "NOT_FOUND", message: "knowledge version not found" });
    }
    if (target.status !== "archived" && target.status !== "published") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "rollback target must be an archived or published knowledge version",
      });
    }
    await ctx.db
      .update(knowledgeVersions)
      .set({ status: "archived", updatedAt: new Date() })
      .where(
        and(
          eq(knowledgeVersions.scope, input.scope),
          eq(knowledgeVersions.docRefId, input.docRefId),
          eq(knowledgeVersions.status, "published"),
          ne(knowledgeVersions.id, input.versionId),
        ),
      );
    const [version] = await ctx.db
      .update(knowledgeVersions)
      .set({ status: "published", updatedAt: new Date() })
      .where(eq(knowledgeVersions.id, input.versionId))
      .returning();
    await enqueueKuunaJob("knowledge_indexing", { knowledge_version_id: input.versionId }, `knowledge:${input.versionId}`);
    return version;
  }),
});
