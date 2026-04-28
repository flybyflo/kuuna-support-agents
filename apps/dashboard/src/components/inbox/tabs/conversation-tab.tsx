import { GroupChatThread } from "@/components/messages/group-chat-thread";
import { Notice } from "@/components/ui/notice";
import {
  listMediaAssets,
  listMessages,
  listMessageVersions,
} from "@/lib/api-client";

type ConversationEntry = {
  message: Awaited<ReturnType<typeof listMessages>>[number];
  versions: Awaited<ReturnType<typeof listMessageVersions>>;
  media: Awaited<ReturnType<typeof listMediaAssets>>;
};

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

export async function ConversationTab({
  providerGroupId,
}: {
  providerGroupId: string;
}) {
  const scopedMessages = await listMessages(providerGroupId);

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

  if (orderedConversation.length === 0) {
    return (
      <div className="p-4">
        <Notice title="No conversation yet" tone="info">
          No messages have been persisted for this group. Messages will appear
          here once the gateway records inbound traffic.
        </Notice>
      </div>
    );
  }

  return <GroupChatThread items={orderedConversation} />;
}
