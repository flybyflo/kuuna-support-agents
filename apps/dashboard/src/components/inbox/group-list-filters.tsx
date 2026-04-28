"use client";

import { useMemo } from "react";

import { cn } from "@/lib/utils/cn";
import {
  applyInboxFilter,
  INBOX_FILTERS,
  type InboxFilter,
  type InboxGroupEntry,
} from "@/lib/inbox/filters";

type GroupListFiltersProps = {
  entries: InboxGroupEntry[];
  activeFilter: InboxFilter;
  onFilterChange: (filter: InboxFilter) => void;
};

export function GroupListFilters({
  entries,
  activeFilter,
  onFilterChange,
}: GroupListFiltersProps) {
  const counts = useMemo(() => {
    return Object.fromEntries(
      INBOX_FILTERS.map((option) => [option.id, applyInboxFilter(entries, option.id).length]),
    ) as Record<InboxFilter, number>;
  }, [entries]);

  return (
    <div
      className="flex flex-wrap gap-1"
      role="tablist"
      aria-label="Inbox filter"
    >
      {INBOX_FILTERS.map((option) => {
        const active = option.id === activeFilter;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onFilterChange(option.id)}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
              active
                ? "border-transparent bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <span>{option.label}</span>
            <span
              className={cn(
                "rounded px-1 text-[10px] tabular-nums",
                active ? "bg-primary-foreground/20" : "bg-muted",
              )}
            >
              {counts[option.id]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
