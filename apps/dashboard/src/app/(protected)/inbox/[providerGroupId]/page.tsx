import { ConversationTab } from "@/components/inbox/tabs/conversation-tab";

type Params = Promise<{ providerGroupId: string }>;

export default async function InboxConversationPage({
  params,
}: {
  params: Params;
}) {
  const { providerGroupId: rawParam } = await params;
  const providerGroupId = decodeURIComponent(rawParam);

  return <ConversationTab providerGroupId={providerGroupId} />;
}
