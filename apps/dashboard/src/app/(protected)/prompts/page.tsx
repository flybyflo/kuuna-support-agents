import Link from "next/link";

import { SimpleTable } from "@/components/data-table/simple-table";
import { StatusBadge } from "@/components/status/status-badge";
import { PageHeader } from "@/components/ui/page-header";
import { listPromptAssets } from "@/lib/api-client";
import type { PromptAsset } from "@/lib/api-client/types";
import { formatDateTime } from "@/lib/utils/format";

type InstancePromptRow = {
  instanceId: string;
  instanceName: string;
  systemAsset?: PromptAsset;
  userAsset?: PromptAsset;
  updatedAt: string;
};

type TemplatePromptGroup = {
  templateId: string;
  templateName: string;
  instances: InstancePromptRow[];
};

function renderPromptAsset(asset?: PromptAsset) {
  if (!asset) {
    return <span className="muted-text">-</span>;
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span className="badge">v{asset.versionNo}</span>
        <StatusBadge status={asset.status} />
      </div>
      <span className="muted-text">
        {formatDateTime(asset.updatedAt)} by {asset.updatedBy}
      </span>
    </div>
  );
}

export default async function PromptsPage() {
  const assets = await listPromptAssets();

  const templateGroups = Array.from(
    assets.reduce<Map<string, TemplatePromptGroup>>((templates, asset) => {
      const existingTemplate = templates.get(asset.templateId);
      if (existingTemplate) {
        const existingInstance = existingTemplate.instances.find(
          (instance) => instance.instanceId === asset.instanceId,
        );

        if (existingInstance) {
          if (asset.type === "system") {
            existingInstance.systemAsset = asset;
          } else {
            existingInstance.userAsset = asset;
          }

          if (asset.updatedAt > existingInstance.updatedAt) {
            existingInstance.updatedAt = asset.updatedAt;
          }

          return templates;
        }

        existingTemplate.instances.push({
          instanceId: asset.instanceId,
          instanceName: asset.instanceName,
          systemAsset: asset.type === "system" ? asset : undefined,
          userAsset: asset.type === "user" ? asset : undefined,
          updatedAt: asset.updatedAt,
        });

        return templates;
      }

      templates.set(asset.templateId, {
        templateId: asset.templateId,
        templateName: asset.templateName,
        instances: [
          {
            instanceId: asset.instanceId,
            instanceName: asset.instanceName,
            systemAsset: asset.type === "system" ? asset : undefined,
            userAsset: asset.type === "user" ? asset : undefined,
            updatedAt: asset.updatedAt,
          },
        ],
      });

      return templates;
    }, new Map()).values(),
  )
    .map((group) => ({
      ...group,
      instances: group.instances.sort((left, right) =>
        left.instanceName.localeCompare(right.instanceName),
      ),
    }))
    .sort((left, right) => left.templateName.localeCompare(right.templateName));

  return (
    <div className="grid">
      <PageHeader
        title="Prompt governance"
        description="Review prompt assets grouped by template first, then by instance."
      />

      {templateGroups.length ? (
        templateGroups.map((group) => (
          <section key={group.templateId} className="panel stack">
            <div>
              <h2>{group.templateName}</h2>
              <p className="muted-text">
                {group.instances.length} instance
                {group.instances.length === 1 ? "" : "s"}
              </p>
            </div>

            <div>
              <SimpleTable<InstancePromptRow>
                data={group.instances}
                emptyMessage="No instances bound to this template."
                columns={[
                  {
                    header: "Instance",
                    cell: (row) => (
                      <div>
                        <Link href={`/prompts/${row.instanceId}`} style={{ fontWeight: 600 }}>
                          {row.instanceName}
                        </Link>
                        <p className="muted-text">
                          <span className="inline-code">{row.instanceId}</span>
                        </p>
                      </div>
                    ),
                  },
                  {
                    header: "System prompt",
                    cell: (row) => renderPromptAsset(row.systemAsset),
                  },
                  {
                    header: "User prompt",
                    cell: (row) => renderPromptAsset(row.userAsset),
                  },
                  {
                    header: "Updated",
                    cell: (row) => (
                      <span className="muted-text">{formatDateTime(row.updatedAt)}</span>
                    ),
                  },
                ]}
              />
            </div>
          </section>
        ))
      ) : (
        <section className="panel">
          <p className="muted-text">No prompt assets yet.</p>
        </section>
      )}
    </div>
  );
}
