"use server";

import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { requireAuthorized } from "@/lib/auth/guards";
import { createSessionBackendTrpcClient } from "@/lib/backend/client";

const GATEWAY_OPS_URL_CANDIDATES = [
  process.env.GATEWAY_OPS_BASE_URL,
  "http://gateway:8090",
  "http://localhost:8090",
  "http://127.0.0.1:8090",
  "http://host.docker.internal:8090",
]
  .filter((value): value is string => Boolean(value))
  .filter((value, index, self) => self.indexOf(value) === index);

type WhatsAppGroupResponse = {
  group: {
    jid: string;
    name: string;
  };
};

function cleanGroupId(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseParticipants(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function shortReason(reason: string): string {
  return reason.slice(0, 220);
}

function rethrowRedirectError(error: unknown): void {
  if (isRedirectError(error)) {
    throw error;
  }
}

function bindErrorRedirectFor(
  origin: string | null,
  providerGroupId: string | null,
  reason: string,
): string {
  const encodedReason = encodeURIComponent(shortReason(reason));
  if (origin === "settings" && providerGroupId) {
    return `/inbox/${encodeURIComponent(providerGroupId)}/settings?bind=error&reason=${encodedReason}`;
  }
  return `/inbox/create?bind=error&reason=${encodedReason}`;
}

export async function createBindingAction(formData: FormData): Promise<void> {
  await requireAuthorized("bindings", "write");

  const providerGroupId = cleanGroupId(formData.get("providerGroupId"));
  const templateVersionId = cleanGroupId(formData.get("templateVersionId"));
  const origin = cleanGroupId(formData.get("origin"));

  if (!providerGroupId || !templateVersionId) {
    redirect(bindErrorRedirectFor(origin, providerGroupId, "missing-fields"));
  }

  try {
    const client = await createSessionBackendTrpcClient();
    await client.bindings.create.mutate({ providerGroupId, templateVersionId });
    redirect(
      `/inbox/${encodeURIComponent(providerGroupId)}/settings?created=1`,
    );
  } catch (error) {
    rethrowRedirectError(error);
    const reason = error instanceof Error ? error.message : String(error);
    redirect(bindErrorRedirectFor(origin, providerGroupId, reason));
  }
}

export async function unbindBindingAction(formData: FormData): Promise<void> {
  await requireAuthorized("bindings", "delete");

  const bindingId = cleanGroupId(formData.get("bindingId"));
  const providerGroupId = cleanGroupId(formData.get("providerGroupId"));

  if (!bindingId) {
    if (providerGroupId) {
      redirect(
        `/inbox/${encodeURIComponent(providerGroupId)}/settings?unbind=error&reason=missing-binding-id`,
      );
    }
    redirect("/inbox?unbind=error&reason=missing-binding-id");
  }

  try {
    const client = await createSessionBackendTrpcClient();
    await client.bindings.unbind.mutate({ bindingId });
    if (providerGroupId) {
      redirect(
        `/inbox/${encodeURIComponent(providerGroupId)}/settings?unbound=1`,
      );
    }
    redirect("/inbox?unbound=1");
  } catch (error) {
    rethrowRedirectError(error);
    const reason = error instanceof Error ? error.message : String(error);
    if (providerGroupId) {
      redirect(
        `/inbox/${encodeURIComponent(providerGroupId)}/settings?unbind=error&reason=${encodeURIComponent(shortReason(reason))}`,
      );
    }
    redirect(
      `/inbox?unbind=error&reason=${encodeURIComponent(shortReason(reason))}`,
    );
  }
}

export async function createWhatsAppGroupAction(formData: FormData): Promise<void> {
  await requireAuthorized("bindings", "write");

  const groupName = cleanGroupId(formData.get("groupName"));
  if (!groupName) {
    redirect("/inbox/create?createGroup=error&reason=missing-group-name");
  }

  const participants = parseParticipants(formData.get("participants"));
  const gatewayOpsToken =
    process.env.DASHBOARD_GATEWAY_OPS_TOKEN ??
    process.env.GATEWAY_OPS_TOKEN ??
    process.env.DASHBOARD_INTERNAL_OPS_TOKEN;

  if (!gatewayOpsToken) {
    redirect("/inbox/create?createGroup=error&reason=missing-gateway-token");
  }

  const networkErrors: string[] = [];

  for (const gatewayBaseUrl of GATEWAY_OPS_URL_CANDIDATES) {
    const normalizedBaseUrl = gatewayBaseUrl.replace(/\/$/, "");

    try {
      const response = await fetch(`${normalizedBaseUrl}/ops/groups`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Internal-Token": gatewayOpsToken,
        },
        body: JSON.stringify({
          name: groupName,
          participants,
        }),
        cache: "no-store",
      });

      if (!response.ok) {
        const body = await response.text();
        const detail = `${normalizedBaseUrl} -> ${response.status}: ${body}`;
        redirect(`/inbox/create?createGroup=error&reason=${encodeURIComponent(shortReason(detail))}`);
      }

      const data = (await response.json()) as WhatsAppGroupResponse;
      const params = new URLSearchParams({
        createGroup: "ok",
        providerGroupId: data.group.jid,
        groupName: data.group.name,
      });
      redirect(`/inbox/create?${params.toString()}`);
    } catch (error) {
      rethrowRedirectError(error);
      const reason = error instanceof Error ? error.message : String(error);
      networkErrors.push(`${normalizedBaseUrl} -> ${reason}`);
    }
  }

  const fallbackError = networkErrors.length
    ? `network: ${networkErrors.join(" | ")}`
    : "no-gateway-url";
  redirect(`/inbox/create?createGroup=error&reason=${encodeURIComponent(shortReason(fallbackError))}`);
}
