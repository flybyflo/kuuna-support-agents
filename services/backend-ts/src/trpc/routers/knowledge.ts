import { TRPCError } from "@trpc/server";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";

import {
  knowledgeCommonDocs,
  knowledgeCustomerDocs,
  knowledgeGroupDocs,
  knowledgeVersions,
  mediaAssets,
  messages,
  messageVersions,
  transcripts,
} from "../../db/schema.js";
import type { DbLike } from "../../db/client.js";
import { enqueueKuunaJob } from "../../jobs/queues.js";
import { createTRPCRouter, protectedProcedure, roleProcedure } from "../init.js";

const commonDocInput = z.object({
  docKey: z.string().trim().min(1).max(255),
  title: z.string().trim().min(1).max(255),
});

const groupDocInput = commonDocInput.extend({
  providerGroupId: z.string().trim().min(1).max(255),
});

const customerDocInput = groupDocInput.extend({
  customerKey: z.string().trim().min(1).max(255).optional(),
});

const versionInput = z.object({
  scope: z.enum(["common", "group", "customer"]),
  docRefId: z.string().uuid(),
  contentMarkdown: z.string(),
});

const versionTargetInput = z.object({
  scope: z.enum(["common", "group", "customer"]),
  docRefId: z.string().uuid(),
  versionId: z.string().uuid(),
});

