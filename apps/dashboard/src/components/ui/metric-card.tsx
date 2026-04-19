import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";

type MetricCardProps = {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  delta?: {
    value: string;
    trend?: "up" | "down" | "neutral";
  };
};

export function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  delta,
}: MetricCardProps) {
  const DeltaIcon = delta?.trend === "down" ? ArrowDownRight : ArrowUpRight;

  return (
    <Card className="flex flex-col gap-5 p-6">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {Icon ? (
          <span
            aria-hidden
            className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary"
          >
            <Icon className="size-4" />
          </span>
        ) : null}
      </div>

      <div className="flex items-baseline gap-2">
        <p className="text-3xl font-semibold tracking-tight text-foreground">
          {value}
        </p>
        {delta ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-xs font-medium",
              delta.trend === "down"
                ? "text-[color:var(--danger-700)]"
                : delta.trend === "neutral"
                  ? "text-muted-foreground"
                  : "text-[color:var(--success-700)]",
            )}
          >
            <DeltaIcon className="size-3" aria-hidden />
            {delta.value}
          </span>
        ) : null}
      </div>

      {hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </Card>
  );
}

// CardContent is re-exported to keep the import graph lean for pages that
// import MetricCard from this file today.
export { CardContent as MetricCardContent };
