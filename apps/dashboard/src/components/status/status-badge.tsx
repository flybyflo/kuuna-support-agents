import { Badge, type BadgeProps } from "@/components/ui/badge";
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

const STATUS_VARIANTS: Record<WorkflowStatus, BadgeProps["variant"]> = {
  draft: "violet",
  ready: "info",
  published: "success",
  active: "success",
  archived: "secondary",
  inactive: "secondary",
  provisioning: "warning",
  queued: "warning",
  processing: "warning",
  failed: "destructive",
};

export function StatusBadge({ status }: { status: WorkflowStatus }) {
  return (
    <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>
  );
}
