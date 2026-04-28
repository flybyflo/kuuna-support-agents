"use client";

import { useMemo, useState, type CSSProperties } from "react";
import {
  Download,
  File as FileIcon,
  Image as ImageIcon,
  Music,
  Video,
  X,
} from "lucide-react";

import { StatusBadge } from "@/components/status/status-badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import type {
  MediaAsset,
  MessageRecord,
  MessageVersion,
} from "@/lib/api-client/types";
import { formatDateTime } from "@/lib/utils/format";

type ConversationEntry = {
  message: MessageRecord;
  versions: MessageVersion[];
  media: MediaAsset[];
};

type GroupChatThreadProps = {
  items: ConversationEntry[];
};

type BubbleSide = "left" | "right";

const ACCENT_COUNT = 6;

function hashSender(sender: string): number {
  let hash = 0;
  for (let index = 0; index < sender.length; index += 1) {
    hash = (hash * 31 + sender.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function sideForSender(sender: string): BubbleSide {
  if (/kuuna|agent|bot/i.test(sender)) {
    return "right";
  }
  return hashSender(sender) % 2 === 0 ? "left" : "right";
}

function accentIndexForSender(sender: string): number {
  return hashSender(sender) % ACCENT_COUNT;
}

function bubbleStyleForSender(sender: string): CSSProperties {
  const accent = accentIndexForSender(sender);
  return {
    "--bubble-bg": `var(--chat-accent-${accent}-bg)`,
    "--bubble-border": `var(--chat-accent-${accent}-border)`,
    "--bubble-text": `var(--chat-accent-${accent}-text)`,
    "--bubble-time": `var(--chat-accent-${accent}-time)`,
  } as CSSProperties;
}

function messageText(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "(no text)";
}

function displayText(item: ConversationEntry): string {
  const latestVersionText = item.versions[0]?.text?.trim();
  if (latestVersionText) {
    return latestVersionText;
  }

  const preview = item.message.preview.trim();
  if (preview && preview !== "(no text)") {
    return preview;
  }

  if (item.media.length > 0) {
    const kinds = [...new Set(item.media.map((asset) => asset.kind))].join(", ");
    return `Media attachment${item.media.length === 1 ? "" : "s"}: ${kinds}`;
  }

  return "(no text)";
}

function downloadUrlForAsset(asset: MediaAsset): string | undefined {
  return asset.downloadUrl ?? (asset.kind === "image" ? asset.previewUrl : undefined);
}

function formatByteSize(value: number | undefined): string | null {
  if (!value || value <= 0) {
    return null;
  }

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
  if (kind === "image") {
    return <ImageIcon aria-hidden className="size-4" />;
  }
  if (kind === "audio") {
    return <Music aria-hidden className="size-4" />;
  }
  if (kind === "video") {
    return <Video aria-hidden className="size-4" />;
  }
  return <FileIcon aria-hidden className="size-4" />;
}

function MediaAttachments({
  assets,
  showStatus,
  showDownload,
}: {
  assets: MediaAsset[];
  showStatus: boolean;
  showDownload: boolean;
}) {
  if (assets.length === 0) {
    return null;
  }

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
                  className="mx-auto block h-auto max-h-80 max-w-full object-contain"
                />
              ) : (
                <div className="grid min-h-[140px] place-items-center bg-muted text-xs text-muted-foreground">
                  Image preview unavailable
                </div>
              )
            ) : null}

            <div className="flex items-center justify-between gap-2 px-2.5 py-2">
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

export function GroupChatThread({ items }: GroupChatThreadProps) {
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(
    null,
  );

  const selectedEntry = useMemo(
    () => items.find((item) => item.message.id === selectedMessageId),
    [items, selectedMessageId],
  );

  if (!items.length) {
    return (
      <p className="px-6 py-8 text-center text-sm text-muted-foreground">
        No messages found for this group.
      </p>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2.5 bg-chat-surface p-4 sm:p-5">
        {items.map((item) => {
          const side = sideForSender(item.message.sender);

          return (
            <div
              key={item.message.id}
              className={cn(
                "flex",
                side === "right" ? "justify-end" : "justify-start",
              )}
            >
              <button
                type="button"
                onClick={() => setSelectedMessageId(item.message.id)}
                style={bubbleStyleForSender(item.message.sender)}
                className={cn(
                  "flex w-[min(760px,85%)] flex-col gap-1 rounded-md border px-3 py-2 text-left shadow-xs transition-[filter]",
                  "bg-[color:var(--bubble-bg)] border-[color:var(--bubble-border)] text-[color:var(--bubble-text)]",
                  "hover:brightness-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                  side === "right" ? "rounded-tr-sm" : "rounded-tl-sm",
                )}
              >
                <p className="self-end text-[10.5px] text-[color:var(--bubble-time)]">
                  {formatDateTime(item.message.createdAt)}
                </p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">
                  {messageText(displayText(item))}
                </p>

                <MediaAttachments
                  assets={item.media}
                  showStatus={false}
                  showDownload={false}
                />
              </button>
            </div>
          );
        })}
      </div>

      <div
        className={cn(
          "fixed inset-0 z-40 bg-foreground/30 transition-opacity duration-200",
          selectedEntry
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
        onClick={() => setSelectedMessageId(null)}
        aria-hidden={!selectedEntry}
      />

      <aside
        className={cn(
          "fixed right-0 top-0 z-50 grid h-screen w-[min(520px,96vw)] grid-rows-[auto_1fr] border-l border-border bg-background shadow-lg transition-transform duration-200",
          selectedEntry ? "translate-x-0" : "translate-x-full",
        )}
        aria-hidden={!selectedEntry}
      >
        {selectedEntry ? (
          <>
            <header className="flex items-start justify-between gap-3 border-b border-border bg-card px-5 py-4">
              <div className="flex min-w-0 flex-col gap-0.5">
                <h2 className="text-base font-semibold tracking-tight text-foreground">
                  Message details
                </h2>
                <code className="truncate font-mono text-xs text-muted-foreground">
                  {selectedEntry.message.id}
                </code>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedMessageId(null)}
              >
                <X aria-hidden />
                <span>Close</span>
              </Button>
            </header>

            <div className="flex flex-col gap-4 overflow-y-auto p-5">
              <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Sender
                  </span>
                  <span className="text-sm text-foreground">
                    {selectedEntry.message.sender}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Timestamp
                  </span>
                  <span className="text-sm text-foreground">
                    {formatDateTime(selectedEntry.message.createdAt)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Latest version
                  </span>
                  <span className="text-sm text-foreground">
                    v{selectedEntry.message.latestVersionNo}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Deleted
                  </span>
                  <span className="text-sm text-foreground">
                    {selectedEntry.message.isDeleted ? "yes" : "no"}
                  </span>
                </div>
              </section>

              <section className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-2 text-sm font-semibold text-foreground">
                  Lifecycle events
                </h3>
                {selectedEntry.versions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No lifecycle events recorded.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {selectedEntry.versions.map((version) => (
                      <li
                        key={version.id}
                        className="text-sm text-muted-foreground"
                      >
                        <span className="font-mono text-xs text-foreground">
                          v{version.versionNo}
                        </span>{" "}
                        · {version.eventType} ·{" "}
                        {formatDateTime(version.occurredAt)}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-2 text-sm font-semibold text-foreground">
                  Media assets
                </h3>
                {selectedEntry.media.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No media assets attached.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {selectedEntry.media.map((asset) => (
                      <li
                        key={asset.id}
                        className="rounded-md border border-border bg-muted/40 p-3"
                      >
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                            <span className="text-muted-foreground">
                              <MediaKindIcon kind={asset.kind} />
                            </span>
                            <span className="min-w-0 truncate">
                              {asset.filename}
                            </span>
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
            </div>
          </>
        ) : null}
      </aside>
    </>
  );
}
