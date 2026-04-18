import { SimpleTable } from "@/components/data-table/simple-table";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { listGroupAssignments } from "@/lib/api-client";
import { requireAuthorized } from "@/lib/auth/guards";

export default async function AdminAssignmentsPage() {
  await requireAuthorized("assignments", "read");

  const assignments = await listGroupAssignments();

  return (
    <div className="grid">
      <PageHeader
        title="Group Assignments"
        description="Assign operators/viewers to specific provider groups."
        actions={<button className="button">Create assignment</button>}
      />

      <Notice title="Scope enforcement" tone="info">
        Non-admin roles can only view and act on groups listed in their assignments.
      </Notice>

      <section className="panel">
        <SimpleTable
          data={assignments}
          columns={[
            {
              header: "User",
              cell: (item) => item.user,
            },
            {
              header: "Provider group",
              cell: (item) => (
                <span className="inline-code">{item.providerGroupId}</span>
              ),
            },
            {
              header: "Group title",
              cell: (item) => item.groupTitle,
            },
          ]}
        />
      </section>
    </div>
  );
}
