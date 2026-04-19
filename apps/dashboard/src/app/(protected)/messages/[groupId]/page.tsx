import { notFound } from "next/navigation";

import { GroupChatThread } from "@/components/messages/group-chat-thread";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import {
  listBindings,
  listMediaAssets,
  listMessages,
  listMessageVersions,
} from "@/lib/api-client";
import { canAccessGroup, requireSession } from "@/lib/auth/session";
import { titleFromGroupId } from "@/lib/utils/format";
import { listWhatsAppGatewayGroups } from "@/lib/whatsapp/ops";

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

  const [bindings, scopedMessages, gatewayGroups] = await Promise.all([
    listBindings(),
    listMessages(providerGroupId),
    listWhatsAppGatewayGroups(),
  ]);

  const binding = bindings.find(
    (item) => item.providerGroupId === providerGroupId,
  );
  const gatewayGroup = gatewayGroups.find(
    (item) => item.providerGroupId === providerGroupId,
  );
  const contactMessage = scopedMessages.find(
    (item) => item.senderPushName || item.senderPhone,
  );
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
    <div className="flex flex-col gap-8">
      <PageHeader
        title={
          gatewayGroup?.groupTitle ??
          contactMessage?.senderPushName ??
          binding?.groupTitle ??
          titleFromGroupId(providerGroupId)
        }
        description={`WhatsApp chat view for ${providerGroupId}${contactPhone ? ` · ${normalizePhone(contactPhone)}` : ""}`}
      />

      <Notice title="Hinweis" tone="info">
        Im Verlauf werden nur Chat-Inhalte gezeigt. Für Details zu einer
        Nachricht einfach auf die Bubble klicken.
      </Notice>

      <Card className="overflow-hidden p-0">
        <GroupChatThread items={orderedConversation} />
      </Card>
    </div>
  );
}
