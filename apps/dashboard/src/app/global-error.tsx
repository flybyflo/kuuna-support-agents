"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset?: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-background text-foreground antialiased">
        <main className="grid min-h-screen place-items-center px-4 py-10">
          <section className="w-full max-w-[440px] rounded-xl border border-border bg-card p-8 shadow-lg">
            <span
              aria-hidden
              className="mb-4 flex size-10 items-center justify-center rounded-md bg-[color:var(--danger-50)] text-[color:var(--danger-700)]"
            >
              <AlertTriangle className="size-5" />
            </span>
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              Something went wrong.
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The dashboard hit an unexpected error. The issue has been reported
              automatically.
            </p>
            <button
              type="button"
              onClick={() => {
                if (typeof reset === "function") {
                  reset();
                  return;
                }
                window.location.reload();
              }}
              className="mt-6 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Try again
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
