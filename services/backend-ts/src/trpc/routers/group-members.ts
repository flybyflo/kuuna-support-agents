import { createTRPCClient, httpLink, TRPCClientError } from "@trpc/client";
import type { GatewayRouter } from "@kuuna/gateway/trpc";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getSettings } from "../../config.js";
import {
  clientProfileIdentities,
  clientProfiles,
  groupClientProfiles,
  groupMembers,
  messages,
} from "../../db/schema.js";
import { logger } from "../../logging.js";
import { createTRPCRouter, protectedProcedure, roleProcedure } from "../init.js";

const roleSchema = z.enum(["client", "lawyer", "company_staff", "bot"]);

const providerGroupInput = z.object({
  providerGroupId: z.string().trim().min(1).max(255),
});

const upsertMemberInput = providerGroupInput.extend({
  providerUserId: z.string().trim().min(1).max(255),
  role: roleSchema.nullable().optional(),
  displayName: z.string().trim().max(120).nullable().optional(),
  phoneOverride: z.string().trim().max(40).nullable().optional(),
  clientProfileId: z.string().uuid().nullable().optional(),
});

const setPrimaryClientInput = providerGroupInput.extend({
  providerUserId: z.string().trim().min(1).max(255),
});

export const groupMembersRouter = createTRPCRouter({
  list: protectedProcedure.input(providerGroupInput).query(async ({ ctx, input }) => {
    await syncGatewayParticipantsIntoDb(ctx.db, input.providerGroupId, { bestEffort: true });

    const savedRows = await ctx.db
      .select({
        member: groupMembers,
        profile: clientProfiles,
      })
      .from(groupMembers)
      .leftJoin(clientProfiles, eq(clientProfiles.id, groupMembers.clientProfileId))
      .where(eq(groupMembers.providerGroupId, input.providerGroupId))
      .orderBy(desc(groupMembers.updatedAt));

    const observed = await ctx.db
      .select({
        providerUserId: messages.senderProviderUserId,
        updatedAt: messages.updatedAt,
      })
      .from(messages)
      .where(and(eq(messages.providerGroupId, input.providerGroupId), isNotNull(messages.senderProviderUserId)))
      .orderBy(desc(messages.updatedAt))
      .limit(250);

    const [primary] = await ctx.db
      .select()
      .from(groupClientProfiles)
      .where(and(eq(groupClientProfiles.providerGroupId, input.providerGroupId), eq(groupClientProfiles.isPrimary, true)))
      .limit(1);

    const byJid = new Map<string, ReturnType<typeof mapSavedMember>>();
    for (const row of savedRows) {
      const mapped = mapSavedMember(row.member, row.profile, primary?.clientProfileId ?? null);
      const key = memberListKey(mapped);
      const existing = byJid.get(key);
      if (!existing || memberListScore(mapped) > memberListScore(existing)) {
        byJid.set(key, mapped);
      }
    }

    for (const row of observed) {
      const providerUserId = row.providerUserId?.trim();
      if (!providerUserId) continue;
      const observedItem = {
        provider_group_id: input.providerGroupId,
        provider_user_id: providerUserId,
        role: null,
        display_name: null,
        derived_phone: phoneFromJid(providerUserId),
        phone_override: null,
        phone_display: phoneFromJid(providerUserId),
        push_name: null,
        linked_client_profile: null,
        gateway_metadata: {},
        is_primary_client: false,
        setup_status: "missing_role" as const,
        updated_at: row.updatedAt.toISOString(),
      };
      const key = memberListKey(observedItem);
      if (byJid.has(key)) continue;
      byJid.set(key, observedItem);
    }

    const items = dedupeMemberListItems(Array.from(byJid.values())).sort((left, right) => {
      const leftName = left.display_name ?? left.phone_display ?? left.provider_user_id;
      const rightName = right.display_name ?? right.phone_display ?? right.provider_user_id;
      return leftName.localeCompare(rightName);
    });

    return {
      provider_group_id: input.providerGroupId,
      private_retrieval_status: privateRetrievalStatus(items),
      primary_client_profile_id: primary?.clientProfileId ?? null,
      items,
    };
  }),

  syncFromGateway: roleProcedure("owner", "admin").input(providerGroupInput).mutation(async ({ ctx, input }) => {
    const syncedCount = await syncGatewayParticipantsIntoDb(ctx.db, input.providerGroupId, { bestEffort: false });
    return { ok: true, synced_count: syncedCount };
  }),

  upsertMember: roleProcedure("owner", "admin").input(upsertMemberInput).mutation(async ({ ctx, input }) => {
    const now = new Date();
    const clientProfileId = await resolveClientProfileId(ctx.db, {
      role: input.role ?? null,
      clientProfileId: input.clientProfileId ?? null,
      providerUserId: input.providerUserId,
      displayName: input.displayName ?? null,
      phoneOverride: input.phoneOverride ?? null,
    });

    const [member] = await ctx.db
      .insert(groupMembers)
      .values({
        providerGroupId: input.providerGroupId,
        providerUserId: input.providerUserId,
        role: input.role ?? null,
        displayName: input.displayName ?? null,
        derivedPhone: phoneFromJid(input.providerUserId),
        phoneOverride: input.phoneOverride ?? null,
        clientProfileId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [groupMembers.providerGroupId, groupMembers.providerUserId],
        set: {
          role: input.role ?? null,
          displayName: input.displayName ?? null,
          phoneOverride: input.phoneOverride ?? null,
          clientProfileId,
          updatedAt: now,
        },
      })
      .returning();

    if (!member) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "member update failed" });
    }
    return { ok: true, member_id: member.id, client_profile_id: clientProfileId };
  }),

  setPrimaryClient: roleProcedure("owner", "admin").input(setPrimaryClientInput).mutation(async ({ ctx, input }) => {
    const [member] = await ctx.db
      .select()
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.providerGroupId, input.providerGroupId),
          eq(groupMembers.providerUserId, input.providerUserId),
        ),
      )
      .limit(1);

    if (!member || member.role !== "client" || !member.clientProfileId) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "primary client must be a client member linked to a client profile",
      });
    }
    const [clientCount] = await ctx.db
      .select({ value: sql<number>`count(*)` })
      .from(groupMembers)
      .where(and(eq(groupMembers.providerGroupId, input.providerGroupId), eq(groupMembers.role, "client")));
    if (Number(clientCount?.value ?? 0) !== 1) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "exactly one client member is required before setting the primary client",
      });
    }

    await ctx.db
      .update(groupClientProfiles)
      .set({ isPrimary: false, updatedAt: new Date() })
      .where(eq(groupClientProfiles.providerGroupId, input.providerGroupId));

    await ctx.db
      .insert(groupClientProfiles)
      .values({
        providerGroupId: input.providerGroupId,
        clientProfileId: member.clientProfileId,
        isPrimary: true,
      })
      .onConflictDoUpdate({
        target: [groupClientProfiles.providerGroupId, groupClientProfiles.clientProfileId],
        set: { isPrimary: true, updatedAt: new Date() },
      });

    return { ok: true, primary_client_profile_id: member.clientProfileId };
  }),
});

