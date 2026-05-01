import { mkdir, readFile } from "node:fs/promises";
import { platform } from "node:os";
import path from "node:path";

import type { BuildConfig } from "@earendil-works/gondolin";
import { and, desc, eq } from "drizzle-orm";

import { getSettings } from "../config.js";
import type { Database, DbLike } from "../db/client.js";
import { auditEvents, groupTemplates, templateBuilds, templateVersions } from "../db/schema.js";
import { logger } from "../logging.js";
import { publishRuntimeEvent } from "../runtime/events.js";
import { enqueueKuunaJob, type EnqueueKuunaJob } from "./queues.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const baseImagePattern = /^[a-zA-Z0-9._/:@-]+$/;
const tagSafePattern = /[^a-zA-Z0-9._-]+/g;
const setupScriptMaxLength = 8000;
const blockedSetupInstructions = new Set(["from", "cmd", "entrypoint", "expose"]);
const disabledToolKeys = new Set(["context_lookup", "send_whatsapp"]);
const runtimeWorkspaceDest = "/workspace";

export type TemplateBuildRow = typeof templateBuilds.$inferSelect;

export type GondolinBuildResult = {
  assetRef: string;
  assetLabel: string;
  logs: string;
};

export type GondolinAssetBuilder = (input: {
  buildId: string;
  templateKey: string;
  templateVersionId: string;
  baseImage: string;
  setupScript: string;
}) => Promise<GondolinBuildResult>;

export class TemplateBuildValidationError extends Error {}
export class TemplateBuildNotFoundError extends Error {}

export type QueueTemplateBuildInput = {
  actorUserId: string;
  templateId: string;
  versionId: string;
  baseImage: string;
  allowedTools?: string[] | null;
  dockerfileSnippet?: string | null;
  piBashEnabled?: boolean | null;
  piBashAllowlist?: string[] | null;
};

export async function queueTemplateBuild(
  database: Database,
  input: QueueTemplateBuildInput,
  options: { enqueueJob?: EnqueueKuunaJob } = {},
): Promise<TemplateBuildRow> {
  const [template] = await database
    .select()
    .from(groupTemplates)
    .where(eq(groupTemplates.id, input.templateId))
    .limit(1);
  if (!template) {
    throw new TemplateBuildValidationError("template not found");
  }

  const [version] = await database
    .select()
    .from(templateVersions)
    .where(and(eq(templateVersions.id, input.versionId), eq(templateVersions.templateId, input.templateId)))
    .limit(1);
  if (!version) {
    throw new TemplateBuildValidationError("template version not found");
  }
  if (version.status !== "published") {
    throw new TemplateBuildValidationError("only published template versions can be built");
  }

  const runtimeImageConfig = extractRuntimeImageConfig(version.toolsConfig);
  const baseImage = validateBaseImage(input.baseImage);
  const allowedTools = input.allowedTools
    ? normalizeAllowedTools(input.allowedTools)
    : extractAllowedTools(version.toolsConfig);
  const setupScript = validateSetupScript(
    input.dockerfileSnippet !== undefined
      ? input.dockerfileSnippet
      : runtimeImageConfig.setupScript,
  );
  const piBashEnabled = input.piBashEnabled ?? runtimeImageConfig.piBashEnabled;
  const piBashAllowlist = normalizeStringList(input.piBashAllowlist ?? runtimeImageConfig.piBashAllowlist);
  if (piBashEnabled && piBashAllowlist.length === 0) {
    throw new TemplateBuildValidationError("pi_bash_allowlist is required when Pi bash exec is enabled");
  }

  const buildInputs = {
    base_image: baseImage,
    allowed_tools: allowedTools,
    setup_script: setupScript || null,
    pi_bash_enabled: piBashEnabled,
    pi_bash_allowlist: piBashAllowlist,
    egress_policy: version.egressPolicy,
    tools_config: version.toolsConfig,
    model_config: version.modelConfig,
  };

  const [build] = await database.transaction(async (tx) => {
    const [created] = await tx
      .insert(templateBuilds)
      .values({
        templateId: input.templateId,
        templateVersionId: input.versionId,
        status: "queued",
        buildInputs,
      })
      .returning();
    if (!created) {
      throw new Error("template build creation failed");
    }

    await tx.insert(auditEvents).values({
      actorUserId: input.actorUserId,
      eventType: "template_build.queued",
      entityType: "template_build",
      entityId: created.id,
      payload: {
        template_id: input.templateId,
        template_version_id: input.versionId,
      },
    });

    return [created];
  });

  const enqueueJob = options.enqueueJob ?? enqueueKuunaJob;
  await enqueueJob("template_build", { build_id: build.id }, `template_build_${jobToken(build.id)}`);
  await publishRuntimeEvent({
    type: "template_build.updated",
    entityId: build.id,
    entityType: "template_build",
    payload: {
      status: "queued",
      template_id: build.templateId,
      template_version_id: build.templateVersionId,
    },
  });
  return build;
}

