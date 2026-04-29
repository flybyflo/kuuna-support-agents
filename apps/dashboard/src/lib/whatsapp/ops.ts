import "server-only";

import { withGatewayClient } from "@/lib/gateway/client";

export type WhatsAppGatewayGroup = {
  providerGroupId: string;
  groupTitle: string;
  participantsCount: number;
};

export type WhatsAppGatewayConnectionStatus = {
  connected: boolean;
  lastEvent: string;
  lastChangedAt?: string;
  checkedAt?: string;
  lastError?: string;
};

export async function listWhatsAppGatewayGroups(): Promise<WhatsAppGatewayGroup[]> {
  return await withGatewayClient(async (client) => {
    const payload = await client.ops.groups.query();
    return payload.items
        .filter((item) => typeof item.jid === "string" && item.jid.length > 0)
        .map((item) => ({
          providerGroupId: item.jid,
          groupTitle: item.name?.trim() || item.jid,
          participantsCount: item.participants_count ?? 0,
        }))
        .sort((left, right) => left.groupTitle.localeCompare(right.groupTitle));
  }) ?? [];
}

export async function getWhatsAppGatewayConnectionStatus(): Promise<WhatsAppGatewayConnectionStatus | null> {
  return withGatewayClient(async (client) => {
    const payload = await client.ops.connection.query();
    return {
        connected: Boolean(payload.connected),
        lastEvent: payload.last_event ?? "unknown",
        lastChangedAt: payload.last_changed_at,
        checkedAt: payload.checked_at,
        lastError: payload.last_error ?? undefined,
      };
  });
}
