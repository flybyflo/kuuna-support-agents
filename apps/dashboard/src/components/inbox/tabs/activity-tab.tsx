import { StatusBadge } from "@/components/status/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { listBindingTimeline } from "@/lib/api-client";
import { formatDateTime } from "@/lib/utils/format";

export async function ActivityTab({
  bindingId,
}: {
  bindingId?: string;
}) {
  if (!bindingId) {
    return (
      <div className="p-4">
        <Notice title="No activity yet" tone="info">
          Lifecycle activity becomes available once a binding is created for
          this group.
        </Notice>
      </div>
    );
  }

  const timeline = await listBindingTimeline(bindingId);

  return (
    <div className="p-4">
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
  );
}
