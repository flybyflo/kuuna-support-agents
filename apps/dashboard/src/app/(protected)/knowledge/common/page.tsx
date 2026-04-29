import Link from "next/link";
import { FilePlus2, Plus } from "lucide-react";

import { SimpleTable } from "@/components/data-table/simple-table";
import { StatusBadge } from "@/components/status/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormActions, FormRow } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { listKnowledgeDocs } from "@/lib/api-client";
import {
  createCommonKnowledgeDocAction,
  seedCyberheldCommonKnowledgeAction,
} from "@/lib/knowledge/actions";
import { formatDateTime } from "@/lib/utils/format";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function singleParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CommonKnowledgePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const docs = await listKnowledgeDocs("common");
  const params = await searchParams;
  const seedStatus = singleParam(params.seed);
  const seedCount = singleParam(params.count);
  const seedReason = singleParam(params.reason);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Common knowledge"
        description="Company-wide process knowledge managed by admins."
        actions={
          <Button variant="outline" asChild>
            <Link href="/knowledge/groups">View group knowledge</Link>
          </Button>
        }
      />

      <Notice title="Retrieval precedence" tone="info">
        Chat ingestion never writes company knowledge. Common knowledge is only
        changed through admin-managed documents.
      </Notice>

      {seedStatus === "created" ? (
        <Notice title="Cyberheld Common Knowledge created" tone="success">
          {seedCount ?? "4"} documents were created, published, and queued for vector indexing.
        </Notice>
      ) : null}

      {seedStatus === "skipped" ? (
        <Notice title="Seed skipped" tone="warning">
          Common Knowledge already exists. Seed documents are only available when the Common scope is empty.
        </Notice>
      ) : null}

      {seedStatus === "error" ? (
        <Notice title="Seed failed" tone="warning">
          {seedReason ?? "The Cyberheld seed documents could not be created."}
        </Notice>
      ) : null}

      {docs.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Start with Cyberheld defaults</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pb-6">
            <p className="text-sm text-muted-foreground">
              Create the four prepared Cyberheld Common Knowledge documents, publish them immediately, and queue vector indexing for retrieval.
            </p>
            <form action={seedCyberheldCommonKnowledgeAction}>
              <Button type="submit">
                <FilePlus2 className="size-4" aria-hidden />
                Create Cyberheld defaults
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Create Common document</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createCommonKnowledgeDocAction} className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <FormRow
              label="Title"
              htmlFor="title"
              hint="Human-readable name shown to admins."
            >
              <Input id="title" name="title" placeholder="Evidence intake process" required />
            </FormRow>
            <FormRow
              label="Document key"
              htmlFor="docKey"
              hint="Stable retrieval key, for example evidence-intake."
            >
              <Input id="docKey" name="docKey" placeholder="evidence-intake" required />
            </FormRow>
            <FormActions className="pt-0">
              <Button type="submit">
                <Plus className="size-4" aria-hidden />
                Create
              </Button>
            </FormActions>
          </form>
        </CardContent>
      </Card>

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
                    <Link
                      href={`/knowledge/common/${encodeURIComponent(doc.id)}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {doc.title}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {doc.docKey}
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
