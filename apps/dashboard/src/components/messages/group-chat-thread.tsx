"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { X } from "lucide-react";

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
          const imageAssets = item.media.filter(
            (asset) => asset.kind === "image",
          );

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
                  {messageText(item.message.preview)}
                </p>

                {imageAssets.length ? (
                  <div className="mt-1.5 grid gap-2">
                    {imageAssets.map((asset) => (
                      <div
                        key={asset.id}
                        className="overflow-hidden rounded-md border border-border bg-muted"
                      >
                        {asset.previewUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={asset.previewUrl}
                            alt={asset.filename}
                            className="block max-h-80 w-full object-contain"
                          />
                        ) : (
                          <div className="grid min-h-[140px] place-items-center bg-muted text-xs text-muted-foreground">
                            Image preview unavailable
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
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
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-sm text-foreground">
                            {asset.kind}: {asset.filename}
                          </span>
                          <StatusBadge status={asset.status} />
                        </div>

                        {asset.kind === "image" ? (
                          <div className="overflow-hidden rounded-md border border-border bg-card">
                            {asset.previewUrl ? (
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img
                                src={asset.previewUrl}
                                alt={asset.filename}
                                className="block max-h-64 w-full object-contain"
                              />
                            ) : (
                              <div className="grid min-h-[120px] place-items-center text-xs text-muted-foreground">
                                Image preview unavailable
                              </div>
                            )}
                          </div>
                        ) : null}

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
