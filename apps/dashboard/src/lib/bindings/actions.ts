"use server";

import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { requireAuthorized } from "@/lib/auth/guards";

const BACKEND_URL_CANDIDATES = [
  process.env.BACKEND_BASE_URL,
  process.env.NEXT_PUBLIC_API_BASE_URL,
  "http://backend:8000",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
  "http://host.docker.internal:8000",
]
  .filter((value): value is string => Boolean(value))
  .filter((value, index, self) => self.indexOf(value) === index);

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

export async function createBindingAction(formData: FormData): Promise<void> {
  await requireAuthorized("bindings", "write");

  const providerGroupId = cleanGroupId(formData.get("providerGroupId"));
  const templateVersionId = cleanGroupId(formData.get("templateVersionId"));

  if (!providerGroupId || !templateVersionId) {
    redirect("/bindings/create?bind=error&reason=missing-fields");
  }

  const networkErrors: string[] = [];

  for (const backendBaseUrl of BACKEND_URL_CANDIDATES) {
    const normalizedBaseUrl = backendBaseUrl.replace(/\/$/, "");

    try {
      const response = await fetch(`${normalizedBaseUrl}/bindings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          provider_group_id: providerGroupId,
          template_version_id: templateVersionId,
        }),
        cache: "no-store",
      });

      if (!response.ok) {
        const body = await response.text();
        const detail = `${normalizedBaseUrl} -> ${response.status}: ${body}`;
        redirect(`/bindings/create?bind=error&reason=${encodeURIComponent(shortReason(detail))}`);
      }

      redirect(`/bindings?created=1&group=${encodeURIComponent(providerGroupId)}`);
    } catch (error) {
      rethrowRedirectError(error);
      const reason = error instanceof Error ? error.message : String(error);
      networkErrors.push(`${normalizedBaseUrl} -> ${reason}`);
    }
  }

  const fallbackError = networkErrors.length
    ? `network: ${networkErrors.join(" | ")}`
    : "no-backend-url";
  redirect(`/bindings/create?bind=error&reason=${encodeURIComponent(shortReason(fallbackError))}`);
}

export async function unbindBindingAction(formData: FormData): Promise<void> {
  await requireAuthorized("bindings", "delete");

  const bindingId = cleanGroupId(formData.get("bindingId"));
  const providerGroupId = cleanGroupId(formData.get("providerGroupId"));

  if (!bindingId) {
    redirect("/bindings?unbind=error&reason=missing-binding-id");
  }

  const networkErrors: string[] = [];

  for (const backendBaseUrl of BACKEND_URL_CANDIDATES) {
    const normalizedBaseUrl = backendBaseUrl.replace(/\/$/, "");

    try {
      const response = await fetch(`${normalizedBaseUrl}/bindings/${encodeURIComponent(bindingId)}`, {
        method: "DELETE",
        cache: "no-store",
      });

      if (!response.ok) {
        const body = await response.text();
        const detail = `${normalizedBaseUrl} -> ${response.status}: ${body}`;
        redirect(
          `/bindings?unbind=error&reason=${encodeURIComponent(shortReason(detail))}`,
        );
      }

      const params = new URLSearchParams({ unbound: "1" });
      if (providerGroupId) {
        params.set("group", providerGroupId);
      }
      redirect(`/bindings?${params.toString()}`);
    } catch (error) {
      rethrowRedirectError(error);
      const reason = error instanceof Error ? error.message : String(error);
      networkErrors.push(`${normalizedBaseUrl} -> ${reason}`);
    }
  }

  const fallbackError = networkErrors.length
    ? `network: ${networkErrors.join(" | ")}`
    : "no-backend-url";
  redirect(
    `/bindings?unbind=error&reason=${encodeURIComponent(shortReason(fallbackError))}`,
  );
}

export async function createWhatsAppGroupAction(formData: FormData): Promise<void> {
  await requireAuthorized("bindings", "write");

  const groupName = cleanGroupId(formData.get("groupName"));
  if (!groupName) {
    redirect("/bindings/create?createGroup=error&reason=missing-group-name");
  }

  const participants = parseParticipants(formData.get("participants"));
  const gatewayOpsToken =
    process.env.DASHBOARD_GATEWAY_OPS_TOKEN ??
    process.env.GATEWAY_OPS_TOKEN ??
    process.env.DASHBOARD_INTERNAL_OPS_TOKEN;

  if (!gatewayOpsToken) {
    redirect("/bindings/create?createGroup=error&reason=missing-gateway-token");
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
        redirect(`/bindings/create?createGroup=error&reason=${encodeURIComponent(shortReason(detail))}`);
      }

      const data = (await response.json()) as WhatsAppGroupResponse;
      const params = new URLSearchParams({
        createGroup: "ok",
        providerGroupId: data.group.jid,
        groupName: data.group.name,
      });
      redirect(`/bindings/create?${params.toString()}`);
    } catch (error) {
      rethrowRedirectError(error);
      const reason = error instanceof Error ? error.message : String(error);
      networkErrors.push(`${normalizedBaseUrl} -> ${reason}`);
    }
  }

  const fallbackError = networkErrors.length
    ? `network: ${networkErrors.join(" | ")}`
    : "no-gateway-url";
  redirect(`/bindings/create?createGroup=error&reason=${encodeURIComponent(shortReason(fallbackError))}`);
}
