"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { StatusBadge } from "@/components/status/status-badge";
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

type BubbleTheme = {
  bg: string;
  border: string;
  text: string;
  time: string;
};

const USER_BUBBLE_THEMES: BubbleTheme[] = [
  { bg: "#ffffff", border: "#dbe2ea", text: "#0f172a", time: "#64748b" },
  { bg: "#d9fdd3", border: "#a7f3d0", text: "#052e16", time: "#166534" },
  { bg: "#e0f2fe", border: "#bae6fd", text: "#0c4a6e", time: "#0369a1" },
  { bg: "#fef3c7", border: "#fde68a", text: "#78350f", time: "#92400e" },
  { bg: "#ede9fe", border: "#ddd6fe", text: "#4c1d95", time: "#6d28d9" },
  { bg: "#fee2e2", border: "#fecaca", text: "#7f1d1d", time: "#b91c1c" },
];

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

function themeForSender(sender: string): BubbleTheme {
  return USER_BUBBLE_THEMES[hashSender(sender) % USER_BUBBLE_THEMES.length];
}

function bubbleStyleForSender(sender: string): CSSProperties {
  const theme = themeForSender(sender);

  return {
    "--wa-bubble-bg": theme.bg,
    "--wa-bubble-border": theme.border,
    "--wa-bubble-text": theme.text,
    "--wa-time-color": theme.time,
  } as CSSProperties;
}

function messageText(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "(no text)";
}

export function GroupChatThread({ items }: GroupChatThreadProps) {
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);

  const selectedEntry = useMemo(
    () => items.find((item) => item.message.id === selectedMessageId),
    [items, selectedMessageId],
  );

  if (!items.length) {
    return <p className="muted-text">No messages found for this group.</p>;
  }

  return (
    <>
      <div className="wa-thread">
        {items.map((item) => {
          const side = sideForSender(item.message.sender);
          const imageAssets = item.media.filter((asset) => asset.kind === "image");

          return (
            <div
              className={side === "right" ? "wa-row wa-row-outgoing" : "wa-row wa-row-incoming"}
              key={item.message.id}
            >
              <button
                type="button"
                className={side === "right" ? "wa-bubble wa-bubble-right" : "wa-bubble wa-bubble-left"}
                style={bubbleStyleForSender(item.message.sender)}
                onClick={() => setSelectedMessageId(item.message.id)}
              >
                <p className="wa-time">{formatDateTime(item.message.createdAt)}</p>
                <p className="wa-text">{messageText(item.message.preview)}</p>

                {imageAssets.length ? (
                  <div className="wa-image-grid">
                    {imageAssets.map((asset) => (
                      <div className="wa-image-frame" key={asset.id}>
                        {asset.previewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={asset.previewUrl} alt={asset.filename} className="wa-image" />
                        ) : (
                          <div className="wa-image-fallback">Image preview unavailable</div>
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
        className={selectedEntry ? "wa-drawer-overlay wa-drawer-overlay-open" : "wa-drawer-overlay"}
        onClick={() => setSelectedMessageId(null)}
        aria-hidden={!selectedEntry}
      />

      <aside className={selectedEntry ? "wa-drawer wa-drawer-open" : "wa-drawer"}>
        {selectedEntry ? (
          <>
            <header className="wa-drawer-header">
              <div>
                <h2>Message details</h2>
                <p className="muted-text">{selectedEntry.message.id}</p>
              </div>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setSelectedMessageId(null)}
              >
                Close
              </button>
            </header>

            <div className="wa-drawer-content">
              <section className="panel stack">
                <p>
                  <strong>Sender:</strong> {selectedEntry.message.sender}
                </p>
                <p>
                  <strong>Timestamp:</strong> {formatDateTime(selectedEntry.message.createdAt)}
                </p>
                <p>
                  <strong>Latest version:</strong> v{selectedEntry.message.latestVersionNo}
                </p>
                <p>
                  <strong>Deleted:</strong> {selectedEntry.message.isDeleted ? "yes" : "no"}
                </p>
              </section>

              <section className="panel stack">
                <h3>Lifecycle events</h3>
                <ul className="inline-list">
                  {selectedEntry.versions.map((version) => (
                    <li key={version.id}>
                      v{version.versionNo} · {version.eventType} · {formatDateTime(version.occurredAt)}
                    </li>
                  ))}
                </ul>
              </section>

              <section className="panel stack">
                <h3>Media assets</h3>
                {selectedEntry.media.length ? (
                  selectedEntry.media.map((asset) => (
                    <article className="timeline-item" key={asset.id}>
                      <div className="timeline-item-head">
                        <span>
                          {asset.kind}: {asset.filename}
                        </span>
                        <StatusBadge status={asset.status} />
                      </div>

                      {asset.kind === "image" ? (
                        <div className="wa-drawer-image-frame">
                          {asset.previewUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={asset.previewUrl} alt={asset.filename} className="wa-drawer-image" />
                          ) : (
                            <div className="wa-image-fallback">Image preview unavailable</div>
                          )}
                        </div>
                      ) : null}

                      {asset.transcript ? (
                        <p className="muted-text">Transcript: {asset.transcript}</p>
                      ) : (
                        <p className="muted-text">No transcript available.</p>
                      )}
                    </article>
                  ))
                ) : (
                  <p className="muted-text">No media assets attached.</p>
                )}
              </section>
            </div>
          </>
        ) : null}
      </aside>
    </>
  );
}
