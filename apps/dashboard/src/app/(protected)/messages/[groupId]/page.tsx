import { notFound } from "next/navigation";
import { GroupChatThread } from "@/components/messages/group-chat-thread";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/notice";
import {
  listBindings,
  listMediaAssets,
  listMessages,
  listMessageVersions,
} from "@/lib/api-client";
import { canAccessGroup, requireSession } from "@/lib/auth/session";
import { titleFromGroupId } from "@/lib/utils/format";
import {
  getWhatsAppGatewayConnectionStatus,
  listWhatsAppGatewayGroups,
} from "@/lib/whatsapp/ops";

type Params = Promise<{ groupId: string }>;

function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  if (!trimmed) {
    return trimmed;
  }

  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
}

export default async function GroupMessagesPage({
  params,
}: {
  params: Params;
}) {
  const { groupId } = await params;
  const providerGroupId = decodeURIComponent(groupId);
  const session = await requireSession();

  if (!canAccessGroup(session, providerGroupId)) {
    notFound();
  }

  const [bindings, scopedMessages, gatewayGroups, gatewayConnection] = await Promise.all([
    listBindings(),
    listMessages(providerGroupId),
    listWhatsAppGatewayGroups(),
    getWhatsAppGatewayConnectionStatus(),
  ]);

  const binding = bindings.find((item) => item.providerGroupId === providerGroupId);
  const gatewayGroup = gatewayGroups.find((item) => item.providerGroupId === providerGroupId);
  const contactMessage = scopedMessages.find((item) => item.senderPushName || item.senderPhone);
  const contactPhone = contactMessage?.senderPhone?.trim();

  const messagesWithDetails = await Promise.all(
    scopedMessages.map(async (message) => {
      const [versions, media] = await Promise.all([
        listMessageVersions(message.id),
        listMediaAssets(message.id),
      ]);

      return { message, versions, media };
    }),
  );

  const orderedConversation = messagesWithDetails.sort(
    (left, right) =>
      new Date(left.message.createdAt).getTime() -
      new Date(right.message.createdAt).getTime(),
  );

  return (
    <div className="grid">
      <PageHeader
        title={
          gatewayGroup?.groupTitle ??
          contactMessage?.senderPushName ??
          binding?.groupTitle ??
          titleFromGroupId(providerGroupId)
        }
        description={`WhatsApp chat view for ${providerGroupId}${contactPhone ? ` · ${normalizePhone(contactPhone)}` : ""}`}
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
          <p className="muted-text">
            Live group metadata may be unavailable until the WhatsApp session is
            connected (QR/login) in the gateway container.
          </p>
        </Notice>
      ) : null}

      <Notice title="Note" tone="info">
        This view focuses on chat content. Click a bubble to inspect message
        details.
      </Notice>

      <section className="panel wa-chat-panel">
        <GroupChatThread items={orderedConversation} />
      </section>
    </div>
  );
}
