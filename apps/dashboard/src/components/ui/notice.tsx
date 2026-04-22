import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";

type NoticeTone = "info" | "warning" | "success";

const TONE_STYLES: Record<
  NoticeTone,
  { wrap: string; icon: string; IconComponent: LucideIcon }
> = {
  info: {
    wrap: "border-[color:color-mix(in_oklab,var(--info-500)_22%,transparent)] bg-[color:var(--info-50)]",
    icon: "text-[color:var(--info-700)]",
    IconComponent: Info,
  },
  warning: {
    wrap: "border-[color:color-mix(in_oklab,var(--warning-500)_32%,transparent)] bg-[color:var(--warning-50)]",
    icon: "text-[color:var(--warning-700)]",
    IconComponent: AlertTriangle,
  },
  success: {
    wrap: "border-[color:color-mix(in_oklab,var(--success-500)_28%,transparent)] bg-[color:var(--success-50)]",
    icon: "text-[color:var(--success-700)]",
    IconComponent: CheckCircle2,
  },
};

export function Notice({
  title,
  children,
  tone = "info",
}: {
  title: string;
  children: ReactNode;
  tone?: NoticeTone;
}) {
  const styles = TONE_STYLES[tone];
  const Icon = styles.IconComponent;

  return (
    <section
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3.5 text-sm",
        styles.wrap,
      )}
    >
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", styles.icon)} />
      <div className="flex flex-col gap-1">
        <p className="font-semibold text-foreground">{title}</p>
        <div className="text-muted-foreground">{children}</div>
      </div>
    </section>
  );
}
