import { AgentRunsTab } from "@/components/inbox/tabs/agent-runs-tab";

type Params = Promise<{ providerGroupId: string }>;

export default async function InboxAgentRunsTabPage({
  params,
}: {
  params: Params;
}) {
  const { providerGroupId: rawParam } = await params;
  const providerGroupId = decodeURIComponent(rawParam);
  return <AgentRunsTab providerGroupId={providerGroupId} />;
}
