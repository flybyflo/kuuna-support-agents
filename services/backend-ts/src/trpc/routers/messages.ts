import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { messageVersions, messages } from "../../db/schema.js";
import { createTRPCRouter, protectedProcedure } from "../init.js";

type MessageRow = typeof messages.$inferSelect;

export const messagesRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ providerGroupId: z.string().optional(), limit: z.number().int().min(1).max(200).default(100) }).default({ limit: 100 }))
    .query(async ({ ctx, input }) => {
      if (!ctx.auth) {
        return [];
      }

      let rows: MessageRow[];
      if (input.providerGroupId) {
        rows = await ctx.db
          .select()
          .from(messages)
          .where(eq(messages.providerGroupId, input.providerGroupId))
          .orderBy(desc(messages.createdAt))
          .limit(input.limit);
      } else if (ctx.auth.role === "owner" || ctx.auth.role === "admin") {
        rows = await ctx.db.select().from(messages).orderBy(desc(messages.createdAt)).limit(input.limit);
      } else if (ctx.auth.groupScope.length > 0) {
        rows = await ctx.db
          .select()
          .from(messages)
          .where(inArray(messages.providerGroupId, ctx.auth.groupScope))
          .orderBy(desc(messages.createdAt))
          .limit(input.limit);
      } else {
        rows = [];
      }

      return rows.map((message) => ({
        id: message.id,
        provider_group_id: message.providerGroupId,
        provider_message_id: message.providerMessageId,
        sender_provider_user_id: message.senderProviderUserId,
        sender_phone: message.senderPhone,
        sender_push_name: message.senderPushName,
        latest_version_no: message.latestVersionNo,
        created_at: message.createdAt.toISOString(),
        updated_at: message.updatedAt.toISOString(),
      }));
    }),

  versions: protectedProcedure
    .input(z.object({ messageId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(messageVersions)
        .where(eq(messageVersions.messageId, input.messageId))
        .orderBy(desc(messageVersions.versionNo));
      return rows.map((version) => ({
        id: version.id,
        message_id: version.messageId,
        version_no: version.versionNo,
        event_type: version.eventType,
        is_deleted: version.isDeleted,
        text: version.text,
        raw_event: version.rawEvent,
        occurred_at: version.occurredAt.toISOString(),
        created_at: version.createdAt.toISOString(),
      }));
    }),
});
