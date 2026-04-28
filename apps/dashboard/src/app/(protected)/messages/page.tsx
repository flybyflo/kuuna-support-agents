import Link from "next/link";

import { SimpleTable } from "@/components/data-table/simple-table";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/notice";
import { listBindings, listMessages } from "@/lib/api-client";
import { canAccessGroup, requireSession } from "@/lib/auth/session";
import { titleFromGroupId } from "@/lib/utils/format";
import {
  getWhatsAppGatewayConnectionStatus,
  listWhatsAppGatewayGroups,
} from "@/lib/whatsapp/ops";

function isDirectChat(groupId: string): boolean {
  return groupId.endsWith("@lid") || groupId.endsWith("@s.whatsapp.net");
}

function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  if (!trimmed) {
    return trimmed;
  }
  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
}

function hasVisibleMessageContent(message: Awaited<ReturnType<typeof listMessages>>[number]): boolean {
  const preview = message.preview.trim();
  return message.hasMedia || (preview.length > 0 && preview !== "(no text)");
}

export default async function MessagesPage() {
  const session = await requireSession();
  const [bindings, allMessages, gatewayGroups, gatewayConnection] = await Promise.all([
    listBindings(),
    listMessages(),
    listWhatsAppGatewayGroups(),
    getWhatsAppGatewayConnectionStatus(),
  ]);

  const accessibleBindings = bindings.filter((binding) =>
    canAccessGroup(session, binding.providerGroupId),
  );
  const accessibleMessages = allMessages.filter((message) =>
    canAccessGroup(session, message.providerGroupId),
  );

  const bindingsByGroupId = new Map(
    accessibleBindings.map((binding) => [binding.providerGroupId, binding]),
  );
  const gatewayGroupsById = new Map(
    gatewayGroups.map((group) => [group.providerGroupId, group]),
  );

  const providerGroupIds = new Set<string>([
    ...accessibleBindings.map((binding) => binding.providerGroupId),
    ...accessibleMessages.map((message) => message.providerGroupId),
  ]);

  const rows = Array.from(providerGroupIds)
    .map((providerGroupId) => {
      const binding = bindingsByGroupId.get(providerGroupId);
      const messagesForGroup = accessibleMessages
        .filter((message) => message.providerGroupId === providerGroupId)
        .filter(hasVisibleMessageContent);

      const gatewayGroup = gatewayGroupsById.get(providerGroupId);
      const directMessage = messagesForGroup.find((message) =>
        Boolean(message.senderPushName || message.senderPhone),
      );

      const directName = directMessage?.senderPushName?.trim();
      const directPhone = directMessage?.senderPhone?.trim();

      return {
        providerGroupId,
        groupTitle:
          gatewayGroup?.groupTitle ??
          directName ??
          binding?.groupTitle ??
          titleFromGroupId(providerGroupId),
        phone:
          isDirectChat(providerGroupId) && directPhone
            ? normalizePhone(directPhone)
            : undefined,
        count: messagesForGroup.length,
        mediaCount: messagesForGroup.filter((message) => message.hasMedia)
          .length,
      };
    })
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.groupTitle.localeCompare(right.groupTitle);
    });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Messages & media"
        description="Inspect persisted inbound events, edits/deletes, and media processing states."
      />

      {!gatewayConnection?.connected ? (
        <Notice
          title={
            gatewayConnection
              ? "WhatsApp gateway not connected"
              : "WhatsApp gateway status unavailable"
          }
          tone="warning"
        >
          <p className="text-sm text-muted-foreground">
            Group discovery via the gateway may be unavailable until the WhatsApp session is
            connected (QR/login) in the gateway container.
          </p>
        </Notice>
      ) : null}

      <Card className="overflow-hidden">
        <CardContent className="p-0 pt-0">
          <SimpleTable
            data={rows}
            emptyMessage="No messages persisted yet for your accessible groups."
            columns={[
              {
                header: "Group",
                cell: (row) => (
                  <div className="flex flex-col gap-0.5">
                    <Link
                      href={`/messages/${encodeURIComponent(row.providerGroupId)}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {row.groupTitle}
                    </Link>
                    <code className="font-mono text-xs text-muted-foreground">
                      {row.providerGroupId}
                      {row.phone ? ` · ${row.phone}` : ""}
                    </code>
                  </div>
                ),
              },
              {
                header: "Messages",
                cell: (row) => (
                  <span className="font-medium text-foreground">
                    {row.count}
                  </span>
                ),
              },
              {
                header: "With media",
                cell: (row) => (
                  <span className="text-sm text-muted-foreground">
                    {row.mediaCount}
                  </span>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
