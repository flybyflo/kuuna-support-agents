import { TodosTable } from "@/components/todos/todos-table";
import { Notice } from "@/components/ui/notice";
import { listTodos } from "@/lib/api-client";
import { hasPermission, type StaffSession } from "@/lib/auth/session";

export async function TodosTab({
  providerGroupId,
  session,
}: {
  providerGroupId: string;
  session: StaffSession;
}) {
  const todos = await listTodos(providerGroupId);

  if (todos.length === 0) {
    return (
      <div className="p-4">
        <Notice title="No todos" tone="info">
          The agent has not created any tasks for this group yet.
        </Notice>
      </div>
    );
  }

  return (
    <div className="p-4">
      <TodosTable
        todos={todos}
        canUpdateStatus={hasPermission(session, "todos", "write")}
        hideGroupColumn
      />
    </div>
  );
}
