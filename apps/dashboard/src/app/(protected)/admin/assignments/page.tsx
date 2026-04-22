import { Plus } from "lucide-react";

import { SimpleTable } from "@/components/data-table/simple-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { listGroupAssignments } from "@/lib/api-client";
import { requireAuthorized } from "@/lib/auth/guards";

export default async function AdminAssignmentsPage() {
  await requireAuthorized("assignments", "read");

  const assignments = await listGroupAssignments();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Group assignments"
        description="Assign operators and viewers to specific provider groups."
        actions={
          <Button>
            <Plus aria-hidden />
            <span>Create assignment</span>
          </Button>
        }
      />

      <Notice title="Scope enforcement" tone="info">
        Non-admin roles can only view and act on groups listed in their
        assignments.
      </Notice>

      <Card className="overflow-hidden">
        <CardContent className="p-0 pt-0">
          <SimpleTable
            data={assignments}
            emptyMessage="No assignments yet."
            columns={[
              {
                header: "User",
                cell: (item) => (
                  <span className="font-medium text-foreground">
                    {item.user}
                  </span>
                ),
              },
              {
                header: "Provider group",
                cell: (item) => (
                  <code className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {item.providerGroupId}
                  </code>
                ),
              },
              {
                header: "Group title",
                cell: (item) => (
                  <span className="text-sm text-foreground">
                    {item.groupTitle}
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
