import type { ReactNode } from "react";
import { logoutAction } from "@/lib/auth/actions";
import type { StaffSession } from "@/lib/auth/session";
import { SidebarNav } from "@/components/layout/sidebar-nav";

export function AppShell({
  session,
  children,
}: {
  session: StaffSession;
  children: ReactNode;
}) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <p className="brand-title">Kuuna Dashboard</p>
          <p className="brand-caption">Staff operations</p>
        </div>
        <SidebarNav session={session} />
      </aside>

      <div className="shell-main">
        <header className="topbar">
          <div>
            <p className="topbar-title">{session.displayName}</p>
            <p className="topbar-subtitle">
              {session.email} · {session.role}
            </p>
          </div>
          <form action={logoutAction}>
            <button type="submit" className="button button-secondary">
              Sign out
            </button>
          </form>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
