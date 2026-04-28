"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function TemplateBuildAutoRefresh(props: { active: boolean }): null {
  const router = useRouter();

  useEffect(() => {
    if (!props.active) {
      return;
    }

    const refresh = () => {
      router.refresh();
    };
    const id = window.setInterval(refresh, 4000);
    window.addEventListener("kuuna:runtime-event", refresh);

    return () => {
      window.clearInterval(id);
      window.removeEventListener("kuuna:runtime-event", refresh);
    };
  }, [props.active, router]);

  return null;
}
