import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/status/status-badge";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/notice";
import { listPromptAssets } from "@/lib/api-client";

type Params = Promise<{ instanceId: string }>;

export default async function PromptInstancePage({
  params,
}: {
  params: Params;
}) {
  const { instanceId } = await params;
  const assets = await listPromptAssets(instanceId);

  if (!assets.length) {
    notFound();
  }

  return (
    <div className="grid">
      <PageHeader
        title={`Prompt Assets · ${instanceId}`}
        description="Edit draft content. Publish/rollback requires admin or owner role."
      />

      <section className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {assets.map((asset) => (
          <article key={asset.id} className="panel stack">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <h2>{asset.title}</h2>
              <StatusBadge status={asset.status} />
            </div>

            <p className="muted-text">Version: v{asset.versionNo}</p>

            <label className="form-grid" style={{ marginTop: 0 }}>
              <span className="muted-text">Draft content</span>
              <textarea defaultValue={`# ${asset.title}\n\nThis is placeholder content for ${asset.type}.`} />
            </label>

            <div style={{ display: "flex", gap: 8 }}>
              <button className="button" type="button">
                Save draft
              </button>
              <button className="button button-secondary" type="button">
                Publish
              </button>
              <button className="button button-secondary" type="button">
                Rollback
              </button>
            </div>
          </article>
        ))}
      </section>

      <Notice title="Governance" tone="warning">
        Operators can edit drafts, while publish and rollback must be limited to
        Owner/Admin by backend authorization.
      </Notice>
    </div>
  );
}
