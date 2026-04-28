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

  const templateId = typeof templateIdRaw === "string" ? templateIdRaw.trim() : "";
  const versionId = typeof versionIdRaw === "string" ? versionIdRaw.trim() : "";
  const baseImage = typeof baseImageRaw === "string" ? baseImageRaw.trim() : "";

  if (!templateId || !versionId || !baseImage) {
    redirect(
      `/templates/${encodeURIComponent(templateId || "unknown")}?error=${encodeURIComponent("Template-Builds: templateId, versionId und base_image sind erforderlich.")}`,
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
