import { AutoRefresh } from "@/components/system/auto-refresh";
import { TodosTable } from "@/components/todos/todos-table";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/notice";
import { listTodos } from "@/lib/api-client";
import { hasPermission, requireSession } from "@/lib/auth/session";

export default async function GlobalTodosPage() {
  const [session, todos] = await Promise.all([requireSession(), listTodos()]);

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh intervalMs={6000} eventTypes={["todo.updated"]} />
      <PageHeader
        title="Todos"
        description="Open staff follow-ups from every chat you can access."
      />

      {todos.length > 0 ? (
        <TodosTable
          todos={todos}
          canUpdateStatus={hasPermission(session, "todos", "write")}
        />
      ) : (
        <Notice title="No todos" tone="info">
          No chat has created a staff follow-up yet.
        </Notice>
      )}
    </div>
  );
}
