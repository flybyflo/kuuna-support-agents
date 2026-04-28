"use client";

import Link from "next/link";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCheck,
  Download,
  ExternalLink,
  File as FileIcon,
  Image as ImageIcon,
  Loader2,
  Music,
  Video,
  X,
} from "lucide-react";

import {
  SENDER_KEY_AGENT,
  senderAccentStyle,
  senderDisplayName,
  senderInitials,
  senderKeyForMessage,
} from "@/components/inbox/sender-display";
import { StatusBadge } from "@/components/status/status-badge";
import { Button } from "@/components/ui/button";
import type {
  MediaAsset,
  MessageRecord,
  MessageVersion,
  OutboundIntentRecord,
} from "@/lib/api-client/types";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";

export type InboundEntry = {
  message: MessageRecord;
  versions: MessageVersion[];
  media: MediaAsset[];
};

type ChatTimelineProps = {
  inbound: InboundEntry[];
  outbound: OutboundIntentRecord[];
};

type InboundItem = {
  kind: "inbound";
  id: string;
  occurredAt: string;
  senderKey: string;
  senderName: string;
  entry: InboundEntry;
  showSenderHeader: boolean;
  isLastInGroup: boolean;
};

type OutboundItem = {
  kind: "outbound";
  id: string;
  occurredAt: string;
  senderKey: string;
  senderName: string;
  intent: OutboundIntentRecord;
  showSenderHeader: boolean;
  isLastInGroup: boolean;
};

type DateItem = {
  kind: "date";
  id: string;
  occurredAt: string;
  label: string;
};

type ChatTimelineItem = InboundItem | OutboundItem | DateItem;

const SENDER_GAP_MS = 5 * 60 * 1000;

function inboundHasContent(entry: InboundEntry): boolean {
  if (entry.media.length > 0) return true;
  if (entry.versions.some((version) => version.text.trim().length > 0)) {
    return true;
  }
  const preview = entry.message.preview.trim();
  return preview.length > 0 && preview !== "(no text)";
}

function inboundDisplayText(entry: InboundEntry): string {
  const latest = entry.versions[0]?.text?.trim();
  if (latest) return latest;

  const preview = entry.message.preview.trim();
  if (preview && preview !== "(no text)") return preview;

  if (entry.media.length > 0) {
    const kinds = [...new Set(entry.media.map((asset) => asset.kind))].join(
      ", ",
    );
    return `Media attachment${entry.media.length === 1 ? "" : "s"}: ${kinds}`;
  }

  return "(no text)";
}

function inboundTextContent(entry: InboundEntry): string | null {
  const latest = entry.versions[0]?.text?.trim();
  if (latest) return latest;

  const preview = entry.message.preview.trim();
  if (preview && preview !== "(no text)") return preview;

  return null;
}

function isGeneratedMediaLabel(entry: InboundEntry, text: string | null): boolean {
  if (!text || entry.media.length === 0) return false;
  return entry.media.some((asset) => text === asset.filename);
}

function findScrollableAncestor(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY;
    const isScrollable =
      (overflowY === "auto" || overflowY === "scroll") &&
      current.scrollHeight > current.clientHeight;
    if (isScrollable) return current;
    current = current.parentElement;
  }
  return null;
}

function dayKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
}

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const WEEKDAYS_SHORT = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

function formatDayLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const today = new Date();
  const todayKey = `${today.getUTCFullYear()}-${today.getUTCMonth()}-${today.getUTCDate()}`;
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayKey = `${yesterday.getUTCFullYear()}-${yesterday.getUTCMonth()}-${yesterday.getUTCDate()}`;
  const targetKey = `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;

  if (targetKey === todayKey) return "Today";
  if (targetKey === yesterdayKey) return "Yesterday";

  const sameYear = date.getUTCFullYear() === today.getUTCFullYear();
  const month = MONTHS_SHORT[date.getUTCMonth()];
  const day = date.getUTCDate();
  const weekday = WEEKDAYS_SHORT[date.getUTCDay()];
  if (sameYear) {
    return `${weekday}, ${month} ${day}`;
  }
  return `${month} ${day}, ${date.getUTCFullYear()}`;
}

function formatTimeOnly(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const hour24 = date.getUTCHours();
  const minute = date.getUTCMinutes();
  const ampm = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${ampm}`;
}

