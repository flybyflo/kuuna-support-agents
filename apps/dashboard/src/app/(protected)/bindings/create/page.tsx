import { AutoRefresh } from "@/components/system/auto-refresh";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
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

function getSingleParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CreateBindingPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireAuthorized("bindings", "write");
  const params = await searchParams;

  const [bindings, templates, knownGroups, gatewayGroups, gatewayConnection] = await Promise.all([
    listBindings(),
    listTemplates(),
    listKnownProviderGroups(),
    listWhatsAppGatewayGroups(),
    getWhatsAppGatewayConnectionStatus(),
  ]);

  const templateOptions = (
    await Promise.all(
      templates.map(async (template) => {
        const versions = await listTemplateVersions(template.id);
        const preferred = versions.find((version) => version.status === "published") ?? versions[0];
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

  const boundGroupIds = new Set(bindings.map((binding) => binding.providerGroupId));

  const selectableGroups = [...mergedGroups.values()]
    .filter((group) => canAccessGroup(session, group.jid))
    .sort((a, b) => a.name.localeCompare(b.name));

  const selectedGroupId =
    getSingleParam(params.providerGroupId) ?? selectableGroups[0]?.jid ?? "";

  const createGroupStatus = getSingleParam(params.createGroup);
  const bindStatus = getSingleParam(params.bind);

  return (
    <div className="grid">
      <AutoRefresh intervalMs={15000} />
      <PageHeader
        title="Bind WhatsApp Group"
        description="Select an existing WhatsApp JID or create a new group, then bind a template version."
      />

      {createGroupStatus === "ok" ? (
        <Notice title="WhatsApp group created" tone="success">
          <p className="muted-text">
            {getSingleParam(params.groupName) ?? "Group"} ·{" "}
            <span className="inline-code">{getSingleParam(params.providerGroupId)}</span>
          </p>
        </Notice>
      ) : null}

      {createGroupStatus === "error" ? (
        <Notice title="Could not create WhatsApp group" tone="warning">
          <p className="muted-text">{getSingleParam(params.reason) ?? "unknown error"}</p>
        </Notice>
      ) : null}

      {bindStatus === "error" ? (
        <Notice title="Binding failed" tone="warning">
          <p className="muted-text">{getSingleParam(params.reason) ?? "unknown error"}</p>
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
          <p className="muted-text">
            Event: {gatewayConnection.lastEvent}
            {gatewayConnection.lastChangedAt ? ` · changed ${formatDateTime(gatewayConnection.lastChangedAt)}` : ""}
            {gatewayConnection.checkedAt ? ` · checked ${formatDateTime(gatewayConnection.checkedAt)}` : ""}
            {gatewayConnection.lastError ? ` · error ${gatewayConnection.lastError}` : ""}
          </p>
        ) : (
          <p className="muted-text">Could not reach gateway status endpoint.</p>
        )}
      </Notice>

      <Notice title="Atomic flow" tone="info">
        Binding operation follows: create records → provision runtime → health check
        → disclosure message → active state.
      </Notice>

      <section className="panel">
        <h2>Create WhatsApp group</h2>
        <p className="muted-text">Creates the group in WhatsApp via gateway and returns the new group JID.</p>
        <form action={createWhatsAppGroupAction} className="form-grid" style={{ marginTop: 12 }}>
          <label>
            Group name
            <input name="groupName" placeholder="New Support Group" required />
          </label>

          <label>
            Participants (optional)
            <textarea
              name="participants"
              rows={3}
              placeholder="+43664111222, +43664111333"
            />
          </label>

          <button type="submit" className="button">
            Create WhatsApp group
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>Create binding request</h2>
        <form action={createBindingAction} className="form-grid">
          <label>
            WhatsApp group (name + JID)
            <select name="providerGroupId" defaultValue={selectedGroupId} required>
              <option value="" disabled>
                Select existing WhatsApp group
              </option>
              {selectableGroups.map((group) => (
                <option key={group.jid} value={group.jid}>
                  {group.name} — {group.jid}
                </option>
              ))}
            </select>
          </label>

          <label>
            Template version
            <select name="templateVersionId" defaultValue={templateOptions[0]?.templateVersionId ?? ""} required>
              {templateOptions.map((template) => (
                <option key={template.templateVersionId} value={template.templateVersionId}>
                  {template.label}
                </option>
              ))}
            </select>
          </label>

          <button type="submit" className="button">
            Submit bind request
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>Known WhatsApp groups</h2>
        <ul className="inline-list">
          {selectableGroups.map((group) => (
            <li key={group.jid}>
              <strong>{group.name}</strong> — <span className="inline-code">{group.jid}</span>
              {boundGroupIds.has(group.jid) ? " · bound" : ""}
              {group.participantsCount ? ` · ${group.participantsCount} participants` : ""}
              {group.lastSeenAt ? ` · last seen ${formatDateTime(group.lastSeenAt)}` : ""}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
