"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  CheckSquare,
  Download,
  ExternalLink,
  File,
  Image as ImageIcon,
  Music,
  Video,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MediaAsset, TodoItem } from "@kuuna/api-client-ts";
import { updateTodoStatusAction } from "@/lib/todos/actions";
import { formatDateTime } from "@/lib/utils/format";

type TodoStatus = TodoItem["status"];

type TodosTableProps = {
  todos: TodoItem[];
  canUpdateStatus: boolean;
  hideGroupColumn?: boolean;
};

const STATUS_OPTIONS: Array<{ value: TodoStatus; label: string }> = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
];

function statusLabel(status: TodoStatus): string {
  return STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

function priorityLabel(priority: TodoItem["priority"]): string {
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

function formatByteSize(value: number | undefined): string | null {
  if (!value || value <= 0) {
    return null;
  }

  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB"] as const;
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function MediaIcon({ asset }: { asset: MediaAsset }) {
  if (asset.kind === "image") return <ImageIcon aria-hidden />;
  if (asset.kind === "audio") return <Music aria-hidden />;
  if (asset.kind === "video") return <Video aria-hidden />;
  return <File aria-hidden />;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="max-w-[65%] text-right text-sm text-foreground">{value}</dd>
    </div>
  );
}

function AttachmentList({ attachments }: { attachments: MediaAsset[] }) {
  if (attachments.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
        No files linked.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {attachments.map((asset) => {
        const byteSize = formatByteSize(asset.byteSize);
        return (
          <div
            key={asset.id}
            className="flex flex-col gap-3 rounded-md border border-border bg-card p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2">
                <span className="mt-0.5 text-muted-foreground">
                  <MediaIcon asset={asset} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {asset.filename}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {asset.mimeType ? <span>{asset.mimeType}</span> : null}
                    {byteSize ? <span>{byteSize}</span> : null}
                    <Badge variant="outline">{asset.status}</Badge>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {asset.viewUrl ? (
                  <Button asChild type="button" variant="outline" size="sm">
                    <a href={asset.viewUrl} target="_blank" rel="noreferrer">
                      <ExternalLink aria-hidden />
                      <span>View</span>
                    </a>
                  </Button>
                ) : null}
                {asset.downloadUrl ? (
                  <Button asChild type="button" variant="outline" size="sm">
                    <a href={asset.downloadUrl} download={asset.filename}>
                      <Download aria-hidden />
                      <span>Download</span>
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>
            {asset.transcript ? (
              <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-xs leading-relaxed text-muted-foreground">
                {asset.transcript}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function TodosTable({
  todos,
  canUpdateStatus,
  hideGroupColumn = false,
}: TodosTableProps) {
  const router = useRouter();
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null);
  const [status, setStatus] = useState<TodoStatus>("open");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedTodo = useMemo(
    () => todos.find((todo) => todo.id === selectedTodoId) ?? null,
    [selectedTodoId, todos],
  );

  function openTodo(todo: TodoItem) {
    setSelectedTodoId(todo.id);
    setStatus(todo.status);
    setError(null);
  }

  function saveStatus() {
    if (!selectedTodo || selectedTodo.status === status) {
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        await updateTodoStatusAction({ todoId: selectedTodo.id, status });
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not update status.");
      }
    });
  }

  if (!todos.length) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">No todos yet.</p>;
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="bg-muted/40">Todo</TableHead>
            {hideGroupColumn ? null : (
              <TableHead className="bg-muted/40">Group</TableHead>
            )}
            <TableHead className="bg-muted/40">Status</TableHead>
            <TableHead className="bg-muted/40">Priority</TableHead>
            <TableHead className="bg-muted/40">Files</TableHead>
            <TableHead className="bg-muted/40">Due</TableHead>
            <TableHead className="bg-muted/40">Export</TableHead>
            <TableHead className="bg-muted/40">Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {todos.map((todo) => (
            <TableRow
              key={todo.id}
              role="button"
              tabIndex={0}
              className="cursor-pointer"
              onClick={() => openTodo(todo)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openTodo(todo);
                }
              }}
            >
              <TableCell>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <CheckSquare className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {todo.title}
                    </p>
                    {todo.description ? (
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {todo.description}
                      </p>
                    ) : null}
                  </div>
                </div>
              </TableCell>
              {hideGroupColumn ? null : (
                <TableCell>
                  <Link
                    href={`/inbox/${encodeURIComponent(todo.providerGroupId)}`}
                    className="text-sm text-foreground hover:underline"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {todo.groupTitle}
                  </Link>
                </TableCell>
              )}
              <TableCell>
                <Badge variant="outline">{statusLabel(todo.status)}</Badge>
              </TableCell>
              <TableCell>
                <Badge>{priorityLabel(todo.priority)}</Badge>
              </TableCell>
              <TableCell>
                <span className="text-xs text-muted-foreground">
                  {todo.attachments.length}
                </span>
              </TableCell>
              <TableCell>
                <span className="text-xs text-muted-foreground">
                  {todo.dueAt ? formatDateTime(todo.dueAt) : "n/a"}
                </span>
              </TableCell>
              <TableCell>
                <div className="text-xs text-muted-foreground">
                  {todo.exportedAt ? (
                    <span>{formatDateTime(todo.exportedAt)}</span>
                  ) : todo.lastExportError ? (
                    <span className="text-destructive">failed</span>
                  ) : (
                    <span>pending</span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(todo.updatedAt)}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Sheet
        open={Boolean(selectedTodo)}
        onOpenChange={(open: boolean) => {
          if (!open) {
            setSelectedTodoId(null);
          }
        }}
      >
        <SheetContent side="right" className="w-[min(680px,96vw)] overflow-y-auto sm:max-w-none">
          {selectedTodo ? (
            <>
              <SheetHeader className="border-b border-border p-5 pr-12">
                <SheetTitle className="text-lg">{selectedTodo.title}</SheetTitle>
                <SheetDescription>
                  Todo from {selectedTodo.groupTitle}
                </SheetDescription>
              </SheetHeader>

              <div className="flex flex-col gap-5 px-5 pb-5">
                <section className="flex flex-col gap-3">
                  <div className="flex items-end justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor="todo-status"
                        className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
                      >
                        Status
                      </label>
                      <Select
                        id="todo-status"
                        value={status}
                        disabled={!canUpdateStatus || isPending}
                        onChange={(event) => setStatus(event.target.value as TodoStatus)}
                        className="min-w-40"
                      >
                        {STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <Button
                      type="button"
                      onClick={saveStatus}
                      disabled={!canUpdateStatus || isPending || status === selectedTodo.status}
                    >
                      Save status
                    </Button>
                  </div>
                  {!canUpdateStatus ? (
                    <p className="text-xs text-muted-foreground">
                      Your role can view todos but cannot update their status.
                    </p>
                  ) : null}
                  {error ? <p className="text-sm text-destructive">{error}</p> : null}
                </section>

                <Separator />

                <section className="flex flex-col gap-3">
                  <h3 className="text-sm font-semibold text-foreground">Description</h3>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                    {selectedTodo.description || "No description provided."}
                  </p>
                </section>

                <Separator />

                <section className="flex flex-col gap-3">
                  <h3 className="text-sm font-semibold text-foreground">Details</h3>
                  <dl className="flex flex-col gap-3">
                    <DetailRow label="Priority" value={priorityLabel(selectedTodo.priority)} />
                    <DetailRow label="Due" value={selectedTodo.dueAt ? formatDateTime(selectedTodo.dueAt) : "n/a"} />
                    <DetailRow label="Created" value={formatDateTime(selectedTodo.createdAt)} />
                    <DetailRow label="Updated" value={formatDateTime(selectedTodo.updatedAt)} />
                    <DetailRow label="Completed" value={selectedTodo.completedAt ? formatDateTime(selectedTodo.completedAt) : "n/a"} />
                    <div className="flex items-start justify-between gap-4">
                      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Group
                      </dt>
                      <dd className="max-w-[65%] text-right text-sm">
                        <Link
                          href={`/inbox/${encodeURIComponent(selectedTodo.providerGroupId)}`}
                          className="text-foreground hover:underline"
                        >
                          {selectedTodo.groupTitle}
                        </Link>
                      </dd>
                    </div>
                  </dl>
                </section>

                <Separator />

                <section className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-foreground">Files</h3>
                    <Badge variant="outline">{selectedTodo.attachments.length}</Badge>
                  </div>
                  <AttachmentList attachments={selectedTodo.attachments} />
                </section>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
