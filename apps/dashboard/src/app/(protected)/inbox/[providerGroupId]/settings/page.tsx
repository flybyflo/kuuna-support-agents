import { notFound } from "next/navigation";

import { SettingsTab } from "@/components/inbox/tabs/settings-tab";
import { listBindings } from "@/lib/api-client";
import { canAccessGroup, requireSession } from "@/lib/auth/session";

type Params = Promise<{ providerGroupId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function InboxSettingsTabPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { providerGroupId: rawParam } = await params;
  const providerGroupId = decodeURIComponent(rawParam);
  const session = await requireSession();

  if (!canAccessGroup(session, providerGroupId)) {
    notFound();
  }

  const resolvedSearchParams = await searchParams;

  const bindings = await listBindings();
  const binding = bindings.find(
    (item) =>
      item.providerGroupId === providerGroupId && item.status === "active",
  );

  return (
    <SettingsTab
      providerGroupId={providerGroupId}
      bindingId={binding?.id}
      session={session}
      searchParams={resolvedSearchParams}
    />
  );
}
