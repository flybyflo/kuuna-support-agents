import { notFound } from "next/navigation";
import { SimpleTable } from "@/components/data-table/simple-table";
import { StatusBadge } from "@/components/status/status-badge";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/notice";
import { listBindings, listKnowledgeDocs } from "@/lib/api-client";
import { canAccessGroup, requireSession } from "@/lib/auth/session";
import { formatDateTime, titleFromGroupId } from "@/lib/utils/format";

type Params = Promise<{ groupId: string }>;

export default async function GroupKnowledgeDetailPage({
  params,
}: {
  params: Params;
}) {
  const { groupId } = await params;
  const providerGroupId = decodeURIComponent(groupId);
  const session = await requireSession();

  if (!canAccessGroup(session, providerGroupId)) {
    notFound();
  }

  const [bindings, docs] = await Promise.all([
    listBindings(),
    listKnowledgeDocs("group", providerGroupId),
  ]);

  const binding = bindings.find((item) => item.providerGroupId === providerGroupId);

  return (
    <div className="grid">
      <PageHeader
        title={binding?.groupTitle ?? titleFromGroupId(providerGroupId)}
        description={`Knowledge derived from ingested chat/media for ${providerGroupId}`}
      />

      <Notice title="Readiness" tone="info">
        Status reflects ingest pipeline health: <span className="inline-code">processing</span>,{" "}
        <span className="inline-code">ready</span>, or <span className="inline-code">failed</span>.
      </Notice>

      <section className="panel">
        <SimpleTable
          data={docs}
          emptyMessage="No group knowledge docs yet."
          columns={[
            {
              header: "Document",
              cell: (doc) => (
                <div>
                  <strong>{doc.title}</strong>
                  <p className="muted-text">{doc.chunkCount} chunks from ingested data</p>
                </div>
              ),
            },
            {
              header: "Status",
              cell: (doc) => <StatusBadge status={doc.status} />,
            },
            {
              header: "Updated",
              cell: (doc) => (
                <span className="muted-text">
                  {formatDateTime(doc.updatedAt)} by {doc.updatedBy}
                </span>
              ),
            },
          ]}
        />
      </section>
    </div>
  );
}
