import Link from "next/link";
import { SimpleTable } from "@/components/data-table/simple-table";
import { StatusBadge } from "@/components/status/status-badge";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/notice";
import { listKnowledgeDocs } from "@/lib/api-client";
import { formatDateTime } from "@/lib/utils/format";

export default async function CommonKnowledgePage() {
  const docs = await listKnowledgeDocs("common");

  return (
    <div className="grid">
      <PageHeader
        title="Common Knowledge"
        description="Aggregated from ingested chat + transcript data stored in the database."
        actions={
          <Link href="/knowledge/groups" className="button button-secondary">
            View group knowledge
          </Link>
        }
      />

      <Notice title="Retrieval precedence" tone="info">
        Group knowledge is ranked above common knowledge during context assembly.
      </Notice>

      <section className="panel">
        <SimpleTable
          data={docs}
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
