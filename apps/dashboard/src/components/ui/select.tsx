import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils/cn";

/**
 * Minimal native <select> styled to match the design system. For full
 * keyboard + portal behavior we'd swap to Radix Select, but a native control
 * keeps server-rendered forms simple and zero-JS.
 */
const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          "flex h-9 w-full appearance-none rounded-md border border-input bg-card px-3 pr-9 text-sm text-foreground shadow-xs transition-colors focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
});
Select.displayName = "Select";

export { Select };
