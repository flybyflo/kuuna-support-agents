import { MetricCard } from "@/components/ui/metric-card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import {
  listAuditEvents,
  listBindings,
  listKnowledgeDocs,
  listMessages,
  listTemplates,
  listTools,
} from "@/lib/api-client";

export default async function OverviewPage() {
  const [templates, bindings, commonDocs, messages, auditEvents, tools] = await Promise.all([
    listTemplates(),
    listBindings(),
    listKnowledgeDocs(),
    listMessages(),
    listAuditEvents(),
    listTools(),
  ]);

  const activeBindings = bindings.filter((item) => item.status === "active").length;
  const provisioningBindings = bindings.filter(
    (item) => item.status === "provisioning",
  ).length;

  return (
    <div className="grid">
      <PageHeader
        title="Operations Overview"
        description="Quick operational status across templates, bindings, ingestion, and audit trails."
      />

      <section className="grid grid-metrics">
        <MetricCard label="Templates" value={templates.length} hint="Published + draft" />
        <MetricCard label="Active bindings" value={activeBindings} hint="1:1 group bindings" />
        <MetricCard
          label="Provisioning"
          value={provisioningBindings}
          hint="Pending activation"
        />
        <MetricCard label="Knowledge docs" value={commonDocs.length} hint="Common + group" />
        <MetricCard label="Messages" value={messages.length} hint="Persisted inbound events" />
        <MetricCard label="Tools" value={tools.length} hint="Catalog entries" />
        <MetricCard label="Audit events" value={auditEvents.length} hint="Append-only trail" />
      </section>

      <Notice title="MVP Mode" tone="info">
        This dashboard currently runs with mocked control-plane data while API and
        queue services are being connected.
      </Notice>
    </div>
  );
}
