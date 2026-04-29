import Link from "next/link";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";
import { initialsFromTitle } from "@/lib/utils/initials";
import type { InboxGroupEntry } from "@/lib/inbox/filters";

type GroupListItemProps = {
  entry: InboxGroupEntry;
  active: boolean;
};

function formatRelativeShort(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return formatDateTime(value);
  return formatDateTime(value).split(",")[0];
}

export function GroupListItem({ entry, active }: GroupListItemProps) {
  const initials = initialsFromTitle(entry.displayTitle);

  return (
    <Link
      href={`/inbox/${encodeURIComponent(entry.providerGroupId)}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-start gap-3 border-b border-sidebar-border/60 px-3 py-2.5 transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "hover:bg-sidebar-accent/50",
      )}
    >
      <Avatar className="mt-0.5 size-9 shrink-0 border border-sidebar-border bg-background">
        <AvatarFallback className="bg-transparent text-[0.7rem] font-semibold text-foreground">
          {initials}
        </AvatarFallback>
      </Avatar>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-medium text-foreground">
            {entry.displayTitle}
          </p>
          {entry.lastActivityAt ? (
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {formatRelativeShort(entry.lastActivityAt)}
            </span>
          ) : null}
        </div>

        <code className="truncate font-mono text-[10px] text-muted-foreground">
          {entry.providerGroupId}
        </code>

        <div className="flex flex-wrap items-center gap-1">
          {entry.bound ? (
            <Badge variant="success" className="px-1.5 py-0 text-[10px]">
              bound
            </Badge>
          ) : (
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
              unbound
            </Badge>
          )}
          {entry.kind === "direct" ? (
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
              direct
            </Badge>
          ) : null}
          {entry.openTodoCount > 0 ? (
            <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
              {entry.openTodoCount} todo{entry.openTodoCount === 1 ? "" : "s"}
            </Badge>
          ) : null}
          {entry.messageCount > 0 ? (
            <span className="text-[10px] text-muted-foreground">
              {entry.messageCount} msg
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
