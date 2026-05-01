"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, CheckCircle2, CircleDot, Hammer, Radio, XCircle } from "lucide-react";

import type { AgentRunRecord, ToolInvocationRecord } from "@/lib/api-client/types";
import { formatDateTime } from "@/lib/utils/format";

type RuntimeEvent = {
  id?: string;
  type?: string;
  provider_group_id?: string | null;
  trace_id?: string | null;
  entity_id?: string | null;
  entity_type?: string | null;
  occurred_at?: string;
  payload?: Record<string, unknown>;
};

type TimelineItem = {
  id: string;
  occurredAt: string;
  title: string;
  detail: string;
  tone: "active" | "success" | "failed" | "neutral";
  kind: "run" | "tool";
};

export function LiveAgentRunStream({
  run,
  toolInvocations,
}: {
  run: AgentRunRecord;
  toolInvocations: ToolInvocationRecord[];
}) {
  const [events, setEvents] = useState<RuntimeEvent[]>([]);

  useEffect(() => {
    const handleRuntimeEvent = (event: Event) => {
      const detail = event instanceof CustomEvent ? normalizeRuntimeEvent(event.detail) : null;
      if (!detail || !eventBelongsToRun(detail, run)) return;
      setEvents((current) => {
        const eventId = detail.id ?? `${detail.type}:${detail.occurred_at}:${current.length}`;
        if (current.some((item) => item.id === eventId)) return current;
        return [...current, detail].slice(-40);
      });
    };

    window.addEventListener("kuuna:runtime-event", handleRuntimeEvent);
    return () => window.removeEventListener("kuuna:runtime-event", handleRuntimeEvent);
  }, [run.id, run.providerGroupId, run.traceId]);

  const items = useMemo(
    () => buildTimeline(run, toolInvocations, events),
    [events, run, toolInvocations],
  );
  const active = run.status === "running";
  const latest = items[items.length - 1];

  return (
    <section className="rounded-md border border-border bg-background">
      <div className="grid gap-4 border-b border-border p-4 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={active ? "relative flex size-2.5" : "flex size-2.5"}>
              {active ? (
                <>
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
                </>
              ) : (
                <span className="inline-flex size-2.5 rounded-full bg-muted-foreground" />
              )}
            </span>
            <h2 className="text-sm font-semibold text-foreground">Live Pi agent activity</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {latest?.detail ?? "Waiting for runtime events from the agent."}
          </p>
        </div>
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
          <p className="text-xs font-medium uppercase text-muted-foreground">Now</p>
          <p className="mt-1 truncate text-sm font-medium text-foreground">
            {latest?.title ?? (active ? "Listening" : "No live events")}
          </p>
        </div>
      </div>

      <ol className="divide-y divide-border">
        {items.map((item) => (
          <li key={item.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[32px_minmax(0,1fr)_170px] sm:items-start">
            <div className="pt-0.5">{iconForItem(item)}</div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{item.title}</p>
              <p className="mt-1 break-words text-sm text-muted-foreground">{item.detail}</p>
            </div>
            <time className="font-mono text-xs text-muted-foreground sm:text-right">
              {formatDateTime(item.occurredAt)}
            </time>
          </li>
        ))}
      </ol>
    </section>
  );
}

function buildTimeline(
  run: AgentRunRecord,
  toolInvocations: ToolInvocationRecord[],
  events: RuntimeEvent[],
): TimelineItem[] {
  const items: TimelineItem[] = [
    {
      id: `run-started:${run.id}`,
      occurredAt: run.startedAt,
      title: "Run created",
      detail: `Model path: ${run.modelPath.join(" -> ") || "default"} · tools: ${run.allowedTools.length}`,
      tone: run.status === "running" ? "active" : "neutral",
      kind: "run",
    },
  ];

  for (const event of events) {
    const item = itemFromRuntimeEvent(event, run);
    if (item) items.push(item);
  }

  for (const invocation of toolInvocations) {
    items.push({
      id: `tool:${invocation.id}`,
      occurredAt: invocation.createdAt,
      title: `Tool: ${invocation.toolName}`,
      detail: `${invocation.timedOut ? "Timed out" : invocation.ok ? "Completed" : "Failed"} in ${invocation.durationMs} ms${invocation.detailsSummary ? ` · ${invocation.detailsSummary}` : ""}`,
      tone: invocation.timedOut || !invocation.ok ? "failed" : "success",
      kind: "tool",
    });
  }

  if (run.completedAt) {
    items.push({
      id: `run-completed:${run.id}`,
      occurredAt: run.completedAt,
      title: run.status === "succeeded" ? "Run succeeded" : "Run failed",
      detail: run.status === "succeeded" ? "Response text was recorded." : (run.error ?? "Runtime failed."),
      tone: run.status === "succeeded" ? "success" : "failed",
      kind: "run",
    });
  }

  return dedupeItems(items).toSorted((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
}

function itemFromRuntimeEvent(event: RuntimeEvent, run: AgentRunRecord): TimelineItem | null {
  const occurredAt = event.occurred_at ?? new Date().toISOString();
  const payload = event.payload ?? {};
  if (event.type === "tool_invocation.created") {
    const toolName = stringField(payload.tool_name) ?? "tool";
    const ok = booleanField(payload.ok);
    return {
      id: event.entity_id ? `tool:${event.entity_id}` : (event.id ?? `live-tool:${toolName}:${occurredAt}`),
      occurredAt,
      title: `Tool requested: ${toolName}`,
      detail: ok === undefined ? "Tool invocation was recorded." : ok ? "Tool completed successfully." : "Tool returned a failure.",
      tone: ok === false ? "failed" : "success",
      kind: "tool",
    };
  }

  if (event.type !== "agent_run.updated") return null;
  const phase = stringField(payload.phase);
  const status = stringField(payload.status);
  const title = titleForPhase(phase, status);
  const detail = detailForPhase(phase, payload, run);
  return {
    id: event.id ?? `live-run:${phase ?? status ?? occurredAt}`,
    occurredAt,
    title,
    detail,
    tone: status === "failed" ? "failed" : status === "succeeded" ? "success" : "active",
    kind: "run",
  };
}

function eventBelongsToRun(event: RuntimeEvent, run: AgentRunRecord): boolean {
  if (event.type === "agent_run.updated") return event.entity_id === run.id;
  if (event.type === "tool_invocation.created") {
    return stringField(event.payload?.agent_run_id) === run.id;
  }
  if (event.trace_id && run.traceId && event.trace_id === run.traceId) return true;
  return event.provider_group_id === run.providerGroupId && event.entity_id === run.id;
}

function normalizeRuntimeEvent(value: unknown): RuntimeEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as RuntimeEvent;
}

function titleForPhase(phase: string | undefined, status: string | undefined): string {
  if (phase === "created") return "Run queued";
  if (phase === "provisioning_runtime") return "Starting Gondolin runtime";
  if (phase === "context_ready") return "Context assembled";
  if (phase === "pi_agent_running") return "Pi agent is thinking";
  if (phase === "response_received") return "Response received";
  if (status === "succeeded") return "Run succeeded";
  if (status === "failed") return "Run failed";
  return "Runtime update";
}

function detailForPhase(phase: string | undefined, payload: Record<string, unknown>, run: AgentRunRecord): string {
  if (phase === "created") return "The backend created the agent run and opened the live trace.";
  if (phase === "provisioning_runtime") return "Preparing the per-chat Gondolin VM and runtime ingress.";
  if (phase === "context_ready") {
    return [
      `${numberField(payload.recent_message_count) ?? 0} recent messages`,
      `${numberField(payload.todo_count) ?? 0} todos`,
      `${numberField(payload.retrieval_hit_count) ?? 0} retrieval hits`,
      `${numberField(payload.allowed_tool_count) ?? run.allowedTools.length} tools allowed`,
    ].join(" · ");
  }
  if (phase === "pi_agent_running") {
    const modelPath = Array.isArray(payload.model_path) ? payload.model_path.filter((item): item is string => typeof item === "string") : run.modelPath;
    return `Prompt sent to Pi with ${modelPath.join(" -> ") || "default model path"}.`;
  }
  if (phase === "response_received") {
    return [
      `${numberField(payload.response_chars) ?? 0} chars`,
      `${numberField(payload.tool_result_count) ?? 0} tool results`,
      `${numberField(payload.media_insight_count) ?? 0} media insights`,
      stringField(payload.model_used) ? `model ${stringField(payload.model_used)}` : null,
    ].filter(Boolean).join(" · ");
  }
  if (stringField(payload.error)) return stringField(payload.error)!;
  return "Runtime state changed.";
}

function iconForItem(item: TimelineItem) {
  const className =
    item.tone === "success"
      ? "size-4 text-success"
      : item.tone === "failed"
        ? "size-4 text-destructive"
        : item.tone === "active"
          ? "size-4 text-primary"
          : "size-4 text-muted-foreground";
  if (item.kind === "tool") return <Hammer aria-hidden className={className} />;
  if (item.tone === "success") return <CheckCircle2 aria-hidden className={className} />;
  if (item.tone === "failed") return <XCircle aria-hidden className={className} />;
  if (item.tone === "active") return <Radio aria-hidden className={className} />;
  if (item.title === "Run created") return <CircleDot aria-hidden className={className} />;
  return <Activity aria-hidden className={className} />;
}

function dedupeItems(items: TimelineItem[]): TimelineItem[] {
  const seen = new Set<string>();
  const out: TimelineItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanField(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
