import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary/10 text-primary",
        secondary:
          "border-border bg-secondary text-secondary-foreground",
        outline: "border-border text-foreground",
        success:
          "border-transparent bg-[color:var(--success-50)] text-[color:var(--success-700)]",
        warning:
          "border-transparent bg-[color:var(--warning-50)] text-[color:var(--warning-700)]",
        info:
          "border-transparent bg-[color:var(--info-50)] text-[color:var(--info-700)]",
        destructive:
          "border-transparent bg-[color:var(--danger-50)] text-[color:var(--danger-700)]",
        violet:
          "border-transparent bg-[color:var(--violet-50)] text-[color:var(--violet-700)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