export async function listTemplateBuildsForVersion(
  database: DbLike,
  input: { templateId: string; versionId: string },
): Promise<TemplateBuildRow[]> {
  const [version] = await database
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .where(and(eq(templateVersions.id, input.versionId), eq(templateVersions.templateId, input.templateId)))
    .limit(1);
  if (!version) {
    throw new TemplateBuildValidationError("template version not found");
  }

  return database
    .select()
    .from(templateBuilds)
    .where(eq(templateBuilds.templateVersionId, input.versionId))
    .orderBy(desc(templateBuilds.createdAt), desc(templateBuilds.id));
}

export async function getTemplateBuild(database: DbLike, buildId: string): Promise<TemplateBuildRow> {
  const [build] = await database
    .select()
    .from(templateBuilds)
    .where(eq(templateBuilds.id, buildId))
    .limit(1);
  if (!build) {
    throw new TemplateBuildNotFoundError("template build not found");
  }
  return build;
}

export async function processTemplateBuildJob(
  database: DbLike,
  input: { buildId: string },
  options: { gondolinBuilder?: GondolinAssetBuilder } = {},
): Promise<{ processed: boolean; status: "succeeded" | "failed" | "invalid" | "not_found" }> {
  if (!uuidPattern.test(input.buildId)) {
    logger.error("template_build_invalid_build_id", { build_id: input.buildId });
    return { processed: false, status: "invalid" };
  }

  const [build] = await database
    .select()
    .from(templateBuilds)
    .where(eq(templateBuilds.id, input.buildId))
    .limit(1);
  if (!build) {
    logger.error("template_build_not_found", { build_id: input.buildId });
    return { processed: false, status: "not_found" };
  }

  const [template] = await database
    .select()
    .from(groupTemplates)
    .where(eq(groupTemplates.id, build.templateId))
    .limit(1);
  const [version] = await database
    .select()
    .from(templateVersions)
    .where(eq(templateVersions.id, build.templateVersionId))
    .limit(1);
  if (!template || !version) {
    await markFailed(database, build, "missing template/version rows");
    return { processed: true, status: "failed" };
  }

  await database
    .update(templateBuilds)
    .set({ status: "running", updatedAt: new Date() })
    .where(eq(templateBuilds.id, build.id));
  await publishRuntimeEvent({
    type: "template_build.updated",
    entityId: build.id,
    entityType: "template_build",
    payload: {
      status: "running",
      template_id: build.templateId,
      template_version_id: build.templateVersionId,
    },
  });

  const buildInputs = objectRecord(build.buildInputs);
  const baseImage = typeof buildInputs.base_image === "string" ? buildInputs.base_image.trim() : "";
  if (!baseImage) {
    await markFailed(database, build, "missing base_image in build_inputs");
    return { processed: true, status: "failed" };
  }
  const snippetResult = validateSetupScriptForJob(buildInputs.setup_script ?? buildInputs.dockerfile_snippet);
  if (!snippetResult.ok) {
    await markFailed(database, build, snippetResult.error);
    return { processed: true, status: "failed" };
  }

  const builder = options.gondolinBuilder ?? buildGondolinRuntimeAssets;
  let result: GondolinBuildResult;
  try {
    result = await builder({
      buildId: build.id,
      templateKey: template.key,
      templateVersionId: version.id,
      baseImage,
      setupScript: snippetResult.snippet,
    });
  } catch (error) {
    const message = errorMessage(error);
    const logs = JSON.stringify({
      command: ["gondolin", "build"],
      returncode: null,
      stdout_tail: "",
      stderr_tail: tail(message, 4000),
    });
    await database
      .update(templateBuilds)
      .set({ logsRef: logs, updatedAt: new Date() })
      .where(eq(templateBuilds.id, build.id));
    await markFailed(database, build, `Gondolin asset build failed: ${message}`);
    return { processed: true, status: "failed" };
  }
  const logs = JSON.stringify({
    command: ["gondolin", "build"],
    returncode: 0,
    stdout_tail: tail(result.logs, 4000),
    stderr_tail: "",
  });

  await database
    .update(templateBuilds)
    .set({
      status: "succeeded",
      imageRef: result.assetRef.slice(0, 512),
      imageTag: result.assetLabel.slice(0, 255),
      logsRef: logs,
      updatedAt: new Date(),
    })
    .where(eq(templateBuilds.id, build.id));

  await database.insert(auditEvents).values({
    actorUserId: null,
    eventType: "template_build.succeeded",
    entityType: "template_build",
    entityId: build.id,
    payload: {
      template_id: template.id,
      template_version_id: version.id,
      image_ref: result.assetRef.slice(0, 512),
    },
  });
  await publishRuntimeEvent({
    type: "template_build.updated",
    entityId: build.id,
    entityType: "template_build",
    payload: {
      status: "succeeded",
      template_id: template.id,
      template_version_id: version.id,
      image_ref: result.assetRef.slice(0, 512),
    },
  });

  return { processed: true, status: "succeeded" };
}

