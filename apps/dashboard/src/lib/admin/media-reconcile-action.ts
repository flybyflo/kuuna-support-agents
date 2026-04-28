"use server";

import { redirect } from "next/navigation";
import { requireAuthorized } from "@/lib/auth/guards";
import { createInternalBackendTrpcClient } from "@/lib/backend/client";

type ReconcileResponse = {
  provider_group_id: string | null;
  dry_run: boolean;
  before: {
    pending: number;
    failed: number;
    bogus_failed: number;
    ready: number;
  };
  after: {
    pending: number;
    failed: number;
    bogus_failed: number;
    ready: number;
  };
  actions: {
    cleaned_bogus: number;
    enqueued_pending: number;
    retried_failed: number;
  };
  message: string;
};

function toBoolean(value: FormDataEntryValue | null): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on";
}

function toInt(value: FormDataEntryValue | null, fallback: number): number {
  if (typeof value !== "string") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

export async function runMediaReconcileAction(formData: FormData): Promise<void> {
  await requireAuthorized("users", "read");

  const internalToken =
    process.env.DASHBOARD_INTERNAL_OPS_TOKEN ?? process.env.INTERNAL_OPS_TOKEN;

  if (!internalToken) {
    redirect("/admin/users?reconcile=error&reason=missing-token");
  }

  const providerGroupIdRaw = formData.get("providerGroupId");
  const providerGroupId =
    typeof providerGroupIdRaw === "string" && providerGroupIdRaw.trim().length > 0
      ? providerGroupIdRaw.trim()
      : null;

  const payload = {
    provider_group_id: providerGroupId,
    limit: toInt(formData.get("limit"), 500),
    cleanup_bogus: toBoolean(formData.get("cleanupBogus")),
    enqueue_pending: toBoolean(formData.get("enqueuePending")),
    retry_failed: toBoolean(formData.get("retryFailed")),
    dry_run: toBoolean(formData.get("dryRun")),
  };

  let data: ReconcileResponse;
  try {
    data = await createInternalBackendTrpcClient().internal.mediaReconcile.mutate(payload);
  } catch (error) {
    redirect(`/admin/users?reconcile=error&reason=${encodeURIComponent(error instanceof Error ? error.message : String(error))}`);
  }

  const params = new URLSearchParams({
    reconcile: "ok",
    message: data.message,
    cleaned: String(data.actions.cleaned_bogus ?? 0),
    enqueued: String(data.actions.enqueued_pending ?? 0),
    retried: String(data.actions.retried_failed ?? 0),
    failedAfter: String(data.after.failed ?? 0),
    pendingAfter: String(data.after.pending ?? 0),
    dryRun: data.dry_run ? "1" : "0",
  });

  if (data.provider_group_id) {
    params.set("group", data.provider_group_id);
  }

  redirect(`/admin/users?${params.toString()}`);
}
