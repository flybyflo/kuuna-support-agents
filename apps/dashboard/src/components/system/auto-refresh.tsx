"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export const AUTO_REFRESH_INTERVALS = {
  fast: 3000,
  default: 5000,
  medium: 8000,
  slow: 15000,
} as const;

type AutoRefreshProps = {
  intervalMs?: number;
  pauseWhenHidden?: boolean;
  eventTypes?: string[];
};

export function AutoRefresh({
  intervalMs = AUTO_REFRESH_INTERVALS.default,
  pauseWhenHidden = true,
  eventTypes,
}: AutoRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    const tick = () => {
      if (pauseWhenHidden && document.visibilityState !== "visible") return;
      router.refresh();
    };

    const handleRuntimeEvent = (event: Event) => {
      if (!eventTypes?.length) {
        tick();
        return;
      }
      const detail = event instanceof CustomEvent ? event.detail : null;
      const type =
        detail && typeof detail === "object" && "type" in detail
          ? String(detail.type)
          : "";
      if (eventTypes.includes(type)) {
        tick();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        tick();
      }
    };

    const timer = window.setInterval(tick, intervalMs);
    if (pauseWhenHidden) {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }
    window.addEventListener("kuuna:runtime-event", handleRuntimeEvent);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("kuuna:runtime-event", handleRuntimeEvent);
      if (pauseWhenHidden) {
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
      }
    };
  }, [eventTypes, intervalMs, pauseWhenHidden, router]);

  return null;
}
