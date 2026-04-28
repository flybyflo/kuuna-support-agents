import "server-only";

import type {
  GroupBinding,
  MessageRecord,
  TodoItem,
} from "@/lib/api-client/types";
import type { StaffSession } from "@/lib/auth/session";
import { canAccessGroup } from "@/lib/auth/session";
import { isDirectChat, type InboxGroupEntry } from "@/lib/inbox/filters";
import { resolveGroupTitle } from "@/lib/utils/group-title";
import type { WhatsAppGatewayGroup } from "@/lib/whatsapp/ops";

function maxIso(left?: string, right?: string): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}

export function buildInboxGroupEntries(input: {
  session: StaffSession;
  bindings: GroupBinding[];
  messages: MessageRecord[];
  todos: TodoItem[];
  gatewayGroups: WhatsAppGatewayGroup[];
}): InboxGroupEntry[] {
  const { session, bindings, messages, todos, gatewayGroups } = input;

  const accessibleBindings = bindings.filter((binding) =>
    canAccessGroup(session, binding.providerGroupId),
  );
  const accessibleMessages = messages.filter((message) =>
    canAccessGroup(session, message.providerGroupId),
  );
  const accessibleTodos = todos.filter((todo) =>
    canAccessGroup(session, todo.providerGroupId),
  );
  const accessibleGatewayGroups = gatewayGroups.filter((group) =>
    canAccessGroup(session, group.providerGroupId),
  );

  const providerGroupIds = new Set<string>([
    ...accessibleBindings.map((b) => b.providerGroupId),
    ...accessibleMessages.map((m) => m.providerGroupId),
    ...accessibleTodos.map((t) => t.providerGroupId),
    ...accessibleGatewayGroups.map((g) => g.providerGroupId),
  ]);

  const bindingsByGroupId = new Map(
    accessibleBindings.map((b) => [b.providerGroupId, b]),
  );

  const entries: InboxGroupEntry[] = [];

  for (const providerGroupId of providerGroupIds) {
    const binding = bindingsByGroupId.get(providerGroupId);
    const messagesForGroup = accessibleMessages.filter(
      (m) => m.providerGroupId === providerGroupId,
    );
    const todosForGroup = accessibleTodos.filter(
      (t) => t.providerGroupId === providerGroupId,
    );
    const gatewayGroup = accessibleGatewayGroups.find(
      (g) => g.providerGroupId === providerGroupId,
    );

    const contactMessage = messagesForGroup.find(
      (m) => m.senderPushName || m.senderPhone,
    );

    const latestMessageAt = messagesForGroup.reduce<string | undefined>(
      (acc, m) => maxIso(acc, m.createdAt),
      undefined,
    );
    const latestTodoAt = todosForGroup.reduce<string | undefined>(
      (acc, t) => maxIso(acc, t.updatedAt),
      undefined,
    );

    const lastActivityAt = maxIso(
      maxIso(latestMessageAt, latestTodoAt),
      binding?.updatedAt,
    );

    const displayTitle = resolveGroupTitle({
      providerGroupId,
      bindings: accessibleBindings,
      gatewayGroups: accessibleGatewayGroups,
      fallback:
        contactMessage?.senderPushName?.trim() || binding?.groupTitle,
    });

    entries.push({
      providerGroupId,
      displayTitle,
      kind: isDirectChat(providerGroupId) ? "direct" : "group",
      bound: Boolean(binding),
      bindingId: binding?.id,
      bindingStatus: binding?.status,
      lastActivityAt,
      messageCount: messagesForGroup.length,
      mediaCount: messagesForGroup.filter((m) => m.hasMedia).length,
      openTodoCount: todosForGroup.filter(
        (t) => t.status === "open" || t.status === "in_progress",
      ).length,
      totalTodoCount: todosForGroup.length,
      participantsCount: gatewayGroup?.participantsCount,
      contactPushName: contactMessage?.senderPushName?.trim(),
      contactPhone: contactMessage?.senderPhone?.trim(),
    });
  }

  return entries.sort((left, right) => {
    if (left.lastActivityAt && right.lastActivityAt) {
      return right.lastActivityAt.localeCompare(left.lastActivityAt);
    }
    if (left.lastActivityAt) return -1;
    if (right.lastActivityAt) return 1;
    return left.displayTitle.localeCompare(right.displayTitle);
  });
}

export type { InboxGroupEntry } from "@/lib/inbox/filters";
