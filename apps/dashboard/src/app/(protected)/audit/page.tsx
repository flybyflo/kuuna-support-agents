import Link from "next/link";

import { SimpleTable } from "@/components/data-table/simple-table";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { listAuditEvents } from "@/lib/api-client";
import { formatDateTime } from "@/lib/utils/format";

export default async function AuditPage() {
  const events = await listAuditEvents();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Audit events"
        description="Append-only operational events for governance and incident analysis."
      />

      <Card className="overflow-hidden">
        <CardContent className="p-0 pt-0">
          <SimpleTable
            data={events}
            emptyMessage="No audit events recorded yet."
            columns={[
              {
                header: "Event",
                cell: (event) => (
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-foreground">
                      {event.eventType}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {event.metadata}
                    </span>
                  </div>
                ),
              },
              {
                header: "Actor",
                cell: (event) => (
                  <span className="text-sm text-foreground">{event.actor}</span>
                ),
              },
              {
                header: "Entity",
                cell: (event) => (
                  <code className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {event.entityType}:{event.entityId}
                  </code>
                ),
              },
              {
                header: "Trace",
                cell: (event) => (
                  <Link
                    href={`/audit/traces/${event.traceId}`}
                    className="font-mono text-xs text-primary hover:underline"
                  >
                    {event.traceId}
                  </Link>
                ),
              },
              {
                header: "Time",
                cell: (event) => (
                  <span className="text-sm text-muted-foreground">
                    {formatDateTime(event.createdAt)}
                  </span>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
