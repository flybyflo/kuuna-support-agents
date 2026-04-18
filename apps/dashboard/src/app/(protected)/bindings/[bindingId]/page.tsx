import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/status/status-badge";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/notice";
import { getBinding, listBindingTimeline } from "@/lib/api-client";
import { requireSession, canAccessGroup } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/utils/format";

type Params = Promise<{ bindingId: string }>;

export default async function BindingDetailPage({
  params,
}: {
  params: Params;
}) {
  const { bindingId } = await params;
  const session = await requireSession();

  const binding = await getBinding(bindingId);
  if (!binding) {
    notFound();
  }

  if (!canAccessGroup(session, binding.providerGroupId)) {
    notFound();
  }

  const timeline = await listBindingTimeline(binding.id);

  return (
    <div className="grid">
      <PageHeader
        title={binding.groupTitle}
        description={`Provider group ID: ${binding.providerGroupId}`}
        actions={
          <button className="button button-danger" type="button">
            Unbind group
          </button>
        }
      />

      <section className="panel stack">
        <h2>Binding status</h2>
        <p>
          <StatusBadge status={binding.status} />
        </p>
        <p className="muted-text">Runtime mode: {binding.runtimeMode}</p>
        <p className="muted-text">Updated: {formatDateTime(binding.updatedAt)}</p>
      </section>

      <Notice title="Unbind behavior" tone="warning">
        Unbinding deactivates routing immediately. Existing messages, media, and
        transcripts are retained for audit and retrieval history.
      </Notice>

      <section className="panel">
        <h2>Lifecycle timeline</h2>
        <div className="timeline">
          {timeline.map((event) => (
            <article className="timeline-item" key={event.id}>
              <div className="timeline-item-head">
                <strong>{event.label}</strong>
                <StatusBadge status={event.status} />
              </div>
              <p className="muted-text">{formatDateTime(event.occurredAt)}</p>
              {event.details ? <p className="muted-text">{event.details}</p> : null}
            </article>
          ))}
          {!timeline.length ? <p className="muted-text">No timeline events yet.</p> : null}
        </div>
      </section>
    </div>
  );
}
