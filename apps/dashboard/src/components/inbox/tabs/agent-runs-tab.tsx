import Link from "next/link";
import { Bot, ExternalLink } from "lucide-react";

import { SimpleTable } from "@/components/data-table/simple-table";
import { AutoRefresh } from "@/components/system/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listAgentRuns } from "@/lib/api-client";
import { formatDateTime } from "@/lib/utils/format";

export async function AgentRunsTab({
  providerGroupId,
}: {
  providerGroupId: string;
}) {
  const runs = await listAgentRuns(providerGroupId);

  return (
    <div className="flex flex-col gap-4 p-4">
      <AutoRefresh intervalMs={6000} eventTypes={["agent_run.updated"]} />
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border">
          <CardTitle>Agent Runs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            data={runs}
            emptyMessage="No agent runs for this chat yet."
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
                header: "Response",
                cell: (run) => (
                  <span className="line-clamp-2 max-w-xl text-sm text-muted-foreground">
                    {run.responsePreview ?? run.error ?? "No response yet"}
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
              {
                header: "Details",
                cell: (run) => (
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/agent-runs/${run.id}`}>
                      <ExternalLink className="size-4" aria-hidden />
                      Open
                    </Link>
                  </Button>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
