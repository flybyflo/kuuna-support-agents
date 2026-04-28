import Link from "next/link";
import { Bot } from "lucide-react";

import { SimpleTable } from "@/components/data-table/simple-table";
import { AutoRefresh } from "@/components/system/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { listAgentRuns } from "@/lib/api-client";
import { formatDateTime } from "@/lib/utils/format";

export default async function AgentRunsPage() {
  const runs = await listAgentRuns();

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh intervalMs={6000} eventTypes={["agent_run.updated"]} />
      <PageHeader
        title="Agent Runs"
        description="Runtime executions, model selection, and tool availability."
      />

      <SimpleTable
        data={runs}
        emptyMessage="No agent runs yet."
        columns={[
          {
            header: "Run",
            cell: (run) => (
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Bot className="size-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <Link
                    href={`/agent-runs/${run.id}`}
                    className="font-mono text-xs text-foreground hover:underline"
                  >
                    {run.id}
                  </Link>
                  {run.traceId ? (
                    <p className="font-mono text-[0.6875rem] text-muted-foreground">
                      {run.traceId}
                    </p>
                  ) : null}
                </div>
              </div>
            ),
          },
          {
            header: "Group",
            cell: (run) => (
              <Link
                href={`/inbox/${encodeURIComponent(run.providerGroupId)}`}
                className="text-sm text-foreground hover:underline"
              >
                {run.groupTitle}
              </Link>
            ),
          },
          {
            header: "Status",
            cell: (run) => <Badge variant="outline">{run.status}</Badge>,
          },
          {
            header: "Model",
            cell: (run) => (
              <span className="font-mono text-xs text-foreground">
                {run.modelUsed ?? run.modelPath[0] ?? "n/a"} / {run.reasoningEffort}
              </span>
            ),
          },
          {
            header: "Tools",
            cell: (run) => (
              <span className="text-xs text-muted-foreground">
                {run.allowedTools.length ? run.allowedTools.join(", ") : "none"}
              </span>
            ),
          },
          {
            header: "Started",
            cell: (run) => (
              <span className="text-xs text-muted-foreground">
                {formatDateTime(run.startedAt)}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}
