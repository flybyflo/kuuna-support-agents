import Link from "next/link";
import { CheckSquare } from "lucide-react";

import { SimpleTable } from "@/components/data-table/simple-table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { listTodos } from "@/lib/api-client";
import { formatDateTime } from "@/lib/utils/format";

export default async function TodosPage() {
  const todos = await listTodos();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Todos"
        description="Tasks created by group agents for staff follow-up."
      />

      <SimpleTable
        data={todos}
        emptyMessage="No todos yet."
        columns={[
          {
            header: "Todo",
            cell: (todo) => (
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <CheckSquare className="size-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{todo.title}</p>
                  {todo.description ? (
                    <p className="line-clamp-2 text-xs text-muted-foreground">{todo.description}</p>
                  ) : null}
                </div>
              </div>
            ),
          },
          {
            header: "Group",
            cell: (todo) => (
              <Link
                href={`/messages/${encodeURIComponent(todo.providerGroupId)}`}
                className="text-sm text-foreground hover:underline"
              >
                {todo.groupTitle}
              </Link>
            ),
          },
          {
            header: "Status",
            cell: (todo) => <Badge variant="outline">{todo.status}</Badge>,
          },
          {
            header: "Priority",
            cell: (todo) => <Badge>{todo.priority}</Badge>,
          },
          {
            header: "Due",
            cell: (todo) => (
              <span className="text-xs text-muted-foreground">
                {todo.dueAt ? formatDateTime(todo.dueAt) : "n/a"}
              </span>
            ),
          },
          {
            header: "Export",
            cell: (todo) => (
              <div className="text-xs text-muted-foreground">
                {todo.exportedAt ? (
                  <span>{formatDateTime(todo.exportedAt)}</span>
                ) : todo.lastExportError ? (
                  <span className="text-destructive">failed</span>
                ) : (
                  <span>pending</span>
                )}
              </div>
            ),
          },
          {
            header: "Updated",
            cell: (todo) => (
              <span className="text-xs text-muted-foreground">
                {formatDateTime(todo.updatedAt)}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}
