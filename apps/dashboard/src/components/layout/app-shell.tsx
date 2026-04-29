import type { ReactNode } from "react";
import { LogOut, Search } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import type { StaffSession } from "@/lib/auth/session";
import { cn } from "@/lib/utils/cn";

function getInitials(name: string, fallback: string): string {
  const source = name?.trim() || fallback;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

function roleLabel(role: StaffSession["role"]): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "admin":
      return "Admin";
    case "operator":
      return "Operator";
    case "viewer":
      return "Viewer";
    default:
      return role;
  }
}

export function AppShell({
  session,
  children,
}: {
  session: StaffSession;
  children: ReactNode;
}) {
  const initials = getInitials(session.displayName, session.email);

  return (
    <div className="fixed inset-0 grid overflow-hidden grid-cols-[260px_1fr] bg-background text-foreground">
      <aside
        className={cn(
          "sticky top-0 flex h-screen flex-col gap-6 border-r border-sidebar-border bg-sidebar",
          "px-4 py-6",
        )}
      >
        <div className="flex items-center gap-2.5 px-2">
          <div
            className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground"
            aria-hidden
          >
            <span className="text-sm font-bold tracking-tight">K</span>
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-tight text-foreground">
              Kuuna
            </span>
            <span className="text-xs text-sidebar-muted">
              Staff operations
            </span>
          </div>
        </div>

        <Separator className="bg-sidebar-border" />

        <div className="flex-1 overflow-y-auto pr-1">
          <SidebarNav session={session} />
        </div>

        <Separator className="bg-sidebar-border" />

        <div className="flex items-center gap-3 rounded-md px-2 py-2">
          <Avatar className="size-9 border border-sidebar-border bg-sidebar-accent">
            <AvatarFallback className="bg-transparent text-[0.7rem] font-semibold text-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium text-foreground">
              {session.displayName}
            </span>
            <span className="truncate text-xs text-sidebar-muted">
              {roleLabel(session.role)}
            </span>
          </div>
        </div>
      </aside>

      <div className="flex h-screen min-h-0 flex-col overflow-hidden">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-border bg-background/85 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-8">
          <div className="relative flex w-full max-w-sm items-center">
            <Search
              className="pointer-events-none absolute left-3 size-4 text-muted-foreground"
              aria-hidden
            />
            <input
              type="search"
              placeholder="Search templates, groups, messages…"
              className="h-9 w-full rounded-md border border-border bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              aria-label="Global search"
            />
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden flex-col items-end leading-tight sm:flex">
              <span className="text-sm font-medium text-foreground">
                {session.displayName}
              </span>
              <span className="text-xs text-muted-foreground">
                {session.email}
              </span>
            </div>
            <form action="/logout" method="post">
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <LogOut aria-hidden className="size-3.5" />
                <span>Sign out</span>
              </Button>
            </form>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-6 py-8 sm:px-8 sm:py-10">
          <div className="mx-auto min-h-full w-full max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
