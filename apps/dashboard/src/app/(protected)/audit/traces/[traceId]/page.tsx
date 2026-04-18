import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/notice";
import { getTraceDetail } from "@/lib/api-client";

type Params = Promise<{ traceId: string }>;

export default async function TraceDetailPage({
  params,
}: {
  params: Params;
}) {
  const { traceId } = await params;
  const detail = await getTraceDetail(traceId);

  if (!detail) {
    notFound();
  }

  return (
    <div className="grid">
      <PageHeader
        title={`Trace ${detail.traceId}`}
        description="End-to-end correlation across ingest, retrieval, model path, and outbound intent."
      />

      <section className="panel stack">
        <p>
          Provider group: <span className="inline-code">{detail.providerGroupId}</span>
        </p>
        <p>
          Inbound event: <span className="inline-code">{detail.inboundEventId}</span>
        </p>
        <p>
          Outbound intent: <span className="inline-code">{detail.outboundIntentId}</span>
        </p>
      </section>

      <section className="panel stack">
        <h2>Retrieval references</h2>
        <ul className="inline-list">
          {detail.retrievalRefs.map((reference) => (
            <li key={reference}>{reference}</li>
          ))}
        </ul>
      </section>

      <section className="panel stack">
        <h2>Model failover path</h2>
        <p>{detail.modelPath.join(" → ")}</p>
      </section>

      <Notice title="Privacy" tone="info">
        Dashboard trace view intentionally shows metadata only. Raw user content is
        excluded from logs and Sentry in MVP.
      </Notice>
    </div>
  );
}
