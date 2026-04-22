import * as React from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Native checkbox styled to match the design system, with an
 * accent-color hint so the check follows the brand token.
 */
const Checkbox = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    type="checkbox"
    className={cn(
      "size-4 shrink-0 rounded-[4px] border border-input bg-card text-primary shadow-xs accent-[color:var(--primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Checkbox.displayName = "Checkbox";

export { Checkbox };
