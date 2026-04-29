"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

export function AppShellScrollReset() {
  const pathname = usePathname();

  useEffect(() => {
    document
      .querySelector<HTMLElement>("[data-dashboard-scroll-container]")
      ?.scrollTo({ top: 0, left: 0 });
  }, [pathname]);

  return null;
}