export function buildChatTimeline({
  inbound,
  outbound,
}: ChatTimelineProps): ChatTimelineItem[] {
  type Source =
    | { kind: "inbound"; entry: InboundEntry; occurredAt: string }
    | { kind: "outbound"; intent: OutboundIntentRecord; occurredAt: string };

  const sources: Source[] = [];

  for (const entry of inbound) {
    if (!inboundHasContent(entry)) continue;
    sources.push({
      kind: "inbound",
      entry,
      occurredAt: entry.message.createdAt,
    });
  }

  for (const intent of outbound) {
    if (!intent.text.trim() && !intent.lastError) continue;
    sources.push({ kind: "outbound", intent, occurredAt: intent.createdAt });
  }

  sources.sort((left, right) => {
    return (
      new Date(left.occurredAt).getTime() -
      new Date(right.occurredAt).getTime()
    );
  });

  const items: ChatTimelineItem[] = [];
  let lastDayKey: string | null = null;
  let previousSenderKey: string | null = null;
  let previousOccurredAt: string | null = null;

  type PartialItem = InboundItem | OutboundItem;

  for (const source of sources) {
    const currentDay = dayKey(source.occurredAt);
    if (currentDay !== lastDayKey) {
      items.push({
        kind: "date",
        id: `date-${currentDay}`,
        occurredAt: source.occurredAt,
        label: formatDayLabel(source.occurredAt),
      });
      lastDayKey = currentDay;
      previousSenderKey = null;
      previousOccurredAt = null;
    }

    let partial: PartialItem;
    if (source.kind === "inbound") {
      const senderKey = senderKeyForMessage(source.entry.message);
      partial = {
        kind: "inbound",
        id: `inbound-${source.entry.message.id}`,
        occurredAt: source.occurredAt,
        senderKey,
        senderName: senderDisplayName(source.entry.message),
        entry: source.entry,
        showSenderHeader: true,
        isLastInGroup: true,
      };
    } else {
      partial = {
        kind: "outbound",
        id: `outbound-${source.intent.id}`,
        occurredAt: source.occurredAt,
        senderKey: SENDER_KEY_AGENT,
        senderName: "Agent",
        intent: source.intent,
        showSenderHeader: true,
        isLastInGroup: true,
      };
    }

    const sameSender = previousSenderKey === partial.senderKey;
    const withinGap =
      previousOccurredAt &&
      new Date(partial.occurredAt).getTime() -
        new Date(previousOccurredAt).getTime() <
        SENDER_GAP_MS;

    partial.showSenderHeader = !(sameSender && withinGap);

    if (sameSender && withinGap && items.length > 0) {
      const previous = items[items.length - 1];
      if (previous.kind !== "date") {
        previous.isLastInGroup = false;
      }
    }

    items.push(partial);
    previousSenderKey = partial.senderKey;
    previousOccurredAt = partial.occurredAt;
  }

  return items;
}

type SelectedItem = InboundItem | OutboundItem | null;