export function formatTemplateBuild(build: TemplateBuildRow) {
  return {
    id: build.id,
    template_id: build.templateId,
    template_version_id: build.templateVersionId,
    status: build.status,
    image_ref: build.imageRef,
    image_tag: build.imageTag,
    build_inputs: build.buildInputs,
    logs_ref: build.logsRef,
    created_at: build.createdAt.toISOString(),
    updated_at: build.updatedAt.toISOString(),
  };
}

function validateBaseImage(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new TemplateBuildValidationError("base_image is required");
  }
  if (normalized.length > 255) {
    throw new TemplateBuildValidationError("base_image is too long");
  }
  if (!baseImagePattern.test(normalized)) {
    throw new TemplateBuildValidationError("base_image contains invalid characters");
  }
  return normalized;
}

function normalizeStringList(values: string[]): string[] {
  const normalized: string[] = [];
  for (const item of values) {
    const value = item.trim().toLowerCase();
    if (value && !normalized.includes(value)) {
      normalized.push(value);
    }
  }
  return normalized;
}

function validateSetupScript(value: string | null): string {
  const normalized = (value ?? "").trim();
  if (!normalized) {
    return "";
  }
  const invalid = setupScriptValidationError(normalized);
  if (invalid) {
    throw new TemplateBuildValidationError(invalid);
  }
  return normalized;
}

function validateSetupScriptForJob(value: unknown): { ok: true; snippet: string } | { ok: false; error: string } {
  if (value === null || value === undefined) {
    return { ok: true, snippet: "" };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "setup_script must be a string" };
  }
  const snippet = value.trim();
  if (!snippet) {
    return { ok: true, snippet: "" };
  }
  const invalid = setupScriptValidationError(snippet);
  return invalid ? { ok: false, error: invalid } : { ok: true, snippet };
}

function setupScriptValidationError(snippet: string): string | null {
  if (snippet.length > setupScriptMaxLength) {
    return `setup_script is too long (max ${setupScriptMaxLength} chars)`;
  }
  for (const line of snippet.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const instruction = trimmed.split(/\s+/, 1)[0]?.toLowerCase();
    if (instruction && blockedSetupInstructions.has(instruction)) {
      return `setup_script cannot contain Docker ${instruction.toUpperCase()} instructions`;
    }
  }
  return null;
}

