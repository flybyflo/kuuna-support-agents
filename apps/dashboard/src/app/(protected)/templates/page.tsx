import Link from "next/link";
import { Plus } from "lucide-react";

import { SimpleTable } from "@/components/data-table/simple-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { listTemplateVersions, listTemplates } from "@/lib/api-client";
import { formatDateTime } from "@/lib/utils/format";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function getSingleParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const created = getSingleParam(params.created);
  const templates = await listTemplates();
  const versionsByTemplate = await Promise.all(
    templates.map(async (template) => {
      const versions = await listTemplateVersions(template.id);
      return {
        templateId: template.id,
        publishedVersion: versions.find(
          (version) => version.id === template.publishedVersionId,
        ),
        versions,
      };
    }),
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Templates"
        description="Manage template versions, model failover chains, tools, and knowledge access."
        actions={
          <Button asChild>
            <Link href="/templates/new">
              <Plus aria-hidden />
              <span>New template</span>
            </Link>
          </Button>
        }
      />

      {created === "1" ? (
        <Notice title="Template created" tone="success">
          Configure it once, save, and the runtime image build will start automatically.
        </Notice>
      ) : null}

      <Card className="overflow-hidden">
        <CardContent className="p-0 pt-0">
          <SimpleTable
            data={templates}
            emptyMessage="No templates yet. Create one to get started."
            columns={[
              {
                header: "Template",
                cell: (row) => (
                  <div className="flex flex-col gap-0.5">
                    <Link
                      href={`/templates/${row.id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {row.displayName}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {row.key}
                    </span>
                  </div>
                ),
              },
              {
                header: "Description",
                cell: (row) => (
                  <span className="text-sm text-muted-foreground">
                    {row.description}
                  </span>
                ),
              },
              {
                header: "Active version",
                cell: (row) => {
                  const version = versionsByTemplate.find(
                    (item) => item.templateId === row.id,
                  )?.publishedVersion;

                  if (!version) {
                    return (
                      <span className="text-sm text-muted-foreground">
                        —
                      </span>
                    );
                  }

                  return (
                    <Badge variant="outline">v{version.versionNo}</Badge>
                  );
                },
              },
              {
                header: "Action",
                cell: (row) => {
                  const templateMeta = versionsByTemplate.find(
                    (item) => item.templateId === row.id,
                  );
                  if (!templateMeta) {
                    return (
                      <span className="text-sm text-muted-foreground">—</span>
                    );
                  }

                  if (!templateMeta.versions.length) {
                    return (
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/templates/${row.id}#configuration`}>
                          Configure
                        </Link>
                      </Button>
                    );
                  }

                  return (
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/templates/${row.id}`}>Open</Link>
                    </Button>
                  );
                },
              },
              {
                header: "Updated",
                cell: (row) => (
                  <span className="text-sm text-muted-foreground">
                    {formatDateTime(row.updatedAt)}
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
