import { notFound } from "next/navigation";

import { ActivityTab } from "@/components/inbox/tabs/activity-tab";
import { listBindings } from "@/lib/api-client";
import { canAccessGroup, requireSession } from "@/lib/auth/session";

type Params = Promise<{ providerGroupId: string }>;

export default async function InboxActivityTabPage({
  params,
}: {
  params: Params;
}) {
  const { providerGroupId: rawParam } = await params;
  const providerGroupId = decodeURIComponent(rawParam);
  const session = await requireSession();

  if (!canAccessGroup(session, providerGroupId)) {
    notFound();
  }

  const bindings = await listBindings();
  const binding = bindings.find(
    (item) => item.providerGroupId === providerGroupId,
  );

  return <ActivityTab bindingId={binding?.id} />;
}
