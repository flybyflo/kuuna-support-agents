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
import { FormActions, FormRow } from "@/components/ui/form";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import {
  getBinding,
  listTemplates,
  listTemplateVersions,
} from "@/lib/api-client";
import {
  createBindingAction,
  unbindBindingAction,
} from "@/lib/bindings/actions";
import { hasPermission, type StaffSession } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/utils/format";

type SettingsTabProps = {
  providerGroupId: string;
  bindingId?: string;
  session: StaffSession;
  searchParams?: Record<string, string | string[] | undefined>;
};

function getSingleParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function SettingsTab({
  providerGroupId,
  bindingId,
  session,
  searchParams = {},
}: SettingsTabProps) {
  const canWriteBindings = hasPermission(session, "bindings", "write");
  const canDeleteBindings = hasPermission(session, "bindings", "delete");

  const created = getSingleParam(searchParams.created);
  const unbound = getSingleParam(searchParams.unbound);
  const unbindError = getSingleParam(searchParams.unbind);
  const bindError = getSingleParam(searchParams.bind);
  const reason = getSingleParam(searchParams.reason);

  if (bindingId) {
    const binding = await getBinding(bindingId);

    return (
      <div className="flex flex-col gap-6 p-4">
        {created === "1" ? (
          <Notice title="Binding created" tone="success">
            Routing for this group is now active.
          </Notice>
        ) : null}

        {unbound === "1" ? (
          <Notice title="Group unbound" tone="success">
            The group is no longer routed to an agent. History remains
            available.
          </Notice>
        ) : null}

        {unbindError === "error" ? (
          <Notice title="Unbind failed" tone="warning">
            {reason ?? "The binding could not be deactivated."}
          </Notice>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Binding status</CardTitle>
            <CardDescription>
              Current routing state for this provider group.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pb-6">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              {binding ? (
                <StatusBadge status={binding.status} />
              ) : (
                <span className="text-sm text-foreground">unknown</span>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Runtime</span>
              <span className="text-sm font-medium text-foreground">
                {binding?.runtimeMode ?? "—"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">Group JID</span>
              <code className="truncate rounded-sm border border-border bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
                {providerGroupId}
              </code>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Updated</span>
              <span className="text-sm text-foreground">
                {binding ? formatDateTime(binding.updatedAt) : "—"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Notice title="Unbind behavior" tone="warning">
          Unbinding deactivates routing immediately. Existing messages, media,
          and transcripts are retained for audit and retrieval history.
        </Notice>

        {canDeleteBindings ? (
          <form action={unbindBindingAction}>
            <input type="hidden" name="bindingId" value={bindingId} />
            <input
              type="hidden"
              name="providerGroupId"
              value={providerGroupId}
            />
            <Button
              type="submit"
              variant="destructive"
              disabled={binding?.status === "inactive"}
            >
              <Unlink2 aria-hidden />
              <span>Unbind group</span>
            </Button>
          </form>
        ) : (
          <p className="text-xs text-muted-foreground">
            Your role can view binding details but cannot unbind groups.
          </p>
        )}
      </div>
    );
  }

  const templates = await listTemplates();
  const templateOptions = (
    await Promise.all(
      templates.map(async (template) => {
        const versions = await listTemplateVersions(template.id);
        const preferred =
          versions.find((version) => version.status === "published") ??
          versions[0];
        if (!preferred) {
          return null;
        }

        return {
          templateId: template.id,
          templateName: template.displayName,
          templateVersionId: preferred.id,
          label: `${template.displayName} (v${preferred.versionNo}, ${preferred.status})`,
        };
      }),
    )
  ).filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <div className="flex flex-col gap-6 p-4">
      {bindError === "error" ? (
        <Notice title="Binding failed" tone="warning">
          {reason ?? "Unable to create the binding."}
        </Notice>
      ) : null}

      <Notice title="No active binding" tone="info">
        This group has no agent binding yet. Pair it with a published template
        version below to start routing messages.
      </Notice>

      <Card>
        <CardHeader>
          <CardTitle>Bind this group</CardTitle>
          <CardDescription>
            Routing follows: create records → provision runtime → health check
            → disclosure message → active state.
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-6">
          {templateOptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No template versions available. Create a published template first.
            </p>
          ) : (
            <form
              action={createBindingAction}
              className="flex flex-col gap-4"
            >
              <input
                type="hidden"
                name="providerGroupId"
                value={providerGroupId}
              />
              <input type="hidden" name="origin" value="settings" />

              <FormRow label="Template version" htmlFor="templateVersionId">
                <Select
                  id="templateVersionId"
                  name="templateVersionId"
                  defaultValue={templateOptions[0]?.templateVersionId ?? ""}
                  required
                  disabled={!canWriteBindings}
                >
                  {templateOptions.map((template) => (
                    <option
                      key={template.templateVersionId}
                      value={template.templateVersionId}
                    >
                      {template.label}
                    </option>
                  ))}
                </Select>
              </FormRow>

              <FormActions>
                <Button type="submit" disabled={!canWriteBindings}>
                  Submit bind request
                </Button>
              </FormActions>

              {!canWriteBindings ? (
                <p className="text-xs text-muted-foreground">
                  Your role can view binding settings but cannot bind groups.
                </p>
              ) : null}
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
