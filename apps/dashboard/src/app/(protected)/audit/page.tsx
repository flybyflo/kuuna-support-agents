import Link from "next/link";
import { SimpleTable } from "@/components/data-table/simple-table";
import { PageHeader } from "@/components/ui/page-header";
import { listAuditEvents } from "@/lib/api-client";
import { formatDateTime } from "@/lib/utils/format";

export default async function AuditPage() {
  const events = await listAuditEvents();

  return (
    <div className="grid">
      <PageHeader
        title="Audit Events"
        description="Append-only operational events for governance and incident analysis."
      />

      <section className="panel">
        <SimpleTable
          data={events}
          columns={[
            {
              header: "Event",
              cell: (event) => (
                <div>
                  <strong>{event.eventType}</strong>
                  <p className="muted-text">{event.metadata}</p>
                </div>
              ),
            },
            {
              header: "Actor",
              cell: (event) => event.actor,
            },
            {
              header: "Entity",
              cell: (event) => (
                <span className="inline-code">
                  {event.entityType}:{event.entityId}
                </span>
              ),
            },
            {
              header: "Trace",
              cell: (event) => (
                <Link href={`/audit/traces/${event.traceId}`}>{event.traceId}</Link>
              ),
            },
            {
              header: "Time",
              cell: (event) => (
                <span className="muted-text">{formatDateTime(event.createdAt)}</span>
              ),
            },
          ]}
        />
      </section>
    </div>
  );
}
