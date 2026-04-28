"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils/cn";

type WorkspaceTab = {
  id: string;
  label: string;
  href: string;
  match: (pathname: string) => boolean;
  count?: number;
};

type GroupWorkspaceTabsProps = {
  providerGroupId: string;
  openTodoCount: number;
};

function buildTabs(
  encoded: string,
  openTodoCount: number,
): WorkspaceTab[] {
  const base = `/inbox/${encoded}`;
  return [
    {
      id: "conversation",
      label: "Conversation",
      href: base,
      match: (pathname) =>
        pathname === base ||
        (pathname.startsWith(base) &&
          !pathname.startsWith(`${base}/todos`) &&
          !pathname.startsWith(`${base}/settings`) &&
          !pathname.startsWith(`${base}/activity`)),
    },
    {
      id: "todos",
      label: "Todos",
      href: `${base}/todos`,
      match: (pathname) => pathname.startsWith(`${base}/todos`),
      count: openTodoCount,
    },
    {
      id: "settings",
      label: "Settings",
      href: `${base}/settings`,
      match: (pathname) => pathname.startsWith(`${base}/settings`),
    },
    {
      id: "activity",
      label: "Activity",
      href: `${base}/activity`,
      match: (pathname) => pathname.startsWith(`${base}/activity`),
    },
  ];
}

export function GroupWorkspaceTabs({
  providerGroupId,
  openTodoCount,
}: GroupWorkspaceTabsProps) {
  const pathname = usePathname();
  const encoded = encodeURIComponent(providerGroupId);
  const tabs = buildTabs(encoded, openTodoCount);

  return (
    <nav
      aria-label="Group workspace tabs"
      className="flex items-center gap-1 border-b border-border px-4"
    >
      {tabs.map((tab) => {
        const active = tab.match(pathname);
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span>{tab.label}</span>
            {typeof tab.count === "number" && tab.count > 0 ? (
              <span
                className={cn(
                  "rounded px-1 text-[10px] tabular-nums",
                  active
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {tab.count}
              </span>
            ) : null}
            {active ? (
              <span
                aria-hidden
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
