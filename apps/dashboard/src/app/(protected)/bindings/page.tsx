import Link from "next/link";
import { SimpleTable } from "@/components/data-table/simple-table";
import { StatusBadge } from "@/components/status/status-badge";
import { PageHeader } from "@/components/ui/page-header";
import { listBindings, listTemplateVersions } from "@/lib/api-client";
import { requireSession, canAccessGroup } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/utils/format";

export default async function BindingsPage() {
  const session = await requireSession();
  const allBindings = await listBindings();
  const scopedBindings = allBindings.filter((binding) =>
    canAccessGroup(session, binding.providerGroupId),
  );

  const versionLabelMap = new Map<string, string>();
  const templateIds = [...new Set(scopedBindings.map((item) => item.templateVersionId.split("-")[1]))];

  await Promise.all(
    templateIds.map(async (templateKey) => {
      const templateId = `tpl-${templateKey}`;
      const versions = await listTemplateVersions(templateId);
      versions.forEach((version) => {
        versionLabelMap.set(version.id, `v${version.versionNo}`);
      });
    }),
  );

  return (
    <div className="grid">
      <PageHeader
        title="Group Bindings"
        description="One active agent binding per provider group ID."
        actions={
          <Link href="/bindings/create" className="button">
            Bind group
          </Link>
        }
      />

      <section className="panel">
        <SimpleTable
          data={scopedBindings}
          columns={[
            {
              header: "Group",
              cell: (row) => (
                <div>
                  <Link href={`/bindings/${row.id}`} style={{ fontWeight: 600 }}>
                    {row.groupTitle}
                  </Link>
                  <p className="muted-text">
                    <span className="inline-code">{row.providerGroupId}</span>
                  </p>
                </div>
              ),
            },
            {
              header: "Status",
              cell: (row) => <StatusBadge status={row.status} />,
            },
            {
              header: "Runtime",
              cell: (row) => row.runtimeMode,
            },
            {
              header: "Template version",
              cell: (row) => versionLabelMap.get(row.templateVersionId) ?? row.templateVersionId,
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
