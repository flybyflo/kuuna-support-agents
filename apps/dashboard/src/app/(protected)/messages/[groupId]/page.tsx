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
import {
  getWhatsAppGatewayConnectionStatus,
  listWhatsAppGatewayGroups,
} from "@/lib/whatsapp/ops";

type Params = Promise<{ groupId: string }>;

type ConversationEntry = {
  message: Awaited<ReturnType<typeof listMessages>>[number];
  versions: Awaited<ReturnType<typeof listMessageVersions>>;
  media: Awaited<ReturnType<typeof listMediaAssets>>;
};

function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  if (!trimmed) {
    return trimmed;
  }
  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
}

function hasVisibleChatContent(entry: ConversationEntry): boolean {
  if (entry.media.length > 0) {
    return true;
  }

  if (entry.versions.some((version) => version.text.trim().length > 0)) {
    return true;
  }

  const preview = entry.message.preview.trim();
  return preview.length > 0 && preview !== "(no text)";
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

  const orderedConversation = messagesWithDetails
    .filter(hasVisibleChatContent)
    .sort(
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
            Live group metadata may be unavailable until the WhatsApp session is
            connected (QR/login) in the gateway container.
          </p>
        </Notice>
      ) : null}

      <Notice title="Note" tone="info">
        This view focuses on chat content. Click a bubble to inspect message
        details.
      </Notice>

      <Card className="overflow-hidden p-0">
        <GroupChatThread items={orderedConversation} />
      </Card>
    </div>
  );
}
