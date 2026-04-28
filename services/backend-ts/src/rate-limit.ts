import { TRPCError } from "@trpc/server";

import { getSettings } from "./config.js";

class IpRateLimiter {
  private buckets = new Map<string, number[]>();

  record(key: string): void {
    const settings = getSettings();
    const now = Date.now() / 1000;
    const windowStart = now - settings.AUTH_RATE_LIMIT_WINDOW_SECONDS;
    const current = this.buckets.get(key)?.filter((timestamp) => timestamp >= windowStart) ?? [];

    if (current.length >= settings.AUTH_RATE_LIMIT_MAX_ATTEMPTS) {
      this.buckets.set(key, current);
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "too many login attempts",
      });
    }

    current.push(now);
    this.buckets.set(key, current);
  }

  clear(): void {
    this.buckets.clear();
  }
}

export const loginRateLimiter = new IpRateLimiter();
