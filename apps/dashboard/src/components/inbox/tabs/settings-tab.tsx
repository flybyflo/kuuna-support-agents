import { RefreshCw, Save, Star, Unlink2 } from "lucide-react";

import { StatusBadge } from "@/components/status/status-badge";
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
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getBinding,
  listGroupMembers,
  listTemplates,
  listTemplateVersions,
} from "@/lib/api-client";
import type { WhatsAppGroupMember } from "@/lib/api-client/types";
import {
  createBindingAction,
  unbindBindingAction,
} from "@/lib/bindings/actions";
import {
  setPrimaryClientAction,
  syncGroupMembersAction,
  upsertGroupMemberAction,
} from "@/lib/group-members/actions";
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

function roleLabel(role: WhatsAppGroupMember["role"]): string {
  if (role === "company_staff") return "Company staff";
  if (role === "lawyer") return "Lawyer";
  if (role === "client") return "Client";
  if (role === "bot") return "Bot";
  return "Unassigned";
}

function setupBadge(member: WhatsAppGroupMember) {
  if (member.isPrimaryClient) {
    return <Badge variant="success">Primary client</Badge>;
  }
  if (member.setupStatus === "configured") {
    return <Badge variant="secondary">Configured</Badge>;
  }
  if (member.setupStatus === "missing_profile") {
    return <Badge variant="warning">Missing profile</Badge>;
  }
  return <Badge variant="warning">Missing role</Badge>;
}

function WhatsAppMembersSection({
  providerGroupId,
  members,
  privateRetrievalComplete,
  privateRetrievalReason,
  canManage,
}: {
  providerGroupId: string;
  members: WhatsAppGroupMember[];
  privateRetrievalComplete: boolean;
  privateRetrievalReason: string | null;
  canManage: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle>WhatsApp members</CardTitle>
          <CardDescription>
            WhatsApp JID stays the stable key. Phone is shown from the JID or a manual override.
          </CardDescription>
        </div>
        <form action={syncGroupMembersAction}>
          <input type="hidden" name="providerGroupId" value={providerGroupId} />
          <Button type="submit" variant="outline" size="sm" disabled={!canManage}>
            <RefreshCw aria-hidden />
            <span>Sync participants</span>
          </Button>
        </form>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pb-6">
        {privateRetrievalComplete ? (
          <Notice title="Private retrieval enabled" tone="success">
            Group and personal Knowledge can be retrieved for authorized participants in this group.
          </Notice>
        ) : (
          <Notice title="Private retrieval disabled" tone="warning">
            Configure every member role and set exactly one primary client before private Knowledge is used.
            {privateRetrievalReason ? ` Reason: ${privateRetrievalReason}.` : ""}
          </Notice>
        )}

        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No participants are saved yet. Sync participants from the gateway or wait until messages are observed.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Identity</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Profile</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[260px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.providerUserId}>
                  <TableCell className="min-w-[220px]">
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-foreground">
                        {member.displayName || member.pushName || member.providerUserId}
                      </span>
                      <code className="break-all rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                        {member.providerUserId}
                      </code>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span className="text-sm text-foreground">{member.phoneDisplay || "-"}</span>
                      {member.phoneOverride ? (
                        <span className="text-xs text-muted-foreground">Override</span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>{roleLabel(member.role)}</TableCell>
                  <TableCell>
                    {member.linkedClientProfile ? (
                      <div className="flex flex-col gap-1">
                        <span className="text-sm text-foreground">
                          {member.linkedClientProfile.displayName}
                        </span>
                        <code className="font-mono text-xs text-muted-foreground">
                          {member.linkedClientProfile.id}
                        </code>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>{setupBadge(member)}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-2">
                      <form action={upsertGroupMemberAction} className="grid grid-cols-2 gap-2">
                        <input type="hidden" name="providerGroupId" value={providerGroupId} />
                        <input type="hidden" name="providerUserId" value={member.providerUserId} />
                        <Input
                          name="displayName"
                          defaultValue={member.displayName ?? ""}
                          placeholder="Display name"
                          disabled={!canManage}
                          aria-label="Display name"
                        />
                        <Input
                          name="phoneOverride"
                          defaultValue={member.phoneOverride ?? ""}
                          placeholder="Phone override"
                          disabled={!canManage}
                          aria-label="Phone override"
                        />
                        <Select
                          name="role"
                          defaultValue={member.role ?? ""}
                          disabled={!canManage}
                          aria-label="Role"
                        >
                          <option value="">Unassigned</option>
                          <option value="client">Client</option>
                          <option value="lawyer">Lawyer</option>
                          <option value="company_staff">Company staff</option>
                          <option value="bot">Bot</option>
                        </Select>
                        <Input
                          name="clientProfileId"
                          defaultValue={member.linkedClientProfile?.id ?? ""}
                          placeholder="Client profile ID"
                          disabled={!canManage || member.role !== "client"}
                          aria-label="Client profile ID"
                        />
                        <Button
                          type="submit"
                          variant="outline"
                          size="sm"
                          disabled={!canManage}
                          className="col-span-2"
                        >
                          <Save aria-hidden />
                          <span>Save member</span>
                        </Button>
                      </form>
                      {member.role === "client" && member.linkedClientProfile ? (
                        <form action={setPrimaryClientAction}>
                          <input type="hidden" name="providerGroupId" value={providerGroupId} />
                          <input type="hidden" name="providerUserId" value={member.providerUserId} />
                          <Button
                            type="submit"
                            variant={member.isPrimaryClient ? "secondary" : "default"}
                            size="sm"
                            disabled={!canManage || member.isPrimaryClient}
                            className="w-full"
                          >
                            <Star aria-hidden />
                            <span>{member.isPrimaryClient ? "Primary client" : "Set primary client"}</span>
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {!canManage ? (
          <p className="text-xs text-muted-foreground">
            Your role can view WhatsApp member roles but cannot change retrieval access.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
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
  const membersStatus = getSingleParam(searchParams.members);
  const reason = getSingleParam(searchParams.reason);

  if (bindingId) {
    const [binding, memberConfig] = await Promise.all([
      getBinding(bindingId),
      listGroupMembers(providerGroupId),
    ]);

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

        {membersStatus === "synced" ? (
          <Notice title="Participants synced" tone="success">
            WhatsApp participants were imported from the gateway.
          </Notice>
        ) : null}

        {membersStatus === "saved" || membersStatus === "primary-set" ? (
          <Notice title="Member settings saved" tone="success">
            WhatsApp member configuration was updated.
          </Notice>
        ) : null}

        {membersStatus === "error" ? (
          <Notice title="Member update failed" tone="warning">
            {reason ?? "The member configuration could not be updated."}
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
                {binding?.runtimeMode ?? "-"}
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
                {binding ? formatDateTime(binding.updatedAt) : "-"}
              </span>
            </div>
          </CardContent>
        </Card>

        <WhatsAppMembersSection
          providerGroupId={providerGroupId}
          members={memberConfig.items}
          privateRetrievalComplete={memberConfig.privateRetrievalStatus.complete}
          privateRetrievalReason={memberConfig.privateRetrievalStatus.reason ?? null}
          canManage={canWriteBindings}
        />

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
      {unbound === "1" ? (
        <Notice title="Group unbound" tone="success">
          The group is no longer routed to an agent. History remains available.
        </Notice>
      ) : null}

      {unbindError === "error" ? (
        <Notice title="Unbind failed" tone="warning">
          {reason ?? "The binding could not be deactivated."}
        </Notice>
      ) : null}

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
            Routing follows: create records - provision runtime - health check
            - disclosure message - active state.
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
