import type { CSSProperties } from "react";

import type { MessageRecord } from "@/lib/api-client/types";

export const SENDER_KEY_AGENT = "__agent__";

const ACCENT_COUNT = 6;

export function senderDisplayName(message: {
  sender?: string;
  senderPushName?: string;
  senderPhone?: string;
}): string {
  const pushName = message.senderPushName?.trim();
  if (pushName) return pushName;

  const phone = message.senderPhone?.trim();
  if (phone) return formatPhone(phone);

  const sender = message.sender?.trim();
  if (sender && sender !== "unknown") return sender;

  return "Unknown";
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+") && digits.length > 6) {
    return digits;
  }
  if (/^\d+$/.test(digits) && digits.length > 6) {
    return `+${digits}`;
  }
  return phone;
}

export function senderInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";

  if (trimmed.startsWith("+") && /^\+?\d/.test(trimmed)) {
    const digits = trimmed.replace(/\D/g, "");
    return digits.slice(-2).padStart(2, "0");
  }

  const parts = trimmed
    .split(/[\s\-_.]+/)
    .filter((part) => part.length > 0)
    .slice(0, 2);

  if (parts.length === 0) {
    return trimmed.slice(0, 2).toUpperCase();
  }

  if (parts.length === 1) {
    const part = parts[0];
    return part.length >= 2
      ? `${part[0]}${part[1]}`.toUpperCase()
      : part[0].toUpperCase();
  }

  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function senderAccentIndex(senderKey: string): number {
  if (senderKey === SENDER_KEY_AGENT) return 0;
  // Avoid index 0 for users so the agent's neutral palette stays distinct.
  return (hashString(senderKey) % (ACCENT_COUNT - 1)) + 1;
}

export function senderAccentStyle(senderKey: string): CSSProperties {
  const index = senderAccentIndex(senderKey);
  return {
    "--sender-bg": `var(--chat-accent-${index}-bg)`,
    "--sender-border": `var(--chat-accent-${index}-border)`,
    "--sender-text": `var(--chat-accent-${index}-text)`,
    "--sender-time": `var(--chat-accent-${index}-time)`,
  } as CSSProperties;
}

export function senderKeyForMessage(message: MessageRecord): string {
  return message.sender || "unknown";
}
