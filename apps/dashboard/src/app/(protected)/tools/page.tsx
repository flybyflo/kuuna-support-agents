import { SimpleTable } from "@/components/data-table/simple-table";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { listTools } from "@/lib/api-client";
import { formatDateTime } from "@/lib/utils/format";

function riskLabel(riskClass: "read" | "write" | "admin"): string {
  if (riskClass === "admin") return "Admin";
  if (riskClass === "write") return "Write";
  return "Read";
}

function riskVariant(
  riskClass: "read" | "write" | "admin",
): BadgeProps["variant"] {
  if (riskClass === "admin") return "destructive";
  if (riskClass === "write") return "warning";
  return "info";
}

export default async function ToolsPage() {
  const tools = await listTools();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Tool catalog"
        description="All available tools with risk class and description used by runtime templates."
      />

      <Card className="overflow-hidden">
        <CardContent className="p-0 pt-0">
          <SimpleTable
            data={tools}
            emptyMessage="No tools available yet."
            columns={[
              {
                header: "Tool",
                cell: (row) => (
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-foreground">
                      {row.displayName}
                    </span>
                    <code className="font-mono text-xs text-muted-foreground">
                      {row.toolKey}
                    </code>
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
                header: "Risk",
                cell: (row) => (
                  <Badge variant={riskVariant(row.riskClass)}>
                    {riskLabel(row.riskClass)}
                  </Badge>
                ),
              },
              {
                header: "Category",
                cell: (row) => (
                  <span className="text-sm text-muted-foreground">
                    {row.category}
                  </span>
                ),
              },
              {
                header: "Status",
                cell: (row) =>
                  row.isEnabled ? (
                    <Badge variant="success">Enabled</Badge>
                  ) : (
                    <Badge variant="secondary">Disabled</Badge>
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
