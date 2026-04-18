"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { StaffSession } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/permissions/matrix";

type NavItem = {
  href: string;
  label: string;
  adminOnly?: boolean;
};

const ITEMS: NavItem[] = [
  { href: "/overview", label: "Overview" },
  { href: "/templates", label: "Templates" },
  { href: "/bindings", label: "Bindings" },
  { href: "/prompts", label: "Prompts" },
  { href: "/knowledge/common", label: "Knowledge" },
  { href: "/messages", label: "Messages" },
  { href: "/tools", label: "Tools" },
  { href: "/debug/runtime", label: "Runtime Debug" },
  { href: "/audit", label: "Audit" },
  { href: "/admin/users", label: "Admin", adminOnly: true },
];

export function SidebarNav({ session }: { session: StaffSession }) {
  const pathname = usePathname();

  return (
    <nav className="sidebar-nav" aria-label="Primary">
      {ITEMS.filter((item) => !item.adminOnly || isAdminRole(session.role)).map(
        (item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/overview" && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={active ? "nav-item nav-item-active" : "nav-item"}
            >
              {item.label}
            </Link>
          );
        },
      )}
    </nav>
  );
}
