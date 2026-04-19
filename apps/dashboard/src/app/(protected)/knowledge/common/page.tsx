import Link from "next/link";

import { SimpleTable } from "@/components/data-table/simple-table";
import { StatusBadge } from "@/components/status/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { listKnowledgeDocs } from "@/lib/api-client";
import { formatDateTime } from "@/lib/utils/format";

export default async function CommonKnowledgePage() {
  const docs = await listKnowledgeDocs("common");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Common knowledge"
        description="Aggregated from ingested chat + transcript data stored in the database."
        actions={
          <Button variant="outline" asChild>
            <Link href="/knowledge/groups">View group knowledge</Link>
          </Button>
        }
      />

      <Notice title="Retrieval precedence" tone="info">
        Group knowledge is ranked above common knowledge during context
        assembly.
      </Notice>

      <Card className="overflow-hidden">
        <CardContent className="p-0 pt-0">
          <SimpleTable
            data={docs}
            emptyMessage="No common knowledge ingested yet."
            columns={[
              {
                header: "Document",
                cell: (doc) => (
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-foreground">
                      {doc.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {doc.chunkCount} chunks from ingested data
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
