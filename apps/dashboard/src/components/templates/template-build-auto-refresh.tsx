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
    const handleRuntimeEvent = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null;
      const type =
        detail && typeof detail === "object" && "type" in detail
          ? String(detail.type)
          : "";
      if (type === "template_build.updated") {
        refresh();
      }
    };
    window.addEventListener("kuuna:runtime-event", handleRuntimeEvent);

    return () => {
      window.removeEventListener("kuuna:runtime-event", handleRuntimeEvent);
    };
  }, [props.active, router]);

  return null;
}
