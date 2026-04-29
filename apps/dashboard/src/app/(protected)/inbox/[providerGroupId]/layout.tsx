import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { GroupHeader } from "@/components/inbox/group-header";
import {
  listBindings,
  listGroupMembers,
  listMessages,
  listTodos,
} from "@/lib/api-client";
import { canAccessGroup, requireSession } from "@/lib/auth/session";
import { buildInboxGroupEntries } from "@/lib/inbox/build-group-entries";
import { listWhatsAppGatewayGroups } from "@/lib/whatsapp/ops";

type Params = Promise<{ providerGroupId: string }>;

export default async function InboxGroupLayout({
  params,
  children,
}: {
  params: Params;
  children: ReactNode;
}) {
  const { providerGroupId: rawParam } = await params;
  const providerGroupId = decodeURIComponent(rawParam);

  const session = await requireSession();
  if (!canAccessGroup(session, providerGroupId)) {
    notFound();
  }

  await listGroupMembers(providerGroupId);

  const [bindings, messages, todos, gatewayGroups] = await Promise.all([
    listBindings(),
    listMessages(),
    listTodos(providerGroupId),
    listWhatsAppGatewayGroups(),
  ]);

  const entries = buildInboxGroupEntries({
    session,
    bindings,
    messages,
    todos,
    gatewayGroups,
  });

  const entry = entries.find(
    (item) => item.providerGroupId === providerGroupId,
  );

  if (!entry) {
    notFound();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <GroupHeader entry={entry} />
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
