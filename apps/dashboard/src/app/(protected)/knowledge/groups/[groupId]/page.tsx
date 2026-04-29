import { notFound } from "next/navigation";

import { SimpleTable } from "@/components/data-table/simple-table";
import { StatusBadge } from "@/components/status/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
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
    listKnowledgeDocs(undefined, providerGroupId),
  ]);

  const binding = bindings.find(
    (item) => item.providerGroupId === providerGroupId,
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={binding?.groupTitle ?? titleFromGroupId(providerGroupId)}
        description={`Group and customer-scoped knowledge for ${providerGroupId}`}
      />

      <Notice title="Readiness" tone="info">
        Status reflects ingest pipeline health:{" "}
        <code className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
          processing
        </code>
        ,{" "}
        <code className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
          ready
        </code>
        , or{" "}
        <code className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
          failed
        </code>
        .
      </Notice>

      <Card className="overflow-hidden">
        <CardContent className="p-0 pt-0">
          <SimpleTable
            data={docs}
            emptyMessage="No group or customer knowledge docs yet."
            columns={[
              {
                header: "Document",
                cell: (doc) => (
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-foreground">
                      {doc.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {doc.scope} · {doc.chunkCount} chunks from ingested data
                    </span>
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
                  <span className="text-sm text-muted-foreground">
                    {formatDateTime(doc.updatedAt)} by {doc.updatedBy}
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
