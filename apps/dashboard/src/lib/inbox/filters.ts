import type {
  GroupBinding,
  MessageRecord,
  TodoItem,
} from "@/lib/api-client/types";
import type { WhatsAppGatewayGroup } from "@/lib/whatsapp/ops";

export type InboxGroupKind = "group" | "direct";

export type InboxGroupEntry = {
  providerGroupId: string;
  displayTitle: string;
  kind: InboxGroupKind;
  bound: boolean;
  bindingId?: string;
  bindingStatus?: GroupBinding["status"];
  lastActivityAt?: string;
  messageCount: number;
  mediaCount: number;
  openTodoCount: number;
  totalTodoCount: number;
  participantsCount?: number;
  contactPushName?: string;
  contactPhone?: string;
};

export type InboxFilter =
  | "all"
  | "bound"
  | "unbound"
  | "direct"
  | "open-todos";

export const INBOX_FILTERS: Array<{ id: InboxFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "bound", label: "Bound" },
  { id: "unbound", label: "Unbound" },
  { id: "direct", label: "Direct chats" },
  { id: "open-todos", label: "Open todos" },
];

export function isDirectChat(providerGroupId: string): boolean {
  return (
    providerGroupId.endsWith("@s.whatsapp.net") ||
    providerGroupId.endsWith("@lid")
  );
}

export function applyInboxFilter(
  entries: InboxGroupEntry[],
  filter: InboxFilter,
): InboxGroupEntry[] {
  switch (filter) {
    case "bound":
      return entries.filter((entry) => entry.bound);
    case "unbound":
      return entries.filter((entry) => !entry.bound);
    case "direct":
      return entries.filter((entry) => entry.kind === "direct");
    case "open-todos":
      return entries.filter((entry) => entry.openTodoCount > 0);
    case "all":
    default:
      return entries;
  }
}

export function parseInboxFilter(value: unknown): InboxFilter {
  if (typeof value !== "string") return "all";
  const candidate = INBOX_FILTERS.find((option) => option.id === value);
  return candidate?.id ?? "all";
}

// These types are re-exported as imports here to keep the filter module
// self-contained without pulling server-only dependencies.
export type { GroupBinding, MessageRecord, TodoItem, WhatsAppGatewayGroup };
