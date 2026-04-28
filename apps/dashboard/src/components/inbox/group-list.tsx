"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { Plug, Search } from "lucide-react";

import { GroupListFilters } from "@/components/inbox/group-list-filters";
import { GroupListItem } from "@/components/inbox/group-list-item";
import { Button } from "@/components/ui/button";
import {
  applyInboxFilter,
  parseInboxFilter,
  type InboxFilter,
  type InboxGroupEntry,
} from "@/lib/inbox/filters";

type GroupListProps = {
  entries: InboxGroupEntry[];
};

function activeProviderGroupIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/inbox\/([^/]+)/);
  if (!match) return null;
  const segment = match[1];
  if (segment === "create") return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function GroupList({ entries }: GroupListProps) {
  const pathname = usePathname();
  const activeProviderGroupId = activeProviderGroupIdFromPath(pathname);

  const [filter, setFilter] = useState<InboxFilter>(() => parseInboxFilter("all"));
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const byFilter = applyInboxFilter(entries, filter);
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return byFilter;
    return byFilter.filter((entry) => {
      return (
        entry.displayTitle.toLowerCase().includes(trimmed) ||
        entry.providerGroupId.toLowerCase().includes(trimmed) ||
        entry.contactPushName?.toLowerCase().includes(trimmed) ||
        entry.contactPhone?.toLowerCase().includes(trimmed)
      );
    });
  }, [entries, filter, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-3 border-b border-sidebar-border px-3 py-3">
        <div className="flex items-center justify-between gap-2 px-1">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            Inbox
          </h2>
          <Button asChild size="sm" variant="outline" className="h-7 text-xs">
            <Link href="/inbox/create">
              <Plug aria-hidden className="size-3.5" />
              <span>New</span>
            </Link>
          </Button>
        </div>

        <div className="relative flex items-center">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground"
          />
          <input
            type="search"
            placeholder="Search groups, JID, contacts…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-2.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            aria-label="Search inbox groups"
          />
        </div>

        <GroupListFilters
          entries={entries}
          activeFilter={filter}
          onFilterChange={setFilter}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            {entries.length === 0
              ? "No groups visible to your role yet."
              : "No groups match the current filter."}
          </p>
        ) : (
          <ul className="flex flex-col">
            {filtered.map((entry) => (
              <li key={entry.providerGroupId}>
                <GroupListItem
                  entry={entry}
                  active={entry.providerGroupId === activeProviderGroupId}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
