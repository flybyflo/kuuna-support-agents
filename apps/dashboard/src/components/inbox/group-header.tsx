import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status/status-badge";
import { GroupWorkspaceTabs } from "@/components/inbox/group-workspace-tabs";
import type { InboxGroupEntry } from "@/lib/inbox/filters";

type GroupHeaderProps = {
  entry: InboxGroupEntry;
};

function initialsFromTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return "??";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
}

export function GroupHeader({ entry }: GroupHeaderProps) {
  const initials = initialsFromTitle(entry.displayTitle);
  const phone = entry.contactPhone ? normalizePhone(entry.contactPhone) : null;

  return (
    <header className="flex flex-col border-b border-border bg-background">
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="size-10 border border-border bg-muted">
            <AvatarFallback className="bg-transparent text-xs font-semibold text-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col leading-tight">
            <h1 className="truncate text-base font-semibold tracking-tight text-foreground">
              {entry.displayTitle}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <code className="truncate font-mono">{entry.providerGroupId}</code>
              {phone ? <span>· {phone}</span> : null}
              {entry.participantsCount ? (
                <span>· {entry.participantsCount} participants</span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {entry.kind === "direct" ? (
            <Badge variant="outline">direct chat</Badge>
          ) : null}
          {entry.bound && entry.bindingStatus ? (
            <StatusBadge status={entry.bindingStatus} />
          ) : (
            <Badge variant="secondary">unbound</Badge>
          )}
        </div>
      </div>

      <GroupWorkspaceTabs
        providerGroupId={entry.providerGroupId}
        openTodoCount={entry.openTodoCount}
      />
    </header>
  );
}