type SavedMember = typeof groupMembers.$inferSelect;
type ClientProfile = typeof clientProfiles.$inferSelect | null;
type MemberListItem = ReturnType<typeof mapSavedMember>;

function mapSavedMember(member: SavedMember, profile: ClientProfile, primaryClientProfileId: string | null) {
  const phoneDisplay = member.phoneOverride || member.derivedPhone || phoneFromJid(member.providerUserId);
  const linkedProfile = profile
    ? {
        id: profile.id,
        display_name: profile.displayName,
        notes: profile.notes,
      }
    : null;
  return {
    provider_group_id: member.providerGroupId,
    provider_user_id: member.providerUserId,
    role: member.role,
    display_name: member.displayName,
    derived_phone: member.derivedPhone || phoneFromJid(member.providerUserId),
    phone_override: member.phoneOverride,
    phone_display: phoneDisplay,
    push_name: member.pushName,
    linked_client_profile: linkedProfile,
    gateway_metadata: objectRecord(member.gatewayMetadata),
    is_primary_client: Boolean(member.clientProfileId && member.clientProfileId === primaryClientProfileId),
    setup_status: member.role ? (member.role === "client" && !member.clientProfileId ? "missing_profile" : "configured") : "missing_role",
    updated_at: member.updatedAt.toISOString(),
  };
}

function privateRetrievalStatus(items: MemberListItem[]) {
  const clients = items.filter((item) => item.role === "client" && item.linked_client_profile);
  const primaryClients = items.filter((item) => item.is_primary_client);
  const missingRoles = items.filter((item) => !item.role);
  return {
    complete: true,
    primary_client_count: primaryClients.length,
    client_member_count: clients.length,
    missing_role_count: missingRoles.length,
    reason: primaryClients.length === 1 ? null : "personal_client_context_optional",
  };
}

function dedupeMemberListItems(items: MemberListItem[]): MemberListItem[] {
  const byProviderUserId = new Map<string, MemberListItem>();
  for (const item of items) {
    const existing = byProviderUserId.get(item.provider_user_id);
    if (!existing || memberListScore(item) > memberListScore(existing)) {
      byProviderUserId.set(item.provider_user_id, item);
    }
  }
  return Array.from(byProviderUserId.values());
}

function memberListKey(member: Pick<MemberListItem, "role" | "provider_user_id" | "phone_display" | "derived_phone" | "phone_override" | "gateway_metadata">): string {
  const phone = member.phone_override || member.phone_display || member.derived_phone;
  if (member.role === "bot" && phone) return `bot:${phone}`;
  if (phone && isSocketUserFallback(member.gateway_metadata)) return `phone:${phone}`;
  return `jid:${member.provider_user_id}`;
}

function memberListScore(member: MemberListItem): number {
  let score = 0;
  if (member.role) score += 10;
  if (member.display_name) score += 4;
  if (member.linked_client_profile) score += 4;
  if (member.push_name) score += 2;
  if (!isSocketUserFallback(member.gateway_metadata)) score += 3;
  if (member.provider_user_id.endsWith("@lid")) score += 1;
  return score;
}