export function ChatTimeline({ inbound, outbound }: ChatTimelineProps) {
  const items = useMemo(
    () => buildChatTimeline({ inbound, outbound }),
    [inbound, outbound],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const wasNearBottomRef = useRef(true);

  const selectedItem = useMemo<SelectedItem>(() => {
    if (!selectedId) return null;
    const found = items.find((item) => item.id === selectedId);
    if (!found || found.kind === "date") return null;
    return found;
  }, [items, selectedId]);

  useLayoutEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, []);

  useEffect(() => {
    const sentinel = bottomRef.current;
    if (!sentinel) return;

    const scrollContainer = findScrollableAncestor(sentinel);
    if (!scrollContainer) return;

    const updateNearBottom = () => {
      const distance =
        scrollContainer.scrollHeight -
        scrollContainer.scrollTop -
        scrollContainer.clientHeight;
      wasNearBottomRef.current = distance < 80;
    };

    updateNearBottom();
    scrollContainer.addEventListener("scroll", updateNearBottom, {
      passive: true,
    });

    return () => {
      scrollContainer.removeEventListener("scroll", updateNearBottom);
    };
  }, []);

  useEffect(() => {
    if (!wasNearBottomRef.current) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [items.length]);

  if (items.length === 0) {
    return (
      <p className="px-6 py-8 text-center text-sm text-muted-foreground">
        No conversation activity yet for this group.
      </p>
    );
  }

  return (
    <>
      <div className="flex h-full min-h-0 flex-col bg-chat-surface">
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-5">
          <div className="flex min-h-full flex-col gap-1.5">
            {items.map((item) => {
              if (item.kind === "date") {
                return <DateDivider key={item.id} label={item.label} />;
              }

              if (item.kind === "inbound") {
                return (
                  <InboundBubble
                    key={item.id}
                    item={item}
                    onSelect={() => setSelectedId(item.id)}
                  />
                );
              }

              return (
                <OutboundBubble
                  key={item.id}
                  item={item}
                  onSelect={() => setSelectedId(item.id)}
                />
              );
            })}
            <div ref={bottomRef} aria-hidden className="h-px" />
          </div>
        </div>
      </div>

      <DetailSheet item={selectedItem} onClose={() => setSelectedId(null)} />
    </>
  );
}

function DateDivider({ label }: { label: string }) {
  return (
    <div className="my-2 flex items-center justify-center">
      <span className="rounded-full bg-background/80 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground shadow-xs ring-1 ring-border/60">
        {label}
      </span>
    </div>
  );
}

function SenderAvatar({
  senderKey,
  senderName,
  isAgent,
}: {
  senderKey: string;
  senderName: string;
  isAgent: boolean;
}) {
  if (isAgent) {
    return (
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xs">
        <Bot aria-hidden className="size-4" />
      </div>
    );
  }

  return (
    <div
      style={senderAccentStyle(senderKey)}
      className="flex size-8 shrink-0 items-center justify-center rounded-full border border-[color:var(--sender-border)] bg-[color:var(--sender-bg)] text-[11px] font-semibold text-[color:var(--sender-text)] shadow-xs"
    >
      {senderInitials(senderName)}
    </div>
  );
}

function InboundBubble({
  item,
  onSelect,
}: {
  item: InboundItem;
  onSelect: () => void;
}) {
  const rawText = inboundTextContent(item.entry);
  const text = isGeneratedMediaLabel(item.entry, rawText) ? null : rawText;
  const hasImage = item.entry.media.some((asset) => asset.kind === "image");

  return (
    <div
      className={cn(
        "flex items-end gap-2",
        item.showSenderHeader ? "mt-2.5" : "mt-0.5",
      )}
    >
      <div className="w-8 shrink-0">
        {item.showSenderHeader ? (
          <SenderAvatar
            senderKey={item.senderKey}
            senderName={item.senderName}
            isAgent={false}
          />
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col items-start gap-0.5">
        {item.showSenderHeader ? (
          <div
            style={senderAccentStyle(item.senderKey)}
            className="flex items-baseline gap-2 px-1"
          >
            <span className="text-xs font-semibold text-[color:var(--sender-text)]">
              {item.senderName}
            </span>
            <span className="text-[10.5px] text-muted-foreground">
              {formatTimeOnly(item.occurredAt)}
            </span>
          </div>
        ) : null}

        <button
          type="button"
          onClick={onSelect}
          className={cn(
            "group flex flex-col gap-1 border border-border/70 bg-card text-left text-foreground shadow-xs transition-colors",
            hasImage ? "w-[min(420px,85vw)] p-1.5" : "w-[min(640px,85%)] px-3 py-2",
            "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            item.showSenderHeader
              ? "rounded-2xl rounded-tl-md"
              : "rounded-2xl",
            item.isLastInGroup ? "rounded-bl-md" : null,
          )}
        >
          {text ? (
            <p className="whitespace-pre-wrap break-words px-1.5 py-1 text-sm leading-relaxed">
              {text}
            </p>
          ) : !hasImage ? (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
              {inboundDisplayText(item.entry)}
            </p>
          ) : null}

          <MediaAttachments
            assets={item.entry.media}
            showStatus={false}
            showDownload={false}
            compactImages
          />
        </button>
      </div>
    </div>
  );
}

function OutboundBubble({
  item,
  onSelect,
}: {
  item: OutboundItem;
  onSelect: () => void;
}) {
  const intent = item.intent;
  const text = intent.text.trim();
  const isFailed = intent.status === "failed";

  return (
    <div
      className={cn(
        "flex items-end justify-end gap-2",
        item.showSenderHeader ? "mt-2.5" : "mt-0.5",
      )}
    >
      <div className="flex min-w-0 flex-col items-end gap-0.5">
        {item.showSenderHeader ? (
          <div className="flex items-baseline gap-2 px-1">
            <span className="text-[10.5px] text-muted-foreground">
              {formatTimeOnly(item.occurredAt)}
            </span>
            <span className="text-xs font-semibold text-foreground">
              {item.senderName}
            </span>
          </div>
        ) : null}

        <button
          type="button"
          onClick={onSelect}
          className={cn(
            "group flex w-[min(640px,85%)] flex-col gap-1 border px-3 py-2 text-left shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            isFailed
              ? "border-destructive/60 bg-destructive/10 text-foreground hover:bg-destructive/15"
              : "border-primary bg-primary text-primary-foreground hover:brightness-[0.95]",
            item.showSenderHeader
              ? "rounded-2xl rounded-tr-md"
              : "rounded-2xl",
            item.isLastInGroup ? "rounded-br-md" : null,
          )}
        >
          {text ? (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
              {text}
            </p>
          ) : (
            <p className="text-sm italic opacity-90">(no agent text)</p>
          )}

          <DeliveryStatusIndicator intent={intent} />
        </button>
      </div>

      <div className="w-8 shrink-0">
        {item.showSenderHeader ? (
          <SenderAvatar
            senderKey={item.senderKey}
            senderName={item.senderName}
            isAgent
          />
        ) : null}
      </div>
    </div>
  );
}

function DeliveryStatusIndicator({
  intent,
}: {
  intent: OutboundIntentRecord;
}) {
  const status = intent.status;
  const baseClass =
    "mt-0.5 flex items-center gap-1 self-end text-[10.5px] opacity-90";

  if (status === "pending" || status === "sending") {
    return (
      <span className={baseClass}>
        <Loader2 aria-hidden className="size-3 animate-spin" />
        <span>{status === "pending" ? "Queued" : "Sending"}</span>
      </span>
    );
  }

  if (status === "sent") {
    return (
      <span className={baseClass}>
        <CheckCheck aria-hidden className="size-3" />
        <span>Sent</span>
      </span>
    );
  }

  if (status === "failed") {
    return (
      <span
        className={cn(
          baseClass,
          "text-destructive opacity-100",
        )}
        title={intent.lastError ?? "Delivery failed"}
      >
        <AlertTriangle aria-hidden className="size-3" />
        <span>
          Failed{intent.attemptCount > 1 ? ` · ${intent.attemptCount}x` : ""}
        </span>
      </span>
    );
  }

  return (
    <span className={baseClass}>
      <Check aria-hidden className="size-3" />
      <span>{status}</span>
    </span>
  );
}

function downloadUrlForAsset(asset: MediaAsset): string | undefined {
  return (
    asset.downloadUrl ??
    (asset.kind === "image" ? asset.previewUrl : undefined)
  );
}

function formatByteSize(value: number | undefined): string | null {
  if (!value || value <= 0) return null;
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function MediaKindIcon({ kind }: { kind: MediaAsset["kind"] }) {
  if (kind === "image") return <ImageIcon aria-hidden className="size-4" />;
  if (kind === "audio") return <Music aria-hidden className="size-4" />;
  if (kind === "video") return <Video aria-hidden className="size-4" />;
  return <FileIcon aria-hidden className="size-4" />;
}

function MediaAttachments({
  assets,
  showStatus,
  showDownload,
  compactImages = false,
}: {
  assets: MediaAsset[];
  showStatus: boolean;
  showDownload: boolean;
  compactImages?: boolean;
}) {
  if (assets.length === 0) return null;

  return (
    <div className="mt-1.5 grid gap-2">
      {assets.map((asset) => {
        const downloadUrl = downloadUrlForAsset(asset);
        const byteSize = formatByteSize(asset.byteSize);

        return (
          <div
            key={asset.id}
            className="overflow-hidden rounded-md border border-border/80 bg-background/70"
          >
            {asset.kind === "image" ? (
              asset.previewUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={asset.previewUrl}
                  alt={asset.filename}
                  className={cn(
                    "mx-auto block h-auto max-w-full object-contain",
                    compactImages ? "max-h-[360px] rounded-sm" : "max-h-80",
                  )}
                />
              ) : (
                <div className="grid min-h-[140px] place-items-center bg-muted text-xs text-muted-foreground">
                  Image preview unavailable
                </div>
              )
            ) : null}

            <div
              className={cn(
                "flex items-center justify-between gap-2 px-2.5 py-2",
                compactImages && asset.kind === "image" ? "sr-only" : null,
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-muted-foreground">
                  <MediaKindIcon kind={asset.kind} />
                </span>
                <span className="min-w-0 truncate text-xs font-medium text-foreground">
                  {asset.filename}
                </span>
                {byteSize ? (
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {byteSize}
                  </span>
                ) : null}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {showStatus ? <StatusBadge status={asset.status} /> : null}
                {showDownload && downloadUrl ? (
                  <Button asChild type="button" variant="outline" size="sm">
                    <a href={downloadUrl} download={asset.filename}>
                      <Download aria-hidden />
                      <span>Download</span>
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="break-all text-sm text-foreground">{value}</span>
    </div>
  );
}

function DetailSheet({
  item,
  onClose,
}: {
  item: SelectedItem;
  onClose: () => void;
}) {
  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-foreground/30 transition-opacity duration-200",
          item
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
        aria-hidden={!item}
      />

      <aside
        className={cn(
          "fixed right-0 top-0 z-50 grid h-screen w-[min(520px,96vw)] grid-rows-[auto_1fr] border-l border-border bg-background shadow-lg transition-transform duration-200",
          item ? "translate-x-0" : "translate-x-full",
        )}
        aria-hidden={!item}
      >
        {item ? (
          <>
            <header className="flex items-start justify-between gap-3 border-b border-border bg-card px-5 py-4">
              <div className="flex min-w-0 flex-col gap-0.5">
                <h2 className="text-base font-semibold tracking-tight text-foreground">
                  {item.kind === "outbound" ? "Agent message" : "Message"}
                </h2>
                <code className="truncate font-mono text-xs text-muted-foreground">
                  {item.kind === "outbound"
                    ? item.intent.outboundIntentId
                    : item.entry.message.id}
                </code>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                <X aria-hidden />
                <span>Close</span>
              </Button>
            </header>

            <div className="flex flex-col gap-4 overflow-y-auto p-5">
              {item.kind === "inbound" ? (
                <InboundDetail item={item} />
              ) : (
                <OutboundDetail item={item} />
              )}
            </div>
          </>
        ) : null}
      </aside>
    </>
  );
}

function InboundDetail({ item }: { item: InboundItem }) {
  const { entry, senderName } = item;
  return (
    <>
      <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
        <DetailField label="Sender" value={senderName} />
        {entry.message.senderPhone ? (
          <DetailField label="Phone" value={entry.message.senderPhone} />
        ) : null}
        <DetailField label="Sender ID" value={entry.message.sender} />
        <DetailField
          label="Timestamp"
          value={formatDateTime(entry.message.createdAt)}
        />
        <DetailField
          label="Latest version"
          value={`v${entry.message.latestVersionNo}`}
        />
        <DetailField
          label="Deleted"
          value={entry.message.isDeleted ? "yes" : "no"}
        />
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold text-foreground">
          Lifecycle events
        </h3>
        {entry.versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No lifecycle events recorded.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {entry.versions.map((version) => (
              <li key={version.id} className="text-sm text-muted-foreground">
                <span className="font-mono text-xs text-foreground">
                  v{version.versionNo}
                </span>{" "}
                · {version.eventType} · {formatDateTime(version.occurredAt)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold text-foreground">
          Media assets
        </h3>
        {entry.media.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No media assets attached.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {entry.media.map((asset) => (
              <li
                key={asset.id}
                className="rounded-md border border-border bg-muted/40 p-3"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                    <span className="text-muted-foreground">
                      <MediaKindIcon kind={asset.kind} />
                    </span>
                    <span className="min-w-0 truncate">{asset.filename}</span>
                  </div>
                  <StatusBadge status={asset.status} />
                </div>

                <MediaAttachments
                  assets={[asset]}
                  showStatus={false}
                  showDownload
                />

                <p className="mt-2 text-xs text-muted-foreground">
                  {asset.transcript
                    ? `Transcript: ${asset.transcript}`
                    : "No transcript available."}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function OutboundDetail({ item }: { item: OutboundItem }) {
  const intent = item.intent;
  return (
    <>
      <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
        <DetailField label="Status" value={intent.status} />
        <DetailField
          label="Attempts"
          value={String(intent.attemptCount)}
        />
        <DetailField
          label="Created"
          value={formatDateTime(intent.createdAt)}
        />
        <DetailField
          label="Updated"
          value={formatDateTime(intent.updatedAt)}
        />
        {intent.replyToProviderMessageId ? (
          <DetailField
            label="Reply to"
            value={intent.replyToProviderMessageId}
          />
        ) : null}
        {intent.agentInstanceId ? (
          <DetailField label="Agent instance" value={intent.agentInstanceId} />
        ) : null}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold text-foreground">
          Message text
        </h3>
        {intent.text.trim() ? (
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">
            {intent.text}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            No outbound text recorded.
          </p>
        )}
      </section>

      {intent.lastError ? (
        <section className="rounded-lg border border-destructive/60 bg-destructive/10 p-4">
          <h3 className="mb-2 text-sm font-semibold text-destructive">
            Last error
          </h3>
          <p className="whitespace-pre-wrap break-words font-mono text-xs text-foreground">
            {intent.lastError}
          </p>
        </section>
      ) : null}

      {intent.agentRunId ? (
        <section className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            Agent run
          </h3>
          <Link
            href={`/agent-runs/${encodeURIComponent(intent.agentRunId)}`}
            className="inline-flex items-center gap-2 text-sm text-foreground hover:underline"
          >
            <ExternalLink aria-hidden className="size-4" />
            <span className="font-mono text-xs">{intent.agentRunId}</span>
          </Link>
        </section>
      ) : null}
    </>
  );
}
