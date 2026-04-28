import Link from "next/link";
import { GitBranch } from "lucide-react";

import { SimpleTable } from "@/components/data-table/simple-table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { listMessageDecisions } from "@/lib/api-client";
import { formatDateTime } from "@/lib/utils/format";

export default async function DecisionsPage() {
  const decisions = await listMessageDecisions();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Decisions"
        description="Stored message routing decisions from trigger and passive analysis."
      />

      <SimpleTable
        data={decisions}
        emptyMessage="No message decisions yet."
        columns={[
          {
            header: "Decision",
            cell: (decision) => (
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <GitBranch className="size-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="font-mono text-xs text-foreground">{decision.decisionType}</p>
                  {decision.reason ? (
                    <p className="text-xs text-muted-foreground">{decision.reason}</p>
                  ) : null}
                </div>
              </div>
            ),
          },
          {
            header: "Group",
            cell: (decision) => (
              <Link
                href={`/inbox/${encodeURIComponent(decision.providerGroupId)}`}
                className="text-sm text-foreground hover:underline"
              >
                {decision.groupTitle}
              </Link>
            ),
          },
          {
            header: "Execute",
            cell: (decision) => (
              <Badge variant={decision.shouldExecute ? "default" : "outline"}>
                {decision.shouldExecute ? "yes" : "no"}
              </Badge>
            ),
          },
          {
            header: "Payload",
            cell: (decision) => (
              <span className="line-clamp-2 max-w-[26rem] font-mono text-xs text-muted-foreground">
                {decision.payloadSummary || "n/a"}
              </span>
            ),
          },
          {
            header: "Created",
            cell: (decision) => (
              <span className="text-xs text-muted-foreground">
                {formatDateTime(decision.createdAt)}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}
