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
};

export function AutoRefresh({
  intervalMs = AUTO_REFRESH_INTERVALS.default,
  pauseWhenHidden = true,
}: AutoRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    const tick = () => {
      if (pauseWhenHidden && document.visibilityState !== "visible") return;
      router.refresh();
    };

    const timer = window.setInterval(tick, intervalMs);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        tick();
      }
    };

    if (pauseWhenHidden) {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }
    window.addEventListener("kuuna:runtime-event", tick);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("kuuna:runtime-event", tick);
      if (pauseWhenHidden) {
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
      }
    };
  }, [intervalMs, pauseWhenHidden, router]);

  return null;
}
