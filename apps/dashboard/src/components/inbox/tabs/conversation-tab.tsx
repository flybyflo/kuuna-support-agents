import {
  ChatTimeline,
  type InboundEntry,
} from "@/components/inbox/chat-timeline";
import { Notice } from "@/components/ui/notice";
import {
  listMediaAssets,
  listMessages,
  listMessageVersions,
  listOutboundIntents,
} from "@/lib/api-client";

function inboundHasContent(entry: InboundEntry): boolean {
  if (entry.media.length > 0) return true;
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
  const [scopedMessages, outbound] = await Promise.all([
    listMessages(providerGroupId),
    listOutboundIntents(providerGroupId),
  ]);

  const inbound: InboundEntry[] = await Promise.all(
    scopedMessages.map(async (message) => {
      const [versions, media] = await Promise.all([
        listMessageVersions(message.id),
        listMediaAssets(message.id),
      ]);
      return { message, versions, media };
    }),
  );

  const visibleInbound = inbound.filter(inboundHasContent);
  const visibleOutbound = outbound.filter(
    (intent) => intent.text.trim().length > 0 || Boolean(intent.lastError),
  );

  if (visibleInbound.length === 0 && visibleOutbound.length === 0) {
    return (
      <div className="h-full min-h-0 overflow-y-auto p-4">
        <Notice title="No conversation yet" tone="info">
          No messages have been persisted for this group. Messages will appear
          here once the gateway records inbound traffic.
        </Notice>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0">
      <ChatTimeline inbound={visibleInbound} outbound={visibleOutbound} />
    </div>
  );
}
