import Link from "next/link";
import { SimpleTable } from "@/components/data-table/simple-table";
import { StatusBadge } from "@/components/status/status-badge";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { listTemplateVersions, listTemplates } from "@/lib/api-client";
import { formatDateTime } from "@/lib/utils/format";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function getSingleParam(value: string | string[] | undefined): string | undefined {
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
        publishedVersion: versions.find((version) => version.id === template.publishedVersionId),
      };
    }),
  );

  return (
    <div className="grid">
      <PageHeader
        title="Templates"
        description="Manage template versions, model failover chains, tools, and egress policy."
        actions={
          <Link href="/templates/new" className="button">
            New template
          </Link>
        }
      />

      {created === "1" ? (
        <Notice title="Template created" tone="success">
          You can now create a draft version, publish it, and bind a WhatsApp group.
        </Notice>
      ) : null}

      <section className="panel">
        <SimpleTable
          data={templates}
          columns={[
            {
              header: "Template",
              cell: (row) => (
                <div>
                  <Link href={`/templates/${row.id}`} style={{ fontWeight: 600 }}>
                    {row.displayName}
                  </Link>
                  <p className="muted-text">{row.key}</p>
                </div>
              ),
            },
            {
              header: "Description",
              cell: (row) => <span className="muted-text">{row.description}</span>,
            },
            {
              header: "Published",
              cell: (row) => {
                const version = versionsByTemplate.find(
                  (item) => item.templateId === row.id,
                )?.publishedVersion;

                if (!version) return <span className="muted-text">n/a</span>;

                return (
                  <div>
                    <span className="badge">v{version.versionNo}</span>
                    <div style={{ marginTop: 6 }}>
                      <StatusBadge status={version.status} />
                    </div>
                  </div>
                );
              },
            },
            {
              header: "Updated",
              cell: (row) => (
                <span className="muted-text">{formatDateTime(row.updatedAt)}</span>
              ),
            },
          ]}
        />
      </section>
    </div>
  );
}
