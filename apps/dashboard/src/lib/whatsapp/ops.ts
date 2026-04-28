import "server-only";

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

const GATEWAY_OPS_URL_CANDIDATES = [
  process.env.GATEWAY_OPS_BASE_URL,
  "http://gateway:8090",
  "http://localhost:8090",
  "http://127.0.0.1:8090",
  "http://host.docker.internal:8090",
]
  .filter((value): value is string => Boolean(value))
  .filter((value, index, self) => self.indexOf(value) === index);

function getGatewayToken(): string | null {
  return (
    process.env.DASHBOARD_GATEWAY_OPS_TOKEN ??
    process.env.GATEWAY_OPS_TOKEN ??
    process.env.DASHBOARD_INTERNAL_OPS_TOKEN ??
    null
  );
}

export async function listWhatsAppGatewayGroups(): Promise<WhatsAppGatewayGroup[]> {
  const token = getGatewayToken();

  if (!token) {
    return [];
  }

  for (const baseUrl of GATEWAY_OPS_URL_CANDIDATES) {
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/ops/groups`, {
        method: "GET",
        headers: {
          "X-Internal-Token": token,
        },
        cache: "no-store",
      });

      if (!response.ok) {
        return [];
      }

      const payload = (await response.json()) as {
        items?: Array<{ jid: string; name: string; participants_count: number }>;
      };

      return (payload.items ?? [])
        .filter((item) => typeof item.jid === "string" && item.jid.length > 0)
        .map((item) => ({
          providerGroupId: item.jid,
          groupTitle: item.name?.trim() || item.jid,
          participantsCount: item.participants_count ?? 0,
        }))
        .sort((left, right) => left.groupTitle.localeCompare(right.groupTitle));
    } catch {
      // try next candidate
    }
  }

  return [];
}

export async function getWhatsAppGatewayConnectionStatus(): Promise<WhatsAppGatewayConnectionStatus | null> {
  const token = getGatewayToken();

  if (!token) {
    return null;
  }

  for (const baseUrl of GATEWAY_OPS_URL_CANDIDATES) {
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/ops/connection`, {
        method: "GET",
        headers: {
          "X-Internal-Token": token,
        },
        cache: "no-store",
      });

      if (!response.ok) {
        continue;
      }

      const payload = (await response.json()) as {
        connected?: boolean;
        last_event?: string;
        last_changed_at?: string;
        checked_at?: string;
        last_error?: string | null;
      };

      return {
        connected: Boolean(payload.connected),
        lastEvent: payload.last_event ?? "unknown",
        lastChangedAt: payload.last_changed_at,
        checkedAt: payload.checked_at,
        lastError: payload.last_error ?? undefined,
      };
    } catch {
      // try next candidate
    }
  }

  return null;
}
