import { TodosTab } from "@/components/inbox/tabs/todos-tab";
import { requireSession } from "@/lib/auth/session";

type Params = Promise<{ providerGroupId: string }>;

export default async function InboxTodosTabPage({
  params,
}: {
  params: Params;
}) {
  const { providerGroupId: rawParam } = await params;
  const providerGroupId = decodeURIComponent(rawParam);
  const session = await requireSession();

  return <TodosTab providerGroupId={providerGroupId} session={session} />;
}
