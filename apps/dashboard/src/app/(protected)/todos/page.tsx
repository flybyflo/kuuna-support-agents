import { TodosTable } from "@/components/todos/todos-table";
import { PageHeader } from "@/components/ui/page-header";
import { listTodos } from "@/lib/api-client";
import { requireAuthorized } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/session";

export default async function TodosPage() {
  const [session, todos] = await Promise.all([
    requireAuthorized("todos", "read"),
    listTodos(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Todos"
        description="Tasks created by group agents for staff follow-up."
      />

      <TodosTable
        todos={todos}
        canUpdateStatus={hasPermission(session, "todos", "write")}
      />
    </div>
  );
}
