import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import type { DbLike } from "../../db/client.js";
import { toolCatalogEntries } from "../../db/schema.js";
import { createTRPCRouter, protectedProcedure, roleProcedure } from "../init.js";

const defaultTools = [
  ["echo", "Echo", "Returns the provided input text unchanged. Useful for connectivity checks.", "read", "utility"],
  ["uppercase", "Uppercase", "Transforms text to uppercase for deterministic formatting tests.", "read", "utility"],
  ["context_lookup", "Context Lookup", "Reads a specific key from runtime context assembled for the current message.", "read", "context"],
  ["media_analyze", "Analyze Media", "Reads image and audio insights generated inside the isolated chat runtime.", "read", "media"],
  ["knowledge_search", "Knowledge Search", "Searches published group/common knowledge and returns ranked passages.", "read", "knowledge"],
  ["message_history", "Message History", "Reads recent group conversation history for retrieval-augmented responses.", "read", "context"],
  ["todo_create", "Create Todo", "Creates a staff todo in the dashboard for this group.", "write", "workflow"],
  ["todo_update", "Update Todo", "Updates a staff todo in the dashboard for this group.", "write", "workflow"],
  ["todo_list", "List Todos", "Reads open staff todos for this group.", "read", "workflow"],
  ["send_whatsapp", "Send WhatsApp", "Sends outbound WhatsApp messages via the gateway.", "write", "communication"],
] as const;

const toolInput = z.object({
  toolKey: z.string().trim().min(1).max(128),
  displayName: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1),
  riskClass: z.enum(["read", "write", "admin"]),
  category: z.string().trim().min(1).max(64).default("runtime"),
  isEnabled: z.boolean().default(true),
});

async function ensureDefaultTools(database: DbLike): Promise<void> {
  const existing = new Set(
    (await database.select({ toolKey: toolCatalogEntries.toolKey }).from(toolCatalogEntries)).map(
      (row) => row.toolKey,
    ),
  );
  for (const [toolKey, displayName, description, riskClass, category] of defaultTools) {
    if (!existing.has(toolKey)) {
      await database.insert(toolCatalogEntries).values({
        toolKey,
        displayName,
        description,
        riskClass,
        category,
        isEnabled: true,
      });
    }
  }
}

export const toolsRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    await ensureDefaultTools(ctx.db);
    const rows = await ctx.db.select().from(toolCatalogEntries).orderBy(desc(toolCatalogEntries.updatedAt));
    return rows.map((tool) => ({
      id: tool.id,
      tool_key: tool.toolKey,
      display_name: tool.displayName,
      description: tool.description,
      risk_class: tool.riskClass,
      category: tool.category,
      is_enabled: tool.isEnabled,
      created_at: tool.createdAt.toISOString(),
      updated_at: tool.updatedAt.toISOString(),
    }));
  }),

  upsert: roleProcedure("owner", "admin").input(toolInput).mutation(async ({ ctx, input }) => {
    const normalizedKey = input.toolKey.toLowerCase();
    const [existing] = await ctx.db
      .select()
      .from(toolCatalogEntries)
      .where(eq(toolCatalogEntries.toolKey, normalizedKey))
      .limit(1);
    const values = {
      toolKey: normalizedKey,
      displayName: input.displayName,
      description: input.description,
      riskClass: input.riskClass,
      category: input.category.toLowerCase(),
      isEnabled: input.isEnabled,
      updatedAt: new Date(),
    };
    const [tool] = existing
      ? await ctx.db.update(toolCatalogEntries).set(values).where(eq(toolCatalogEntries.id, existing.id)).returning()
      : await ctx.db.insert(toolCatalogEntries).values(values).returning();
    if (!tool) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "tool upsert failed" });
    }
    return {
      id: tool.id,
      tool_key: tool.toolKey,
      display_name: tool.displayName,
      description: tool.description,
      risk_class: tool.riskClass,
      category: tool.category,
      is_enabled: tool.isEnabled,
      created_at: tool.createdAt.toISOString(),
      updated_at: tool.updatedAt.toISOString(),
    };
  }),
});
