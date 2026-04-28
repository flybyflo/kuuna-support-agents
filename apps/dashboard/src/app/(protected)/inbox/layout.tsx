import type { ReactNode } from "react";

import { GroupList } from "@/components/inbox/group-list";
import {
  listBindings,
  listMessages,
  listTodos,
} from "@/lib/api-client";
import { requireSession } from "@/lib/auth/session";
import { buildInboxGroupEntries } from "@/lib/inbox/build-group-entries";
import { listWhatsAppGatewayGroups } from "@/lib/whatsapp/ops";

export default async function InboxLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireSession();
  const [bindings, messages, todos, gatewayGroups] = await Promise.all([
    listBindings(),
    listMessages(),
    listTodos(),
    listWhatsAppGatewayGroups(),
  ]);

  const entries = buildInboxGroupEntries({
    session,
    bindings,
    messages,
    todos,
    gatewayGroups,
  });

  return (
    <div className="-mx-6 -my-8 grid h-[calc(100vh-4rem)] grid-cols-[320px_1fr] overflow-hidden sm:-mx-8 sm:-my-10">
      <aside className="flex min-h-0 flex-col border-r border-sidebar-border bg-sidebar/40">
        <GroupList entries={entries} />
      </aside>
      <section className="flex min-h-0 flex-col overflow-hidden">
        {children}
      </section>
    </div>
  );
}
