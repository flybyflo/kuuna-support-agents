"use server";

import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";

import { requireAuthorized } from "@/lib/auth/guards";
import { createSessionBackendTrpcClient } from "@/lib/backend/client";

function cleanValue(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function nullableValue(value: FormDataEntryValue | null): string | null {
  return cleanValue(value);
}

function shortReason(reason: string): string {
  return reason.slice(0, 220);
}

function settingsRedirect(providerGroupId: string, params: Record<string, string>): string {
  const search = new URLSearchParams(params);
  return `/inbox/${encodeURIComponent(providerGroupId)}/settings?${search.toString()}`;
}

function rethrowRedirectError(error: unknown): void {
  if (isRedirectError(error)) {
    throw error;
  }
}

export async function syncGroupMembersAction(formData: FormData): Promise<void> {
  await requireAuthorized("bindings", "write");
  const providerGroupId = cleanValue(formData.get("providerGroupId"));
  if (!providerGroupId) {
    redirect("/inbox?members=error&reason=missing-provider-group-id");
  }

  try {
    const client = await createSessionBackendTrpcClient();
    await client.groupMembers.syncFromGateway.mutate({ providerGroupId });
    redirect(settingsRedirect(providerGroupId, { members: "synced" }));
  } catch (error) {
    rethrowRedirectError(error);
    const reason = error instanceof Error ? error.message : String(error);
    redirect(settingsRedirect(providerGroupId, { members: "error", reason: shortReason(reason) }));
  }
}

export async function upsertGroupMemberAction(formData: FormData): Promise<void> {
  await requireAuthorized("bindings", "write");
  const providerGroupId = cleanValue(formData.get("providerGroupId"));
  const providerUserId = cleanValue(formData.get("providerUserId"));
  const role = cleanValue(formData.get("role"));
  if (!providerGroupId || !providerUserId) {
    redirect("/inbox?members=error&reason=missing-member");
  }
  if (role !== "client" && role !== "lawyer" && role !== "company_staff" && role !== "bot" && role !== null) {
    redirect(settingsRedirect(providerGroupId, { members: "error", reason: "invalid-role" }));
  }

  try {
    const client = await createSessionBackendTrpcClient();
    await client.groupMembers.upsertMember.mutate({
      providerGroupId,
      providerUserId,
      role,
      displayName: nullableValue(formData.get("displayName")),
      phoneOverride: nullableValue(formData.get("phoneOverride")),
      clientProfileId: nullableValue(formData.get("clientProfileId")),
    });
    redirect(settingsRedirect(providerGroupId, { members: "saved" }));
  } catch (error) {
    rethrowRedirectError(error);
    const reason = error instanceof Error ? error.message : String(error);
    redirect(settingsRedirect(providerGroupId, { members: "error", reason: shortReason(reason) }));
  }
}

export async function setPrimaryClientAction(formData: FormData): Promise<void> {
  await requireAuthorized("bindings", "write");
  const providerGroupId = cleanValue(formData.get("providerGroupId"));
  const providerUserId = cleanValue(formData.get("providerUserId"));
  if (!providerGroupId || !providerUserId) {
    redirect("/inbox?members=error&reason=missing-primary-client");
  }

  try {
    const client = await createSessionBackendTrpcClient();
    await client.groupMembers.setPrimaryClient.mutate({ providerGroupId, providerUserId });
    redirect(settingsRedirect(providerGroupId, { members: "primary-set" }));
  } catch (error) {
    rethrowRedirectError(error);
    const reason = error instanceof Error ? error.message : String(error);
    redirect(settingsRedirect(providerGroupId, { members: "error", reason: shortReason(reason) }));
  }
}