function isSocketUserFallback(metadata: Record<string, unknown>): boolean {
  return metadata.source === "socket_user";
}

async function resolveClientProfileId(
  database: import("../../db/client.js").DbLike,
  input: {
    role: string | null;
    clientProfileId: string | null;
    providerUserId: string;
    displayName: string | null;
    phoneOverride: string | null;
  },
): Promise<string | null> {
  if (input.role !== "client") {
    return null;
  }
  if (input.clientProfileId) {
    await upsertIdentity(database, input.clientProfileId, input);
    return input.clientProfileId;
  }
  const [identity] = await database
    .select({ clientProfileId: clientProfileIdentities.clientProfileId })
    .from(clientProfileIdentities)
    .where(eq(clientProfileIdentities.providerUserId, input.providerUserId))
    .limit(1);
  if (identity) {
    return identity.clientProfileId;
  }

  const [profile] = await database
    .insert(clientProfiles)
    .values({
      displayName: input.displayName || input.phoneOverride || phoneFromJid(input.providerUserId) || input.providerUserId,
    })
    .returning();
  if (!profile) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "client profile creation failed" });
  }
  await upsertIdentity(database, profile.id, input);
  return profile.id;
}

async function upsertIdentity(
  database: import("../../db/client.js").DbLike,
  clientProfileId: string,
  input: { providerUserId: string; phoneOverride: string | null },
): Promise<void> {
  await database
    .insert(clientProfileIdentities)
    .values({
      clientProfileId,
      providerUserId: input.providerUserId,
      derivedPhone: phoneFromJid(input.providerUserId),
      phoneOverride: input.phoneOverride,
    })
    .onConflictDoUpdate({
      target: clientProfileIdentities.providerUserId,
      set: {
        clientProfileId,
        derivedPhone: phoneFromJid(input.providerUserId),
        phoneOverride: input.phoneOverride,
        updatedAt: new Date(),
      },
    });
}

async function fetchGatewayParticipants(providerGroupId: string) {
  const settings = getSettings();
  const opsToken = settings.GATEWAY_OPS_TOKEN ?? settings.INTERNAL_OPS_TOKEN ?? settings.GATEWAY_SERVICE_TOKEN;
  if (!opsToken) {
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "gateway ops token not configured" });
  }
  const client = createTRPCClient<GatewayRouter>({
    links: [
      httpLink({
        url: `${settings.GATEWAY_BASE_URL.replace(/\/$/, "")}/trpc`,
        headers: { "x-internal-token": opsToken },
      }),
    ],
  });
  try {
    const response = await client.ops.groupParticipants.query({ providerGroupId });
    return response.items;
  } catch (error) {
    if (error instanceof TRPCClientError) {
      throw new TRPCError({ code: "BAD_GATEWAY", message: error.message });
    }
    throw error;
  }
}

async function syncGatewayParticipantsIntoDb(
  database: import("../../db/client.js").DbLike,
  providerGroupId: string,
  options: { bestEffort: boolean },
): Promise<number> {
  let gatewayParticipants: Awaited<ReturnType<typeof fetchGatewayParticipants>>;
  try {
    gatewayParticipants = await fetchGatewayParticipants(providerGroupId);
  } catch (error) {
    if (!options.bestEffort) {
      throw error;
    }
    logger.warn("group_members_auto_sync_failed", {
      provider_group_id: providerGroupId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }

  const now = new Date();
  for (const participant of gatewayParticipants) {
    if (participant.is_self) {
      const botDisplayName = "Kuuna Bot";
      await database
        .insert(groupMembers)
        .values({
          providerGroupId,
          providerUserId: participant.jid,
          role: "bot",
          displayName: botDisplayName,
          derivedPhone: participant.phone,
          clientProfileId: null,
          pushName: participant.display_name,
          gatewayMetadata: participant.metadata ?? {},
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [groupMembers.providerGroupId, groupMembers.providerUserId],
          set: {
            role: "bot",
            displayName: botDisplayName,
            derivedPhone: participant.phone,
            clientProfileId: null,
            pushName: participant.display_name,
            gatewayMetadata: participant.metadata ?? {},
            updatedAt: now,
          },
        });
      continue;
    }

    await database
      .insert(groupMembers)
      .values({
        providerGroupId,
        providerUserId: participant.jid,
        derivedPhone: participant.phone,
        pushName: participant.display_name,
        gatewayMetadata: participant.metadata ?? {},
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [groupMembers.providerGroupId, groupMembers.providerUserId],
        set: {
          derivedPhone: participant.phone,
          pushName: participant.display_name,
          gatewayMetadata: participant.metadata ?? {},
          updatedAt: now,
        },
      });
  }
  return gatewayParticipants.length;
}

function phoneFromJid(jid: string | null): string | null {
  if (!jid) return null;
  const [user, server] = jid.split("@", 2);
  if (server !== "s.whatsapp.net" || !user) return null;
  const digits = user.replace(/[^0-9]/g, "");
  return digits || null;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
