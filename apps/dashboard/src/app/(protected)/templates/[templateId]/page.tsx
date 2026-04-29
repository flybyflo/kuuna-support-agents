import Link from "next/link";
import { notFound } from "next/navigation";

import { SimpleTable } from "@/components/data-table/simple-table";
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
import { Checkbox } from "@/components/ui/checkbox";
import { FormActions, FormRow } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TemplateBuildAutoRefresh } from "@/components/templates/template-build-auto-refresh";
import { getTemplate, listTemplateBuilds, listTemplateVersions } from "@/lib/api-client";
import type { TemplateBuild } from "@/lib/api-client/types";
import { requireAuthorized } from "@/lib/auth/guards";
import { isAdminRole } from "@/lib/permissions/matrix";
import {
  createTemplateDraftVersionAction,
  publishTemplateVersionAction,
} from "@/lib/templates/actions";
import { PI_OPENAI_MODELS, isPiOpenAiModel } from "@/lib/templates/pi-models";
import { queueTemplateBuildAction } from "@/lib/templates/template-build-actions";
import { formatDateTime } from "@/lib/utils/format";

type Params = Promise<{ templateId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function getSingleParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function defaultModelChain(
  versions: Array<{ modelChain: string[] }>,
): string[] {
  const latestWithChain = versions.find(
    (version) => version.modelChain.length > 0,
  );
  if (!latestWithChain) {
    return ["gpt-5.5"];
  }
  return latestWithChain.modelChain;
}

function csvOrEmpty(values: string[] | undefined): string {
  return values?.length ? values.join(", ") : "";
}

function firstSupportedPiModel(modelChain: string[] | undefined): string | undefined {
  return modelChain?.find((model) => isPiOpenAiModel(model));
}

export default async function TemplateDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const session = await requireAuthorized("templates", "read");
  const canManageTemplateBuilds = isAdminRole(session.role);

  const { templateId } = await params;
  const search = await searchParams;
  const created = getSingleParam(search.created);
  const draftCreated = getSingleParam(search.draft);
  const published = getSingleParam(search.published);
  const versionId = getSingleParam(search.versionId);
  const cloneFromVersionId = getSingleParam(search.cloneFromVersionId);
  const error = getSingleParam(search.error);
  const buildQueued = getSingleParam(search.buildQueued);
  const buildId = getSingleParam(search.buildId);

  const [templateMaybe, versions] = await Promise.all([
    getTemplate(templateId),
    listTemplateVersions(templateId),
  ]);

  if (!templateMaybe) {
    notFound();
  }

  const template = templateMaybe;

  const cloneSource = cloneFromVersionId
    ? versions.find((version) => version.id === cloneFromVersionId)
    : undefined;
  const systemPromptDefault =
    cloneSource?.systemPrompt ??
    [
      "Du bist der Cyberheld WhatsApp-Beweissicherungsassistent in einer betreuten WhatsApp-Gruppe.",
      "Cyberheld ist ein österreichischer Anbieter für Unterstützung bei Hass im Netz, digitaler Gewalt und damit verbundener Beweissicherung.",
      "Du arbeitest für Cyberheld und das autorisierte Betreuungsteam dieser Gruppe.",
      "Du unterstützt Klient:innen, Anwält:innen und berechtigte Mitarbeiter:innen dabei, relevante Informationen zu strukturieren, Beweise nachvollziehbar zu sichern, Fragen zum Ablauf zu beantworten und nächste Schritte vorzubereiten.",
      "Du vertrittst keine Polizei, kein Gericht, keine Behörde und keine gegnerische Partei.",
      "Du gibst keine verbindliche Rechtsberatung und ersetzt keine anwaltliche, medizinische, therapeutische oder behördliche Stelle.",
      "Bei rechtlicher Bewertung, unklaren Sachverhalten, Risikoabwägungen oder sensiblen Entscheidungen erstellst du ein Todo für das zuständige Team oder verweist auf anwaltliche Prüfung.",
      "Du leitest Antworten nur aus den Template-Anweisungen, dem Runtime-Kontext dieser Gruppe, bereitgestelltem Knowledge-/RAG-Kontext, erlaubten Tools, der aktuellen Nutzernachricht und autorisierter Chat-Historie ab.",
      "Wenn eine Information nicht in diesen Quellen enthalten ist, sagst du das transparent oder erstellst ein Todo, statt zu raten.",
      "Antworte auf Deutsch, präzise, freundlich und mit klaren nächsten Schritten.",
    ].join("\n\n");
  const modelChainPrefill =
    firstSupportedPiModel(cloneSource?.modelChain) ??
    firstSupportedPiModel(defaultModelChain(versions)) ??
    "gpt-5.5";
  const allowedToolsPrefill = cloneSource?.allowedTools?.length
    ? csvOrEmpty(cloneSource.allowedTools)
    : "uppercase, knowledge_search, message_history, todo_create, todo_update, todo_list";
  const egressModePrefill = cloneSource?.egressPolicy ?? "restricted";

  const publishedVersionIds = Array.from(
    new Set(
      versions.filter((version) => version.status === "published").map((version) => version.id),
    ),
  );

  const templateBuildsByVersionId: Record<string, TemplateBuild[]> = {};

  if (canManageTemplateBuilds && publishedVersionIds.length > 0) {
    const results = await Promise.all(
      publishedVersionIds.map(async (id) => {
        const items = await listTemplateBuilds(template.id, id);
        return { id, items };
      }),
    );

    for (const entry of results) {
      templateBuildsByVersionId[entry.id] = entry.items;
    }
  }

  const templateBuildRefreshActive = canManageTemplateBuilds
    ? Object.values(templateBuildsByVersionId).some((items) =>
        items.some((build) => build.status === "queued" || build.status === "running"),
      )
    : false;

  return (
    <div className="flex flex-col gap-8">
      {canManageTemplateBuilds ? (
        <TemplateBuildAutoRefresh active={templateBuildRefreshActive} />
      ) : null}

      <PageHeader
        title={template.displayName}
        description={`Template key: ${template.key}`}
        actions={
          <Button variant="outline" asChild>
            <Link href="/inbox/create">
              <span>Go to binding</span>
            </Link>
          </Button>
        }
      />

      {created === "1" ? (
        <Notice title="Template created" tone="success">
          Next step: create a draft version, then publish it before binding
          groups.
        </Notice>
      ) : null}

      {draftCreated === "1" ? (
        <Notice title="Draft version created" tone="success">
          {versionId ? (
            <p>
              Version ID:{" "}
              <code className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                {versionId}
              </code>
            </p>
          ) : null}
          <p>Publish it so staff can bind WhatsApp groups with this template.</p>
        </Notice>
      ) : null}

      {published === "1" ? (
        <Notice title="Template version published" tone="success">
          {versionId ? (
            <p>
              Active version:{" "}
              <code className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                {versionId}
              </code>
            </p>
          ) : null}
          <p>
            Existing active group bindings for this template now use this version.
            New groups can also be bound to it.
          </p>
        </Notice>
      ) : null}

      {buildQueued === "1" ? (
        <Notice title="Template-Build gestartet" tone="success">
          {buildId ? (
            <p>
              Build-ID:{" "}
              <code className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                {buildId}
              </code>
            </p>
          ) : null}
          <p className="mt-1.5 text-sm text-muted-foreground">
            Status aktualisiert sich automatisch alle paar Sekunden, solange der Build läuft.
          </p>
        </Notice>
      ) : null}

      {error ? (
        <Notice title="Template workflow failed" tone="warning">
          {error}
        </Notice>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Configuration summary</CardTitle>
          <CardDescription>{template.description}</CardDescription>
        </CardHeader>
        <CardContent className="pb-6">
          <p className="text-sm text-muted-foreground">
            Published version ID:{" "}
            <code className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
              {template.publishedVersionId || "n/a"}
            </code>
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Flow: create draft → (optionally clone/edit) → publish → bind group.
          </p>
        </CardContent>
      </Card>

      <Card>
        <div id="create-draft" />
        <CardHeader>
          <CardTitle>Create draft version</CardTitle>
          <CardDescription>
            Start from defaults or clone an existing version using the timeline actions below.
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-6">
          <form
            action={createTemplateDraftVersionAction}
            className="flex flex-col gap-4"
          >
            <input type="hidden" name="templateId" value={template.id} />

            <FormRow
              label="System prompt"
              htmlFor="systemPrompt"
              hint="Defines this template's role, target audience, tone and task. Platform isolation rules are appended by the runtime."
            >
              <Textarea
                id="systemPrompt"
                name="systemPrompt"
                defaultValue={systemPromptDefault}
                rows={12}
              />
            </FormRow>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormRow
                label="Model"
                htmlFor="modelChain"
                hint="Pi OpenAI model used by this template."
              >
                <Select
                  id="modelChain"
                  name="modelChain"
                  defaultValue={modelChainPrefill}
                >
                  {PI_OPENAI_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name} - {model.id}
                    </option>
                  ))}
                </Select>
              </FormRow>

              <FormRow
                label="Allowed tools"
                htmlFor="allowedTools"
                hint="Comma-separated tool keys."
              >
                <Input
                  id="allowedTools"
                  name="allowedTools"
                  defaultValue={allowedToolsPrefill}
                  placeholder="uppercase, knowledge_search, message_history, todo_create"
                />
              </FormRow>
            </div>

            <FormRow label="Egress mode" htmlFor="egressMode">
              <Select
                id="egressMode"
                name="egressMode"
                defaultValue={egressModePrefill}
              >
                <option value="restricted">restricted</option>
                <option value="strict">strict</option>
                <option value="allow-all">allow-all</option>
              </Select>
            </FormRow>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormRow
                label="Company knowledge doc keys"
                htmlFor="commonKnowledgeDocKeys"
                hint="Comma-separated doc_key values. Use * for all, none for no company docs."
              >
                <Input
                  id="commonKnowledgeDocKeys"
                  name="commonKnowledgeDocKeys"
                  defaultValue="*"
                  placeholder="*, financing-policy, intake-rules"
                />
              </FormRow>

              <FormRow
                label="Group knowledge doc keys"
                htmlFor="groupKnowledgeDocKeys"
                hint="Applied to the bound WhatsApp group. Use * for all, none for no group docs."
              >
                <Input
                  id="groupKnowledgeDocKeys"
                  name="groupKnowledgeDocKeys"
                  defaultValue="*"
                  placeholder="*, bookkeeping, customer-rules"
                />
              </FormRow>
            </div>

            <label className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox
                name="includeGroupKnowledge"
                defaultChecked
                aria-label="Include current group knowledge"
              />
              <span>Include current WhatsApp-group knowledge</span>
            </label>

            <FormActions>
              <Button type="submit">Create draft</Button>
            </FormActions>
          </form>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <div id="timeline" />
        <CardHeader>
          <CardTitle>Version timeline</CardTitle>
          <CardDescription>
            All template versions with their model and egress configuration.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 pt-4">
          <SimpleTable
            data={versions}
            emptyMessage="No versions yet."
            columns={[
              {
                header: "Version",
                cell: (version) => (
                  <Badge variant="outline">v{version.versionNo}</Badge>
                ),
              },
              {
                header: "Status",
                cell: (version) => <StatusBadge status={version.status} />,
              },
              {
                header: "Model failover",
                cell: (version) =>
                  version.modelChain.length ? (
                    <span className="font-mono text-xs text-foreground">
                      {version.modelChain.join(" → ")}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">n/a</span>
                  ),
              },
              {
                header: "Reasoning",
                cell: (version) => (
                  <span className="font-mono text-xs text-foreground">
                    {version.reasoningEffort}
                  </span>
                ),
              },
              {
                header: "Tool profile",
                cell: (version) => (
                  <span className="text-sm text-foreground">
                    {version.toolProfile || "default"}
                  </span>
                ),
              },
              {
                header: "Knowledge",
                cell: (version) => (
                  <span className="text-sm text-foreground">
                    {version.knowledgeProfile || "common: *, group: *"}
                  </span>
                ),
              },
              {
                header: "Egress",
                cell: (version) => (
                  <span className="text-sm text-foreground">
                    {version.egressPolicy || "default"}
                  </span>
                ),
              },
              {
                header: "Updated",
                cell: (version) => (
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(version.updatedAt)} by {version.updatedBy}
                  </span>
                ),
              },
              {
                header: "Actions",
                cell: (version) => {
                  const cloneHref = `/templates/${encodeURIComponent(template.id)}?cloneFromVersionId=${encodeURIComponent(version.id)}#create-draft`;

                  if (
                    version.status !== "draft" &&
                    version.status !== "ready"
                  ) {
                    return (
                      <Button type="button" variant="outline" size="sm" asChild>
                        <Link href={cloneHref}>Clone</Link>
                      </Button>
                    );
                  }

                  return (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="button" variant="outline" size="sm" asChild>
                        <Link href={cloneHref}>Clone</Link>
                      </Button>
                      <form action={publishTemplateVersionAction}>
                        <input
                          type="hidden"
                          name="templateId"
                          value={template.id}
                        />
                        <input type="hidden" name="versionId" value={version.id} />
                        <Button type="submit" variant="outline" size="sm">
                          Publish
                        </Button>
                      </form>
                    </div>
                  );
                },
              },
            ]}
          />
        </CardContent>
      </Card>

      {canManageTemplateBuilds ? (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Pi runtime images (published)</CardTitle>
            <CardDescription>
              Docker builds for the TypeScript Pi runtime per published template version. Builds run
              asynchronously in the worker and are stored as <span className="font-mono">image_ref</span> in{" "}
              <span className="font-mono">template_builds</span>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pb-6">
            {publishedVersionIds.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No published version yet. Publish first, then build a Pi runtime image.
              </p>
            ) : (
              publishedVersionIds.map((publishedVersionId) => {
                const publishedVersion = versions.find((v) => v.id === publishedVersionId);
                const builds = templateBuildsByVersionId[publishedVersionId] ?? [];

                return (
                  <div key={publishedVersionId} className="space-y-3">
                    <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          Version{" "}
                          <span className="font-mono text-xs">
                            v{publishedVersion?.versionNo ?? "?"}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Version-ID:{" "}
                          <code className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                            {publishedVersionId}
                          </code>
                        </p>
                      </div>

                      <form action={queueTemplateBuildAction} className="w-full md:max-w-3xl">
                        <input type="hidden" name="templateId" value={template.id} />
                        <input type="hidden" name="versionId" value={publishedVersionId} />

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <FormRow label="Node base image" htmlFor={`baseImage-${publishedVersionId}`}>
                            <Input
                              id={`baseImage-${publishedVersionId}`}
                              name="baseImage"
                              placeholder="node:22-bookworm"
                              required
                            />
                          </FormRow>

                          <FormRow
                            label="Allowed tools (optional)"
                            htmlFor={`allowedTools-${publishedVersionId}`}
                            hint="Comma-separated. Empty uses the template default."
                          >
                            <Input
                              id={`allowedTools-${publishedVersionId}`}
                              name="allowedTools"
                              placeholder="echo, uppercase"
                            />
                          </FormRow>

                          <FormRow
                            label="Dockerfile snippet"
                            htmlFor={`dockerfileSnippet-${publishedVersionId}`}
                            hint="Inserted after pnpm setup. Use it for RUN/ENV/package installs."
                            className="md:col-span-2"
                          >
                            <Textarea
                              id={`dockerfileSnippet-${publishedVersionId}`}
                              name="dockerfileSnippet"
                              placeholder={"RUN apt-get update && apt-get install -y --no-install-recommends jq && rm -rf /var/lib/apt/lists/*"}
                              rows={4}
                            />
                          </FormRow>

                          <div className="flex items-start gap-2 pt-6">
                            <Checkbox id={`piBashEnabled-${publishedVersionId}`} name="piBashEnabled" />
                            <div className="space-y-1">
                              <label
                                htmlFor={`piBashEnabled-${publishedVersionId}`}
                                className="text-sm font-medium text-foreground"
                              >
                                Enable Pi bash exec
                              </label>
                              <p className="text-xs text-muted-foreground">
                                Allows the agent to run matching commands inside this runtime image.
                              </p>
                            </div>
                          </div>

                          <FormRow
                            label="Bash allowlist"
                            htmlFor={`piBashAllowlist-${publishedVersionId}`}
                            hint="Comma- or newline-separated command prefixes, for example jq, python, ffmpeg -i."
                          >
                            <Textarea
                              id={`piBashAllowlist-${publishedVersionId}`}
                              name="piBashAllowlist"
                              placeholder={"jq\npython\nffmpeg -i"}
                              rows={4}
                            />
                          </FormRow>

                          <FormActions className="md:col-span-2 md:justify-end">
                            <Button type="submit" variant="outline">
                              Start build
                            </Button>
                          </FormActions>
                        </div>
                      </form>
                    </div>

                    <SimpleTable
                      data={builds}
                      emptyMessage="Noch keine Builds für diese Version."
                      columns={[
                        {
                          header: "Build",
                          cell: (build) => (
                            <code className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                              {build.id}
                            </code>
                          ),
                        },
                        {
                          header: "Status",
                          cell: (build) => <StatusBadge status={build.status} />,
                        },
                        {
                          header: "Image",
                          cell: (build) => (
                            <div className="space-y-1">
                              {build.imageRef ? (
                                <p className="font-mono text-[11px] text-foreground">{build.imageRef}</p>
                              ) : (
                                <p className="text-xs text-muted-foreground">n/a</p>
                              )}
                              {build.imageTag ? (
                                <p className="font-mono text-[11px] text-muted-foreground">{build.imageTag}</p>
                              ) : null}
                            </div>
                          ),
                        },
                        {
                          header: "Logs",
                          cell: (build) =>
                            build.logsRef ? (
                              <span className="font-mono text-[11px] text-foreground">{build.logsRef}</span>
                            ) : (
                              <span className="text-xs text-muted-foreground">n/a</span>
                            ),
                        },
                        {
                          header: "Updated",
                          cell: (build) => (
                            <span className="text-xs text-muted-foreground">{formatDateTime(build.updatedAt)}</span>
                          ),
                        },
                      ]}
                    />
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
