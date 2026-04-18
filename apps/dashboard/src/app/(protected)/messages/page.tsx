import Link from "next/link";
import { SimpleTable } from "@/components/data-table/simple-table";
import { PageHeader } from "@/components/ui/page-header";
import { listBindings, listMessages } from "@/lib/api-client";
import { canAccessGroup, requireSession } from "@/lib/auth/session";
import { titleFromGroupId } from "@/lib/utils/format";
import { listWhatsAppGatewayGroups } from "@/lib/whatsapp/ops";

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

export default async function MessagesPage() {
  const session = await requireSession();
  const [bindings, allMessages, gatewayGroups] = await Promise.all([
    listBindings(),
    listMessages(),
    listWhatsAppGatewayGroups(),
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
      const messagesForGroup = accessibleMessages.filter(
        (message) => message.providerGroupId === providerGroupId,
      );

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
        phone: isDirectChat(providerGroupId) && directPhone ? normalizePhone(directPhone) : undefined,
        count: messagesForGroup.length,
        mediaCount: messagesForGroup.filter((message) => message.hasMedia).length,
      };
    })
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }

      return left.groupTitle.localeCompare(right.groupTitle);
    });

  return (
    <div className="grid">
      <PageHeader
        title="Messages & Media"
        description="Inspect persisted inbound events, edits/deletes, and media processing states."
      />

      <section className="panel">
        <SimpleTable
          data={rows}
          emptyMessage="No messages persisted yet for your accessible groups."
          columns={[
            {
              header: "Group",
              cell: (row) => (
                <div>
                  <Link
                    href={`/messages/${encodeURIComponent(row.providerGroupId)}`}
                    style={{ fontWeight: 600 }}
                  >
                    {row.groupTitle}
                  </Link>
                  <p className="muted-text">
                    <span className="inline-code">{row.providerGroupId}</span>
                    {row.phone ? ` · ${row.phone}` : ""}
                  </p>
                </div>
              ),
            },
            {
              header: "Messages",
              cell: (row) => row.count,
            },
            {
              header: "With media",
              cell: (row) => row.mediaCount,
            },
          ]}
        />
      </section>
    </div>
  );
}
