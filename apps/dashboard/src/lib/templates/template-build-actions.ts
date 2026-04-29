"use server";

import { redirect } from "next/navigation";

import { requireAuthorized } from "@/lib/auth/guards";
import { createBackendTrpcClient } from "@/lib/backend/client";

function parseCsvTools(raw: string | null): string[] | undefined {
  if (!raw) {
    return undefined;
  }

  const items = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length ? items : undefined;
}

function parseList(raw: string | null): string[] | undefined {
  if (!raw) {
    return undefined;
  }

  const items = raw
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length ? items : undefined;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function queueTemplateBuildAction(formData: FormData): Promise<void> {
  const session = await requireAuthorized("templates", "publish");

  const templateIdRaw = formData.get("templateId");
  const versionIdRaw = formData.get("versionId");
  const baseImageRaw = formData.get("baseImage");
  const allowedToolsRaw = formData.get("allowedTools");
  const dockerfileSnippetRaw = formData.get("dockerfileSnippet");
  const piBashEnabledRaw = formData.get("piBashEnabled");
  const piBashAllowlistRaw = formData.get("piBashAllowlist");

  const templateId = typeof templateIdRaw === "string" ? templateIdRaw.trim() : "";
  const versionId = typeof versionIdRaw === "string" ? versionIdRaw.trim() : "";
  const baseImage = typeof baseImageRaw === "string" ? baseImageRaw.trim() : "";
  const dockerfileSnippet = typeof dockerfileSnippetRaw === "string" ? dockerfileSnippetRaw.trim() : "";
  const piBashEnabled = piBashEnabledRaw === "on";
  const piBashAllowlist = parseList(typeof piBashAllowlistRaw === "string" ? piBashAllowlistRaw : null);

  if (!templateId || !versionId || !baseImage) {
    redirect(
      `/templates/${encodeURIComponent(templateId || "unknown")}?error=${encodeURIComponent("Template-Builds: templateId, versionId und base_image sind erforderlich.")}`,
    );
  }

  if (piBashEnabled && (!piBashAllowlist || piBashAllowlist.length === 0)) {
    redirect(
      `/templates/${encodeURIComponent(templateId)}?error=${encodeURIComponent(
        "Template-Builds: Bash allowlist ist erforderlich, wenn Pi bash exec aktiviert ist.",
      )}`,
    );
  }

  if (!isUuid(session.userId)) {
    redirect(
      `/templates/${encodeURIComponent(templateId)}?error=${encodeURIComponent(
        "Template-Builds: session.userId ist keine UUID (legacy session). Bitte neu einloggen.",
      )}`,
    );
  }

  let build: { id: string; template_version_id: string };
  try {
    const client = createBackendTrpcClient(session.backendAccessToken);
    build = await client.templates.queueBuild.mutate({
      templateId,
      versionId,
      actorUserId: session.userId,
      baseImage,
      allowedTools: parseCsvTools(typeof allowedToolsRaw === "string" ? allowedToolsRaw : null),
      dockerfileSnippet: dockerfileSnippet || null,
      piBashEnabled,
      piBashAllowlist,
    });
  } catch (error) {
    redirect(
      `/templates/${encodeURIComponent(templateId)}?error=${encodeURIComponent(
        `Template-Builds: ${error instanceof Error ? error.message : String(error)}`,
      )}`,
    );
  }
  const params = new URLSearchParams({
    buildQueued: "1",
    buildId: build.id,
    versionId: build.template_version_id,
  });
  redirect(`/templates/${encodeURIComponent(templateId)}?${params.toString()}`);
}
