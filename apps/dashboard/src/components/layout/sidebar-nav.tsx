"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ActivitySquare,
  Bot,
  BookOpen,
  CheckSquare,
  Cog,
  GaugeCircle,
  GitBranch,
  Inbox,
  type LucideIcon,
  ScrollText,
  Sparkles,
  TerminalSquare,
  UsersRound,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { StaffSession } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/permissions/matrix";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

const SECTIONS: NavSection[] = [
  {
    label: "Operate",
    items: [
      { href: "/overview", label: "Overview", icon: GaugeCircle },
      { href: "/inbox", label: "Inbox", icon: Inbox },
      { href: "/todos", label: "Todos", icon: CheckSquare },
    ],
  },
  {
    label: "Build",
    items: [
      { href: "/templates", label: "Templates", icon: Sparkles },
      { href: "/prompts", label: "Prompts", icon: ScrollText },
      { href: "/knowledge/common", label: "Knowledge", icon: BookOpen },
      { href: "/tools", label: "Tools", icon: Wrench },
    ],
  },
  {
    label: "Diagnose",
    items: [
      { href: "/audit", label: "Audit", icon: ActivitySquare },
      { href: "/agent-runs", label: "Agent runs", icon: Bot },
      { href: "/decisions", label: "Decisions", icon: GitBranch },
      { href: "/tool-invocations", label: "Tool logs", icon: Wrench },
      { href: "/debug/runtime", label: "Runtime debug", icon: TerminalSquare },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/admin/users", label: "Users", icon: UsersRound, adminOnly: true },
      { href: "/admin/assignments", label: "Assignments", icon: Cog, adminOnly: true },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/overview") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ session }: { session: StaffSession }) {
  const pathname = usePathname();
  const isAdmin = isAdminRole(session.role);

  const visibleSections = SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.adminOnly || isAdmin),
  })).filter((section) => section.items.length > 0);

  return (
    <nav aria-label="Primary" className="flex flex-col gap-6">
      {visibleSections.map((section) => (
        <div key={section.label} className="flex flex-col gap-1">
          <p className="px-3 text-[0.6875rem] font-semibold uppercase tracking-wider text-sidebar-muted">
            {section.label}
          </p>
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const Icon = item.icon;
              const active = isActive(pathname, item.href);

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <Icon
                      className={cn(
                        "size-4 shrink-0 transition-colors",
                        active
                          ? "text-sidebar-primary"
                          : "text-sidebar-muted group-hover:text-sidebar-accent-foreground",
                      )}
                      aria-hidden
                    />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
