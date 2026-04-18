import Link from "next/link";
import { notFound } from "next/navigation";
import { SimpleTable } from "@/components/data-table/simple-table";
import { StatusBadge } from "@/components/status/status-badge";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { getTemplate, listTemplateVersions } from "@/lib/api-client";
import {
  createTemplateDraftVersionAction,
  publishTemplateVersionAction,
} from "@/lib/templates/actions";
import { formatDateTime } from "@/lib/utils/format";

type Params = Promise<{ templateId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function getSingleParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function defaultModelChain(versions: Array<{ modelChain: string[] }>): string {
  const latestWithChain = versions.find((version) => version.modelChain.length > 0);
  if (!latestWithChain) {
    return "gpt-4.1-mini";
  }
  return latestWithChain.modelChain.join(", ");
}

export default async function TemplateDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { templateId } = await params;
  const search = await searchParams;
  const created = getSingleParam(search.created);
  const draftCreated = getSingleParam(search.draft);
  const published = getSingleParam(search.published);
  const versionId = getSingleParam(search.versionId);
  const error = getSingleParam(search.error);

  const [template, versions] = await Promise.all([
    getTemplate(templateId),
    listTemplateVersions(templateId),
  ]);

  if (!template) {
    notFound();
  }

  const modelChainDefault = defaultModelChain(versions);

  return (
    <div className="grid">
      <PageHeader
        title={template.displayName}
        description={`Template key: ${template.key}`}
        actions={
          <Link href="/bindings/create" className="button button-secondary">
            Go to binding
          </Link>
        }
      />

      {created === "1" ? (
        <Notice title="Template created" tone="success">
          Next step: create a draft version, then publish it before binding groups.
        </Notice>
      ) : null}

      {draftCreated === "1" ? (
        <Notice title="Draft version created" tone="success">
          {versionId ? (
            <p className="muted-text">
              Version ID: <span className="inline-code">{versionId}</span>
            </p>
          ) : null}
          <p className="muted-text">Publish it so staff can bind WhatsApp groups with this template.</p>
        </Notice>
      ) : null}

      {published === "1" ? (
        <Notice title="Template version published" tone="success">
          {versionId ? (
            <p className="muted-text">
              Active version: <span className="inline-code">{versionId}</span>
            </p>
          ) : null}
          <p className="muted-text">You can now bind a group using this version.</p>
        </Notice>
      ) : null}

      {error ? (
        <Notice title="Template workflow failed" tone="warning">
          <p className="muted-text">{error}</p>
        </Notice>
      ) : null}

      <section className="panel stack">
        <h2>Configuration summary</h2>
        <p className="muted-text">{template.description}</p>
        <p className="muted-text">
          Published version ID: <span className="inline-code">{template.publishedVersionId || "n/a"}</span>
        </p>
      </section>

      <section className="panel">
        <h2>Create draft version</h2>
        <p className="muted-text">
          Staff-ready defaults are prefilled. You can publish the draft directly from the timeline below.
        </p>

        <form action={createTemplateDraftVersionAction} className="form-grid" style={{ marginTop: 12 }}>
          <input type="hidden" name="templateId" value={template.id} />

          <label>
            System prompt
            <textarea
              name="systemPrompt"
              defaultValue="You are a concise WhatsApp support assistant. Reply in clear German and provide concrete next steps."
              rows={6}
            />
          </label>

          <label>
            Model chain (comma-separated)
            <input name="modelChain" defaultValue={modelChainDefault} placeholder="gpt-4.1-mini, gpt-4.1" />
          </label>

          <label>
            Allowed tools (comma-separated)
            <input name="allowedTools" defaultValue="echo, uppercase" placeholder="echo, uppercase" />
          </label>

          <label>
            Egress mode
            <select name="egressMode" defaultValue="restricted">
              <option value="restricted">restricted</option>
              <option value="strict">strict</option>
              <option value="allow-all">allow-all</option>
            </select>
          </label>

          <button type="submit" className="button">
            Create draft
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>Version timeline</h2>
        <SimpleTable
          data={versions}
          columns={[
            {
              header: "Version",
              cell: (version) => <span className="badge">v{version.versionNo}</span>,
            },
            {
              header: "Status",
              cell: (version) => <StatusBadge status={version.status} />,
            },
            {
              header: "Model failover",
              cell: (version) =>
                version.modelChain.length ? version.modelChain.join(" → ") : <span className="muted-text">n/a</span>,
            },
            {
              header: "Tool profile",
              cell: (version) => version.toolProfile || "default",
            },
            {
              header: "Egress",
              cell: (version) => version.egressPolicy || "default",
            },
            {
              header: "Updated",
              cell: (version) => (
                <span className="muted-text">
                  {formatDateTime(version.updatedAt)} by {version.updatedBy}
                </span>
              ),
            },
            {
              header: "Actions",
              cell: (version) => {
                if (version.status !== "draft" && version.status !== "ready") {
                  return <span className="muted-text">—</span>;
                }

                return (
                  <form action={publishTemplateVersionAction}>
                    <input type="hidden" name="templateId" value={template.id} />
                    <input type="hidden" name="versionId" value={version.id} />
                    <button type="submit" className="button button-secondary">
                      Publish
                    </button>
                  </form>
                );
              },
            },
          ]}
        />
      </section>
    </div>
  );
}