type GroupIngestStats = {
  providerGroupId: string;
  chunkCount: number;
  updatedAt: Date | null;
  hasPendingMedia: boolean;
  hasFailedMedia: boolean;
};

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

  ingestedCommonDocs: protectedProcedure.query(async ({ ctx }) => {
    const statsByGroup = await collectIngestStats(ctx.db);
    const populated = Array.from(statsByGroup.values()).filter((stats) => stats.chunkCount > 0 && stats.updatedAt);
    if (populated.length === 0) {
      return [];
    }

    const updatedAt = populated.reduce<Date | null>(
      (current, stats) => maxDate(current, stats.updatedAt),
      null,
    );
    if (!updatedAt) {
      return [];
    }

    const aggregate: GroupIngestStats = {
      providerGroupId: "common-ingested",
      chunkCount: populated.reduce((sum, stats) => sum + stats.chunkCount, 0),
      updatedAt,
      hasPendingMedia: populated.some((stats) => stats.hasPendingMedia),
      hasFailedMedia: populated.some((stats) => stats.hasFailedMedia),
    };

    return [
      {
        id: "common-ingested",
        doc_key: "ingested-chat-history",
        scope: "common",
        provider_group_id: null,
        title: "Common Knowledge (Ingested)",
        status: deriveIngestedStatus(aggregate),
        updated_at: updatedAt.toISOString(),
        updated_by: "ingest-pipeline",
        chunk_count: aggregate.chunkCount,
      },
    ];
  }),

  ingestedGroupDocs: protectedProcedure
    .input(z.object({ providerGroupId: z.string().optional() }).default({}))
    .query(async ({ ctx, input }) => {
      const statsByGroup = await collectIngestStats(ctx.db);
      const eligible = Array.from(statsByGroup.values())
        .filter((stats) => stats.chunkCount > 0 && stats.updatedAt)
        .filter((stats) => !input.providerGroupId || stats.providerGroupId === input.providerGroupId)
        .sort((left, right) => (right.updatedAt?.getTime() ?? 0) - (left.updatedAt?.getTime() ?? 0));

      return eligible.map((stats) => ({
        id: stats.providerGroupId,
        doc_key: "ingested-chat-history",
        scope: "group",
        provider_group_id: stats.providerGroupId,
        title: stats.providerGroupId,
        status: deriveIngestedStatus(stats),
        updated_at: stats.updatedAt?.toISOString(),
        updated_by: "ingest-pipeline",
        chunk_count: stats.chunkCount,
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

  customerDocs: protectedProcedure
    .input(z.object({ providerGroupId: z.string() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(knowledgeCustomerDocs)
        .where(eq(knowledgeCustomerDocs.customerKey, input.providerGroupId))
        .orderBy(desc(knowledgeCustomerDocs.updatedAt));
      return rows.map((doc) => ({
        id: doc.id,
        doc_key: doc.docKey,
        scope: "customer" as const,
        provider_group_id: doc.providerGroupId,
        customer_key: doc.customerKey,
        title: doc.title,
        created_at: doc.createdAt.toISOString(),
        updated_at: doc.updatedAt.toISOString(),
      }));
    }),

  createCustomerDoc: roleProcedure("owner", "admin").input(customerDocInput).mutation(async ({ ctx, input }) => {
    const customerKey = input.customerKey?.trim() || input.providerGroupId;
    const [existing] = await ctx.db
      .select({ id: knowledgeCustomerDocs.id })
      .from(knowledgeCustomerDocs)
      .where(
        and(
          eq(knowledgeCustomerDocs.customerKey, customerKey),
          eq(knowledgeCustomerDocs.docKey, input.docKey),
        ),
      )
      .limit(1);
    if (existing) {
      throw new TRPCError({ code: "CONFLICT", message: "customer knowledge doc already exists" });
    }
    const [doc] = await ctx.db
      .insert(knowledgeCustomerDocs)
      .values({
        providerGroupId: input.providerGroupId,
        customerKey,
        docKey: input.docKey,
        title: input.title,
      })
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
    const doc = await findKnowledgeDoc(ctx.db, input.scope, input.docRefId);
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
    await enqueueKuunaJob("knowledge_indexing", { knowledge_version_id: input.versionId }, `knowledge_indexing_${jobToken(input.versionId)}`);
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
    await enqueueKuunaJob("knowledge_indexing", { knowledge_version_id: input.versionId }, `knowledge_indexing_${jobToken(input.versionId)}`);
    return version;
  }),
});

async function findKnowledgeDoc(
  database: DbLike,
  scope: "common" | "group" | "customer",
  docRefId: string,
): Promise<{ id: string } | null> {
  if (scope === "common") {
    const [doc] = await database
      .select({ id: knowledgeCommonDocs.id })
      .from(knowledgeCommonDocs)
      .where(eq(knowledgeCommonDocs.id, docRefId))
      .limit(1);
    return doc ?? null;
  }
  if (scope === "group") {
    const [doc] = await database
      .select({ id: knowledgeGroupDocs.id })
      .from(knowledgeGroupDocs)
      .where(eq(knowledgeGroupDocs.id, docRefId))
      .limit(1);
    return doc ?? null;
  }
  const [doc] = await database
    .select({ id: knowledgeCustomerDocs.id })
    .from(knowledgeCustomerDocs)
    .where(eq(knowledgeCustomerDocs.id, docRefId))
    .limit(1);
  return doc ?? null;
}

async function collectIngestStats(database: DbLike): Promise<Map<string, GroupIngestStats>> {
  const statsByGroup = new Map<string, GroupIngestStats>();

  const latestVersions = await database
    .select({
      providerGroupId: messages.providerGroupId,
      occurredAt: messageVersions.occurredAt,
      textContent: messageVersions.textContent,
    })
    .from(messages)
    .innerJoin(
      messageVersions,
      and(
        eq(messageVersions.messageId, messages.id),
        eq(messageVersions.versionNo, messages.latestVersionNo),
      ),
    )
    .where(eq(messageVersions.isDeleted, false));

  for (const row of latestVersions) {
    if (!row.textContent?.trim()) {
      continue;
    }
    const stats = getStats(statsByGroup, row.providerGroupId);
    stats.chunkCount += 1;
    stats.updatedAt = maxDate(stats.updatedAt, row.occurredAt);
  }

  const transcriptRows = await database
    .select({
      providerGroupId: messages.providerGroupId,
      messageUpdatedAt: messages.updatedAt,
      mediaUpdatedAt: mediaAssets.updatedAt,
      transcriptUpdatedAt: transcripts.updatedAt,
      textContent: transcripts.textContent,
    })
    .from(messages)
    .innerJoin(mediaAssets, eq(mediaAssets.messageId, messages.id))
    .innerJoin(transcripts, eq(transcripts.mediaAssetId, mediaAssets.id));

  for (const row of transcriptRows) {
    if (!row.textContent?.trim()) {
      continue;
    }
    const stats = getStats(statsByGroup, row.providerGroupId);
    stats.chunkCount += 1;
    stats.updatedAt = maxDate(
      stats.updatedAt,
      row.transcriptUpdatedAt ?? row.mediaUpdatedAt ?? row.messageUpdatedAt,
    );
  }

  const mediaRows = await database
    .select({
      providerGroupId: messages.providerGroupId,
      status: mediaAssets.status,
    })
    .from(messages)
    .innerJoin(mediaAssets, eq(mediaAssets.messageId, messages.id));

  for (const row of mediaRows) {
    const stats = getStats(statsByGroup, row.providerGroupId);
    if (row.status === "pending") {
      stats.hasPendingMedia = true;
    } else if (row.status === "failed") {
      stats.hasFailedMedia = true;
    }
  }

  return statsByGroup;
}

function getStats(statsByGroup: Map<string, GroupIngestStats>, providerGroupId: string): GroupIngestStats {
  const existing = statsByGroup.get(providerGroupId);
  if (existing) {
    return existing;
  }
  const created: GroupIngestStats = {
    providerGroupId,
    chunkCount: 0,
    updatedAt: null,
    hasPendingMedia: false,
    hasFailedMedia: false,
  };
  statsByGroup.set(providerGroupId, created);
  return created;
}

function deriveIngestedStatus(stats: GroupIngestStats): "processing" | "failed" | "ready" {
  if (stats.hasPendingMedia) {
    return "processing";
  }
  if (stats.hasFailedMedia) {
    return "failed";
  }
  return "ready";
}

function maxDate(current: Date | null, candidate: Date | null): Date | null {
  if (!candidate) {
    return current;
  }
  if (!current || candidate.getTime() > current.getTime()) {
    return candidate;
  }
  return current;
}

function jobToken(value: string): string {
  return value.replaceAll("-", "_").replaceAll(" ", "_");
}
