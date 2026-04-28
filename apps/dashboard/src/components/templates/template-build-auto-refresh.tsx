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
    window.addEventListener("kuuna:runtime-event", refresh);

    return () => {
      window.removeEventListener("kuuna:runtime-event", refresh);
    };
  }, [props.active, router]);

  return null;
}
