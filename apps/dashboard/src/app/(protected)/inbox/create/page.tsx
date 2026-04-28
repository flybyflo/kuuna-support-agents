import { AutoRefresh } from "@/components/system/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FormActions, FormRow } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  listBindings,
  listKnownProviderGroups,
  listTemplates,
  listTemplateVersions,
} from "@/lib/api-client";
import {
  createBindingAction,
  createWhatsAppGroupAction,
} from "@/lib/bindings/actions";
import { requireAuthorized } from "@/lib/auth/guards";
import { canAccessGroup } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/utils/format";
import {
  getWhatsAppGatewayConnectionStatus,
  listWhatsAppGatewayGroups,
} from "@/lib/whatsapp/ops";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function getSingleParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function InboxCreatePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireAuthorized("bindings", "write");
  const params = await searchParams;

  const [bindings, templates, knownGroups, gatewayConnection] =
    await Promise.all([
      listBindings(),
      listTemplates(),
      listKnownProviderGroups(),
      getWhatsAppGatewayConnectionStatus(),
    ]);
  const gatewayGroups = gatewayConnection?.connected
    ? await listWhatsAppGatewayGroups()
    : [];

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

  const mergedGroups = new Map<
    string,
    {
      jid: string;
      name: string;
      participantsCount?: number;
      lastSeenAt?: string;
      sources: string[];
    }
  >();

  for (const group of knownGroups) {
    mergedGroups.set(group.providerGroupId, {
      jid: group.providerGroupId,
      name: group.groupTitle,
      lastSeenAt: group.lastSeenAt,
      sources: [...group.sources],
    });
  }

  for (const group of gatewayGroups) {
    const existing = mergedGroups.get(group.providerGroupId);
    if (!existing) {
      mergedGroups.set(group.providerGroupId, {
        jid: group.providerGroupId,
        name: group.groupTitle,
        participantsCount: group.participantsCount,
        sources: ["whatsapp"],
      });
      continue;
    }

    existing.name = group.groupTitle || existing.name;
    existing.participantsCount = group.participantsCount;
    if (!existing.sources.includes("whatsapp")) {
      existing.sources.push("whatsapp");
    }
  }

  const boundGroupIds = new Set(
    bindings.map((binding) => binding.providerGroupId),
  );

  const selectableGroups = [...mergedGroups.values()]
    .filter((group) => canAccessGroup(session, group.jid))
    .sort((a, b) => a.name.localeCompare(b.name));

  const selectedGroupId =
    getSingleParam(params.providerGroupId) ?? selectableGroups[0]?.jid ?? "";

  const createGroupStatus = getSingleParam(params.createGroup);
  const bindStatus = getSingleParam(params.bind);

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-6 p-6">
        <AutoRefresh
          intervalMs={15000}
          eventTypes={["binding.updated", "runtime_container.updated"]}
        />

        <PageHeader
          title="Bind WhatsApp group"
          description="Select an existing WhatsApp JID or create a new group, then bind a template version."
        />

        {createGroupStatus === "ok" ? (
          <Notice title="WhatsApp group created" tone="success">
            {getSingleParam(params.groupName) ?? "Group"} ·{" "}
            <code className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
              {getSingleParam(params.providerGroupId)}
            </code>
          </Notice>
        ) : null}

        {createGroupStatus === "error" ? (
          <Notice title="Could not create WhatsApp group" tone="warning">
            {getSingleParam(params.reason) ?? "unknown error"}
          </Notice>
        ) : null}

        {bindStatus === "error" ? (
          <Notice title="Binding failed" tone="warning">
            {getSingleParam(params.reason) ?? "unknown error"}
          </Notice>
        ) : null}

        <Notice
          title={
            gatewayConnection
              ? gatewayConnection.connected
                ? "WhatsApp gateway connected"
                : "WhatsApp gateway disconnected"
              : "WhatsApp gateway status unavailable"
          }
          tone={gatewayConnection?.connected ? "success" : "warning"}
        >
          {gatewayConnection ? (
            <p>
              Event: {gatewayConnection.lastEvent}
              {gatewayConnection.lastChangedAt
                ? ` · changed ${formatDateTime(gatewayConnection.lastChangedAt)}`
                : ""}
              {gatewayConnection.checkedAt
                ? ` · checked ${formatDateTime(gatewayConnection.checkedAt)}`
                : ""}
              {gatewayConnection.lastError
                ? ` · error ${gatewayConnection.lastError}`
                : ""}
            </p>
          ) : (
            <p>Could not reach gateway status endpoint.</p>
          )}
        </Notice>

        <Notice title="Atomic flow" tone="info">
          Binding follows: create records → provision runtime → health check →
          disclosure message → active state.
        </Notice>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Create WhatsApp group</CardTitle>
              <CardDescription>
                Creates the group in WhatsApp via gateway and returns the new
                group JID.
              </CardDescription>
            </CardHeader>
            <CardContent className="pb-6">
              <form
                action={createWhatsAppGroupAction}
                className="flex flex-col gap-4"
              >
                <FormRow label="Group name" htmlFor="groupName">
                  <Input
                    id="groupName"
                    name="groupName"
                    placeholder="New Support Group"
                    required
                  />
                </FormRow>

                <FormRow
                  label="Participants"
                  htmlFor="participants"
                  hint="Optional, comma-separated international format."
                >
                  <Textarea
                    id="participants"
                    name="participants"
                    rows={3}
                    placeholder="+43664111222, +43664111333"
                  />
                </FormRow>

                <FormActions>
                  <Button
                    type="submit"
                    disabled={!gatewayConnection?.connected}
                  >
                    Create WhatsApp group
                  </Button>
                </FormActions>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Create binding request</CardTitle>
              <CardDescription>
                Pair a known WhatsApp group with a published template version.
              </CardDescription>
            </CardHeader>
            <CardContent className="pb-6">
              <form
                action={createBindingAction}
                className="flex flex-col gap-4"
              >
                <FormRow
                  label="WhatsApp group (name + JID)"
                  htmlFor="providerGroupId"
                >
                  <Select
                    id="providerGroupId"
                    name="providerGroupId"
                    defaultValue={selectedGroupId}
                    required
                  >
                    <option value="" disabled>
                      Select existing WhatsApp group
                    </option>
                    {selectableGroups.map((group) => (
                      <option key={group.jid} value={group.jid}>
                        {group.name} — {group.jid}
                      </option>
                    ))}
                  </Select>
                </FormRow>

                <FormRow label="Template version" htmlFor="templateVersionId">
                  <Select
                    id="templateVersionId"
                    name="templateVersionId"
                    defaultValue={
                      templateOptions[0]?.templateVersionId ?? ""
                    }
                    required
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
                  <Button type="submit">Submit bind request</Button>
                </FormActions>
              </form>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Known WhatsApp groups</CardTitle>
            <CardDescription>
              Groups visible to your role through bindings, prior messages, or
              the gateway directory.
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-6">
            {selectableGroups.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                No WhatsApp groups visible yet.
              </p>
            ) : (
              <ul className="-mx-6 divide-y divide-border">
                {selectableGroups.map((group) => (
                  <li
                    key={group.jid}
                    className="flex flex-wrap items-center justify-between gap-3 px-6 py-3"
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <p className="truncate text-sm font-medium text-foreground">
                        {group.name}
                      </p>
                      <code className="truncate font-mono text-xs text-muted-foreground">
                        {group.jid}
                      </code>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {boundGroupIds.has(group.jid) ? (
                        <Badge variant="success">bound</Badge>
                      ) : null}
                      {group.participantsCount ? (
                        <span>{group.participantsCount} participants</span>
                      ) : null}
                      {group.lastSeenAt ? (
                        <span>
                          last seen {formatDateTime(group.lastSeenAt)}
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
