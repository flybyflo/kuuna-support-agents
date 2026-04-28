import Link from "next/link";
import { Wrench } from "lucide-react";

import { SimpleTable } from "@/components/data-table/simple-table";
import { AutoRefresh } from "@/components/system/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { listToolInvocations } from "@/lib/api-client";
import { formatDateTime } from "@/lib/utils/format";

export default async function ToolInvocationsPage() {
  const invocations = await listToolInvocations();

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh intervalMs={6000} />
      <PageHeader
        title="Tool Logs"
        description="Runtime tool calls captured from agent executions."
      />

      <SimpleTable
        data={invocations}
        emptyMessage="No tool invocations yet."
        columns={[
          {
            header: "Tool",
            cell: (invocation) => (
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Wrench className="size-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="font-mono text-xs text-foreground">{invocation.toolName}</p>
                  <p className="text-xs text-muted-foreground">{invocation.durationMs} ms</p>
                </div>
              </div>
            ),
          },
          {
            header: "Group",
            cell: (invocation) => (
              <Link
                href={`/inbox/${encodeURIComponent(invocation.providerGroupId)}`}
                className="text-sm text-foreground hover:underline"
              >
                {invocation.groupTitle}
              </Link>
            ),
          },
          {
            header: "Status",
            cell: (invocation) => (
              <Badge variant={invocation.ok ? "default" : "outline"}>
                {invocation.timedOut ? "timeout" : invocation.ok ? "ok" : "failed"}
              </Badge>
            ),
          },
          {
            header: "Output",
            cell: (invocation) => (
              <div className="max-w-[28rem]">
                {invocation.stderrPreview ? (
                  <p className="line-clamp-2 font-mono text-xs text-destructive">
                    {invocation.stderrPreview}
                  </p>
                ) : (
                  <p className="line-clamp-2 font-mono text-xs text-muted-foreground">
                    {invocation.stdoutPreview || invocation.detailsSummary || "n/a"}
                  </p>
                )}
              </div>
            ),
          },
          {
            header: "Run",
            cell: (invocation) => (
              <span className="font-mono text-xs text-muted-foreground">
                {invocation.agentRunId?.slice(0, 8) ?? "n/a"}
              </span>
            ),
          },
          {
            header: "Created",
            cell: (invocation) => (
              <span className="text-xs text-muted-foreground">
                {formatDateTime(invocation.createdAt)}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}
