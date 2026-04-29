import { notFound } from "next/navigation";
import { FileText, Rocket } from "lucide-react";

import { SimpleTable } from "@/components/data-table/simple-table";
import { StatusBadge } from "@/components/status/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormActions, FormRow } from "@/components/ui/form";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import { listKnowledgeDocs, listKnowledgeVersions } from "@/lib/api-client";
import {
  createCommonKnowledgeDraftAction,
  publishCommonKnowledgeVersionAction,
} from "@/lib/knowledge/actions";
import { formatDateTime } from "@/lib/utils/format";

type Params = Promise<{ docId: string }>;

export default async function CommonKnowledgeDetailPage({
  params,
}: {
  params: Params;
}) {
  const { docId: rawDocId } = await params;
  const docId = decodeURIComponent(rawDocId);
  const [docs, versions] = await Promise.all([
    listKnowledgeDocs("common"),
    listKnowledgeVersions(docId),
  ]);
  const doc = docs.find((item) => item.id === docId);

  if (!doc) {
    notFound();
  }

  const latest = versions[0];
  const published = versions.find((version) => version.status === "published");
  const starterMarkdown = published?.contentMarkdown ?? latest?.contentMarkdown ?? "";

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={doc.title}
        description={`Common Knowledge document: ${doc.docKey}`}
      />

      <Notice title="How this becomes retrievable" tone="info">
        Save a Markdown draft, then publish it. Publishing archives the previous
        published version and indexes the new Markdown into retrieval chunks and
        embeddings under this document key.
      </Notice>

      <Card>
        <CardHeader>
          <CardTitle>Markdown draft</CardTitle>
          <CardDescription>
            Use short headings and focused sections. Each published version is
            chunked for semantic retrieval.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createCommonKnowledgeDraftAction} className="flex flex-col gap-4">
            <input type="hidden" name="docRefId" value={doc.id} />
            <FormRow
              label="Content"
              htmlFor="contentMarkdown"
              hint="Write company-wide process knowledge only. Never paste client, case, evidence or WhatsApp chat data here."
            >
              <Textarea
                id="contentMarkdown"
                name="contentMarkdown"
                className="min-h-[360px] font-mono text-sm"
                placeholder={"# Evidence intake\n\n## When a client uploads evidence\n\n- Create a Todo\n- Preserve source metadata\n"}
                defaultValue={starterMarkdown}
                required
              />
            </FormRow>
            <FormActions>
              <Button type="submit">
                <FileText className="size-4" aria-hidden />
                Save draft
              </Button>
            </FormActions>
          </form>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Versions</CardTitle>
          <CardDescription>
            Only the published version is used for retrieval.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            data={versions}
            emptyMessage="No versions yet. Save the first Markdown draft."
            columns={[
              {
                header: "Version",
                cell: (version) => (
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-foreground">
                      Version {version.versionNo}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {version.contentMarkdown.length} characters
                    </span>
                  </div>
                ),
              },
              {
                header: "Status",
                cell: (version) => <StatusBadge status={version.status} />,
              },
              {
                header: "Updated",
                cell: (version) => (
                  <span className="text-sm text-muted-foreground">
                    {formatDateTime(version.updatedAt)} by {version.updatedBy}
                  </span>
                ),
              },
              {
                header: "Action",
                cell: (version) =>
                  version.status === "draft" || version.status === "ready" ? (
                    <form action={publishCommonKnowledgeVersionAction}>
                      <input type="hidden" name="docRefId" value={doc.id} />
                      <input type="hidden" name="versionId" value={version.id} />
                      <Button size="sm" type="submit">
                        <Rocket className="size-4" aria-hidden />
                        Publish
                      </Button>
                    </form>
                  ) : (
                    <span className="text-xs text-muted-foreground">No action</span>
                  ),
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
