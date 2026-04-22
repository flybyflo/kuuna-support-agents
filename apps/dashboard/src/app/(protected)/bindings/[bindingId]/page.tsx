import { notFound } from "next/navigation";
import { Unlink2 } from "lucide-react";

import { StatusBadge } from "@/components/status/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import {
  getBinding,
  listBindingTimeline,
  listBindings,
} from "@/lib/api-client";
import { requireSession, canAccessGroup } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/utils/format";
import { resolveGroupTitle } from "@/lib/utils/group-title";
import { listWhatsAppGatewayGroups } from "@/lib/whatsapp/ops";

type Params = Promise<{ bindingId: string }>;

export default async function BindingDetailPage({
  params,
}: {
  params: Params;
}) {
  const { bindingId } = await params;
  const session = await requireSession();

  const binding = await getBinding(bindingId);
  if (!binding) {
    notFound();
  }

  if (!canAccessGroup(session, binding.providerGroupId)) {
    notFound();
  }

  const [timeline, bindings, gatewayGroups] = await Promise.all([
    listBindingTimeline(binding.id),
    listBindings(),
    listWhatsAppGatewayGroups(),
  ]);

  const resolvedGroupTitle = resolveGroupTitle({
    providerGroupId: binding.providerGroupId,
    bindings,
    gatewayGroups,
    fallback: binding.groupTitle,
  });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={resolvedGroupTitle}
        description={`Provider group ID: ${binding.providerGroupId}`}
        actions={
          <Button variant="destructive">
            <Unlink2 aria-hidden />
            <span>Unbind group</span>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Binding status</CardTitle>
            <CardDescription>
              Current runtime state and last update.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pb-6">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <StatusBadge status={binding.status} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Runtime</span>
              <span className="text-sm font-medium text-foreground">
                {binding.runtimeMode}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">Group JID</span>
              <code className="truncate rounded-sm border border-border bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
                {binding.providerGroupId}
              </code>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Updated</span>
              <span className="text-sm text-foreground">
                {formatDateTime(binding.updatedAt)}
              </span>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6 lg:col-span-2">
          <Notice title="Unbind behavior" tone="warning">
            Unbinding deactivates routing immediately. Existing messages, media,
            and transcripts are retained for audit and retrieval history.
          </Notice>

          <Card>
            <CardHeader>
              <CardTitle>Lifecycle timeline</CardTitle>
              <CardDescription>
                Provisioning and runtime events for this binding.
              </CardDescription>
            </CardHeader>
            <CardContent className="pb-6">
              {timeline.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">
                  No timeline events yet.
                </p>
              ) : (
                <ol className="relative ml-3 flex flex-col gap-5 border-l border-border pl-6">
                  {timeline.map((event) => (
                    <li key={event.id} className="relative">
                      <span
                        aria-hidden
                        className="absolute -left-[31px] top-1 flex size-3 items-center justify-center rounded-full border-2 border-background bg-primary"
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-foreground">
                          {event.label}
                        </p>
                        <StatusBadge status={event.status} />
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatDateTime(event.occurredAt)}
                      </p>
                      {event.details ? (
                        <p className="mt-1.5 text-sm text-muted-foreground">
                          {event.details}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
