import Link from "next/link";
import { SimpleTable } from "@/components/data-table/simple-table";
import { StatusBadge } from "@/components/status/status-badge";
import { PageHeader } from "@/components/ui/page-header";
import { listPromptAssets } from "@/lib/api-client";
import { formatDateTime } from "@/lib/utils/format";

export default async function PromptsPage() {
  const assets = await listPromptAssets();

  return (
    <div className="grid">
      <PageHeader
        title="Prompt Governance"
        description="Draft, publish, and rollback system prompt and USER.md assets per instance."
      />

      <section className="panel">
        <SimpleTable
          data={assets}
          columns={[
            {
              header: "Asset",
              cell: (asset) => (
                <div>
                  <Link href={`/prompts/${asset.instanceId}`} style={{ fontWeight: 600 }}>
                    {asset.title}
                  </Link>
                  <p className="muted-text">{asset.type === "system" ? "System prompt" : "USER.md"}</p>
                </div>
              ),
            },
            {
              header: "Instance",
              cell: (asset) => <span className="inline-code">{asset.instanceId}</span>,
            },
            {
              header: "Version",
              cell: (asset) => <span className="badge">v{asset.versionNo}</span>,
            },
            {
              header: "Status",
              cell: (asset) => <StatusBadge status={asset.status} />,
            },
            {
              header: "Updated",
              cell: (asset) => (
                <span className="muted-text">
                  {formatDateTime(asset.updatedAt)} by {asset.updatedBy}
                </span>
              ),
            },
          ]}
        />
      </section>
    </div>
  );
}
