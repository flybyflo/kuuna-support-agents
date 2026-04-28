import Link from "next/link";
import { Plug } from "lucide-react";

import { SimpleTable } from "@/components/data-table/simple-table";
import { StatusBadge } from "@/components/status/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { listBindings, listTemplates, listTemplateVersions } from "@/lib/api-client";
import { requireSession, canAccessGroup } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/utils/format";
import { resolveGroupTitle } from "@/lib/utils/group-title";
import { listWhatsAppGatewayGroups } from "@/lib/whatsapp/ops";

export default async function BindingsPage() {
  const session = await requireSession();
  const [allBindings, gatewayGroups, templates] = await Promise.all([
    listBindings(),
    listWhatsAppGatewayGroups(),
    listTemplates(),
  ]);

  const scopedBindings = allBindings.filter((binding) =>
    canAccessGroup(session, binding.providerGroupId),
  );

  const versionLabelMap = new Map<string, string>();
  await Promise.all(
    templates.map(async (template) => {
      const versions = await listTemplateVersions(template.id);
      versions.forEach((version) => {
        versionLabelMap.set(version.id, `v${version.versionNo}`);
      });
    }),
  );

  const rows = scopedBindings
    .map((binding) => ({
      ...binding,
      displayTitle: resolveGroupTitle({
        providerGroupId: binding.providerGroupId,
        bindings: scopedBindings,
        gatewayGroups,
        fallback: binding.groupTitle,
      }),
    }))
    .sort((left, right) => left.displayTitle.localeCompare(right.displayTitle));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Group bindings"
        description="One active agent binding per provider group ID."
        actions={
          <Button asChild>
            <Link href="/bindings/create">
              <Plug aria-hidden />
              <span>Bind group</span>
            </Link>
          </Button>
        }
      />

      <Card className="overflow-hidden">
        <CardContent className="p-0 pt-0">
          <SimpleTable
            data={rows}
            emptyMessage="You don't have access to any bound groups yet."
            columns={[
              {
                header: "WhatsApp group",
                cell: (row) => (
                  <div className="flex flex-col gap-0.5">
                    <Link
                      href={`/bindings/${row.id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {row.displayTitle}
                    </Link>
                    <code className="font-mono text-xs text-muted-foreground">
                      {row.providerGroupId}
                    </code>
                  </div>
                ),
              },
              {
                header: "Status",
                cell: (row) => <StatusBadge status={row.status} />,
              },
              {
                header: "Runtime",
                cell: (row) => (
                  <Badge variant="outline">{row.runtimeMode}</Badge>
                ),
              },
              {
                header: "Template version",
                cell: (row) => (
                  <span className="text-sm text-foreground">
                    {versionLabelMap.get(row.templateVersionId) ??
                      row.templateVersionId}
                  </span>
                ),
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
