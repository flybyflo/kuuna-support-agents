import type { ReactNode } from "react";

export function Notice({
  title,
  children,
  tone = "info",
}: {
  title: string;
  children: ReactNode;
  tone?: "info" | "warning" | "success";
}) {
  return (
    <section className={`notice notice-${tone}`}>
      <p className="notice-title">{title}</p>
      <div>{children}</div>
    </section>
  );
}
