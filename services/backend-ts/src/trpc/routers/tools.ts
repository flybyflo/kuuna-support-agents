import { desc } from "drizzle-orm";

import { toolCatalogEntries } from "../../db/schema.js";
import { createTRPCRouter, protectedProcedure } from "../init.js";

export const toolsRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
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
});
