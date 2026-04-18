import { SimpleTable } from "@/components/data-table/simple-table";
import { PageHeader } from "@/components/ui/page-header";
import { listTools } from "@/lib/api-client";
import { formatDateTime } from "@/lib/utils/format";

function riskLabel(riskClass: "read" | "write" | "admin"): string {
  if (riskClass === "admin") return "Admin";
  if (riskClass === "write") return "Write";
  return "Read";
}

export default async function ToolsPage() {
  const tools = await listTools();

  return (
    <div className="grid">
      <PageHeader
        title="Tool Catalog"
        description="All available tools with risk class and description used by runtime templates."
      />

      <section className="panel">
        <SimpleTable
          data={tools}
          emptyMessage="No tools available yet."
          columns={[
            {
              header: "Tool",
              cell: (row) => (
                <div>
                  <p style={{ fontWeight: 600 }}>{row.displayName}</p>
                  <p className="muted-text">{row.toolKey}</p>
                </div>
              ),
            },
            {
              header: "Description",
              cell: (row) => <span className="muted-text">{row.description}</span>,
            },
            {
              header: "Risk",
              cell: (row) => <span className="badge">{riskLabel(row.riskClass)}</span>,
            },
            {
              header: "Category",
              cell: (row) => <span className="muted-text">{row.category}</span>,
            },
            {
              header: "Status",
              cell: (row) => (
                <span className={row.isEnabled ? "status status-active" : "status status-archived"}>
                  {row.isEnabled ? "Enabled" : "Disabled"}
                </span>
              ),
            },
            {
              header: "Updated",
              cell: (row) => <span className="muted-text">{formatDateTime(row.updatedAt)}</span>,
            },
          ]}
        />
      </section>
    </div>
  );
}
