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
  intervalMs?: number | null;
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
    const tick = (options: { ignoreVisibility?: boolean } = {}) => {
      if (!options.ignoreVisibility && pauseWhenHidden && document.visibilityState !== "visible") return;
      router.refresh();
    };

    const handleRuntimeEvent = (event: Event) => {
      if (!eventTypes?.length) {
        tick({ ignoreVisibility: true });
        return;
      }
      const detail = event instanceof CustomEvent ? event.detail : null;
      const type =
        detail && typeof detail === "object" && "type" in detail
          ? String(detail.type)
          : "";
      if (eventTypes.includes(type)) {
        tick({ ignoreVisibility: true });
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        tick();
      }
    };

    const timer = intervalMs === null ? null : window.setInterval(tick, intervalMs);
    if (pauseWhenHidden && intervalMs !== null) {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }
    window.addEventListener("kuuna:runtime-event", handleRuntimeEvent);

    return () => {
      if (timer) {
        window.clearInterval(timer);
      }
      window.removeEventListener("kuuna:runtime-event", handleRuntimeEvent);
      if (pauseWhenHidden && intervalMs !== null) {
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
      }
    };
  }, [eventTypes, intervalMs, pauseWhenHidden, router]);

  return null;
}
