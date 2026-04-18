import type { WorkflowStatus } from "@/lib/api-client/types";

const STATUS_LABELS: Record<WorkflowStatus, string> = {
  draft: "Draft",
  ready: "Ready",
  published: "Published",
  archived: "Archived",
  active: "Active",
  inactive: "Inactive",
  provisioning: "Provisioning",
  failed: "Failed",
  queued: "Queued",
  processing: "Processing",
};

const STATUS_CLASSES: Record<WorkflowStatus, string> = {
  draft: "status status-draft",
  ready: "status status-ready",
  published: "status status-published",
  archived: "status status-archived",
  active: "status status-active",
  inactive: "status status-archived",
  provisioning: "status status-provisioning",
  failed: "status status-failed",
  queued: "status status-queued",
  processing: "status status-processing",
};

export function StatusBadge({ status }: { status: WorkflowStatus }) {
  return <span className={STATUS_CLASSES[status]}>{STATUS_LABELS[status]}</span>;
}