function extractAllowedTools(toolsConfig: unknown): string[] {
  if (!toolsConfig || typeof toolsConfig !== "object" || Array.isArray(toolsConfig)) {
    return [];
  }
  const config = toolsConfig as Record<string, unknown>;
  const candidates: string[] = [];
  for (const key of ["allowed_tools", "allowedTools"]) {
    const raw = config[key];
    if (Array.isArray(raw)) {
      candidates.push(...raw.filter((item): item is string => typeof item === "string"));
    }
  }
  const rawTools = config.tools;
  if (Array.isArray(rawTools)) {
    for (const item of rawTools) {
      if (typeof item === "string") {
        candidates.push(item);
      } else if (item && typeof item === "object" && !Array.isArray(item)) {
        const record = item as Record<string, unknown>;
        if (typeof record.name === "string" && record.name && record.enabled !== false) {
          candidates.push(record.name);
        }
      }
    }
  }

  return normalizeAllowedTools(candidates);
}

function normalizeAllowedTools(candidates: string[]): string[] {
  const normalized: string[] = [];
  for (const candidate of candidates) {
    const value = candidate.trim().toLowerCase();
    if (value && !disabledToolKeys.has(value) && !normalized.includes(value)) {
      normalized.push(value);
    }
  }
  return normalized;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function extractRuntimeImageConfig(toolsConfig: unknown): {
  setupScript: string | null;
  piBashEnabled: boolean;
  piBashAllowlist: string[];
} {
  const config = objectRecord(toolsConfig);
  const runtimeImage = objectRecord(config.runtime_image ?? config.runtimeImage);
  const snippet =
    typeof runtimeImage.setup_script === "string"
      ? runtimeImage.setup_script
      : typeof runtimeImage.setupScript === "string"
        ? runtimeImage.setupScript
        : typeof runtimeImage.dockerfile_snippet === "string"
          ? runtimeImage.dockerfile_snippet
          : typeof runtimeImage.dockerfileSnippet === "string"
            ? runtimeImage.dockerfileSnippet
        : null;
  return {
    setupScript: snippet,
    piBashEnabled: runtimeImage.pi_bash_enabled === true || runtimeImage.piBashEnabled === true,
    piBashAllowlist: normalizeStringList(
      arrayOfStrings(runtimeImage.pi_bash_allowlist ?? runtimeImage.piBashAllowlist),
    ),
  };
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function buildGondolinRuntimeAssets(input: {
  buildId: string;
  templateKey: string;
  templateVersionId: string;
  baseImage: string;
  setupScript: string;
}): Promise<GondolinBuildResult> {
  const { buildAssets, serializeBuildConfig, verifyAssets } = await import("@earendil-works/gondolin");
  const settings = getSettings();
  const assetLabel = buildImageTag(input.templateKey, input.buildId);
  const outputDir = path.resolve(settings.RUNTIME_GONDOLIN_BUILD_ROOT, assetLabel);
  await mkdir(outputDir, { recursive: true });
  const config = await createGondolinBuildConfig({
    contextPath: path.resolve(settings.TEMPLATE_BUILD_CONTEXT_PATH),
    configPath: settings.TEMPLATE_BUILD_GONDOLIN_CONFIG_PATH,
    templateVersionId: input.templateVersionId,
    setupScript: input.setupScript,
  });
  assertNativeGondolinBuild(config);
  await buildAssets(config, {
    outputDir,
    configDir: path.resolve(settings.TEMPLATE_BUILD_CONTEXT_PATH),
    verbose: false,
  });
  if (!verifyAssets(outputDir)) {
    throw new Error(`Gondolin asset verification failed for ${outputDir}`);
  }
  return {
    assetRef: outputDir,
    assetLabel,
    logs: serializeBuildConfig(config),
  };
}

async function createGondolinBuildConfig(input: {
  contextPath: string;
  configPath: string;
  templateVersionId: string;
  setupScript: string;
}): Promise<BuildConfig> {
  const { getDefaultBuildConfig, parseBuildConfig } = await import("@earendil-works/gondolin");
  const config = input.configPath.trim()
    ? parseBuildConfig(await readFile(input.configPath, "utf8"))
    : getDefaultBuildConfig();
  config.distro = "alpine";
  config.oci = undefined;
  config.container = undefined;
  config.env = {
    NODE_ENV: "production",
    KUUNA_TEMPLATE_VERSION_ID: input.templateVersionId,
  };
  config.alpine = {
    version: config.alpine?.version ?? "3.23.0",
    ...config.alpine,
    rootfsPackages: uniqueStrings([
      ...(config.alpine?.rootfsPackages ?? []),
      "bash",
      "ca-certificates",
      "coreutils",
      "file",
      "git",
      "nodejs",
      "npm",
      "openssh-client",
    ]),
  };
  config.postBuild = {
    copy: [
      { src: path.join(input.contextPath, "package.json"), dest: `${runtimeWorkspaceDest}/package.json` },
      { src: path.join(input.contextPath, "pnpm-lock.yaml"), dest: `${runtimeWorkspaceDest}/pnpm-lock.yaml` },
      { src: path.join(input.contextPath, "pnpm-workspace.yaml"), dest: `${runtimeWorkspaceDest}/pnpm-workspace.yaml` },
      { src: path.join(input.contextPath, "packages"), dest: `${runtimeWorkspaceDest}/packages` },
      { src: path.join(input.contextPath, "services/runtime-agent-ts"), dest: `${runtimeWorkspaceDest}/services/runtime-agent-ts` },
    ],
    commands: [
      "npm install -g pnpm@10.33.2",
      ...(input.setupScript ? [input.setupScript] : []),
      `cd ${runtimeWorkspaceDest} && pnpm install --frozen-lockfile --filter @kuuna/runtime-agent-ts... --prod=false`,
      `cd ${runtimeWorkspaceDest} && pnpm --filter @kuuna/runtime-agent-ts... build`,
      `cd ${runtimeWorkspaceDest} && pnpm prune --prod`,
    ],
  };
  config.runtimeDefaults = { rootfsMode: "cow", ...(config.runtimeDefaults ?? {}) };
  return config;
}

function assertNativeGondolinBuild(config: BuildConfig): void {
  if (config.container) {
    throw new Error("AI runtime template builds must not use Gondolin container-backed build settings");
  }
  const postBuildCommands = config.postBuild?.commands ?? [];
  if (platform() !== "linux" && postBuildCommands.length > 0) {
    throw new Error(
      "Native Gondolin post-build commands require a Linux host; run the AI runtime worker on a host with QEMU/Gondolin native build support instead of Docker/Podman-backed builds",
    );
  }
}

function uniqueStrings(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out;
}

async function markFailed(database: DbLike, build: TemplateBuildRow, error: string): Promise<void> {
  await database
    .update(templateBuilds)
    .set({ status: "failed", imageRef: null, updatedAt: new Date() })
    .where(eq(templateBuilds.id, build.id));
  await database.insert(auditEvents).values({
    actorUserId: null,
    eventType: "template_build.failed",
    entityType: "template_build",
    entityId: build.id,
    payload: { error },
  });
  await publishRuntimeEvent({
    type: "template_build.updated",
    entityId: build.id,
    entityType: "template_build",
    payload: {
      status: "failed",
      template_id: build.templateId,
      template_version_id: build.templateVersionId,
      error,
    },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tail(value: string, maxLen: number): string {
  if (value.length <= maxLen) {
    return value;
  }
  return `...${value.slice(-maxLen)}`;
}

function buildImageTag(templateKey: string, buildId: string): string {
  const safeKey = templateKey.replace(tagSafePattern, "-").replace(/^-+|-+$/g, "").toLowerCase() || "template";
  const short = buildId.replaceAll("-", "").slice(0, 12);
  return `gondolin-template-${safeKey}-build-${short}`;
}

function jobToken(value: string): string {
  return value.replaceAll("-", "_").replaceAll(" ", "_");
}
