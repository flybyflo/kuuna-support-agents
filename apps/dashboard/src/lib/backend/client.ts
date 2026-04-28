import "server-only";

import { createKuunaTrpcClient } from "@kuuna/api-client-ts";

import { createSessionExpiry, getSession, requireSession } from "@/lib/auth/session";
import type { StaffRole } from "@/lib/permissions/matrix";

export const BACKEND_URL_CANDIDATES = [
  process.env.BACKEND_BASE_URL,
  process.env.NEXT_PUBLIC_API_BASE_URL,
  "http://backend:8000",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
  "http://host.docker.internal:8000",
]
  .filter((value): value is string => Boolean(value))
  .filter((value, index, self) => self.indexOf(value) === index);

export function getInternalOpsToken(): string | undefined {
  return process.env.DASHBOARD_INTERNAL_OPS_TOKEN ?? process.env.INTERNAL_OPS_TOKEN;
}

export function createBackendTrpcClient(token?: string, headers?: Record<string, string>) {
  const baseUrl = BACKEND_URL_CANDIDATES[0] ?? "http://backend:8000";
  return createKuunaTrpcClient({ baseUrl, token, headers });
}

export function createInternalBackendTrpcClient() {
  const internalToken = getInternalOpsToken();
  if (!internalToken) {
    throw new Error("missing internal ops token");
  }
  return createBackendTrpcClient(undefined, { "X-Internal-Token": internalToken });
}

export async function createSessionBackendTrpcClient() {
  const session = await requireSession({ allowMustChangePassword: true });
  return createBackendTrpcClient(session.backendAccessToken);
}

export async function getOptionalSessionBackendTrpcClient() {
  const session = await getSession();
  return session ? createBackendTrpcClient(session.backendAccessToken) : null;
}

export async function bootstrapRequiredAdmin(): Promise<void> {
  try {
    await createInternalBackendTrpcClient().internal.adminBootstrap.mutate();
  } catch (error) {
    console.warn("[dashboard-auth] admin bootstrap failed", error);
  }
}

export async function loginWithBackend(email: string, password: string) {
  const errors: string[] = [];
  for (const backendBaseUrl of BACKEND_URL_CANDIDATES) {
    const normalizedBaseUrl = backendBaseUrl.replace(/\/$/, "");
    const client = createKuunaTrpcClient({ baseUrl: normalizedBaseUrl });
    try {
      const response = await client.auth.login.mutate({ email, password });
      const expiry = createSessionExpiry(response.expires_in);
      return {
        userId: response.user.id,
        email: response.user.email,
        displayName: displayNameFromEmail(response.user.email),
        role: response.user.role as StaffRole,
        assignedGroupIds: response.user.group_scope,
        mustChangePassword: response.user.must_change_password,
        backendAccessToken: response.access_token,
        ...expiry,
      };
    } catch (error) {
      errors.push(`${normalizedBaseUrl} -> ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(errors.join(" | ") || "no-backend-url");
}

function displayNameFromEmail(email: string): string {
  const localPart = email.split("@")[0] ?? "staff";
  return localPart
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
