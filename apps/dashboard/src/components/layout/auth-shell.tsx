import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export function AuthShell({
  title,
  description,
  children,
  footer,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <main
      className={cn(
        "relative grid min-h-screen place-items-center overflow-hidden px-4 py-10",
        "bg-background",
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(1100px_520px_at_50%_-15%,var(--brand-100),transparent_60%)]"
      />

      <section
        className={cn(
          "relative w-full max-w-[440px] rounded-xl border border-border bg-card p-8 shadow-lg",
          className,
        )}
      >
        <div className="mb-8 flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground"
          >
            <span className="text-base font-bold tracking-tight">K</span>
          </span>
          <span className="text-base font-semibold tracking-tight text-foreground">
            Kuuna
          </span>
        </div>

        <header className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </header>

        <div className="mt-7">{children}</div>

        {footer ? (
          <div className="mt-6 border-t border-border pt-5 text-sm text-muted-foreground">
            {footer}
          </div>
        ) : null}
      </section>
    </main>
  );
}
