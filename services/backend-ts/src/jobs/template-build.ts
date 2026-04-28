import { execFile } from "node:child_process";

import { and, desc, eq } from "drizzle-orm";

import { getSettings } from "../config.js";
import type { Database, DbLike } from "../db/client.js";
import { auditEvents, groupTemplates, templateBuilds, templateVersions } from "../db/schema.js";
import { logger } from "../logging.js";
import { enqueueKuunaJob, type EnqueueKuunaJob } from "./queues.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const baseImagePattern = /^[a-zA-Z0-9._/:@-]+$/;
const tagSafePattern = /[^a-zA-Z0-9._-]+/g;

export type TemplateBuildRow = typeof templateBuilds.$inferSelect;

export type CommandResult = {
  returncode: number;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

export class TemplateBuildValidationError extends Error {}
export class TemplateBuildNotFoundError extends Error {}

export type QueueTemplateBuildInput = {
  actorUserId: string;
  templateId: string;
  versionId: string;
  baseImage: string;
  allowedTools?: string[] | null;
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

  const baseImage = validateBaseImage(input.baseImage);
  const allowedTools = input.allowedTools
    ? input.allowedTools.map((tool) => tool.trim().toLowerCase()).filter(Boolean)
    : extractAllowedTools(version.toolsConfig);

  const buildInputs = {
    base_image: baseImage,
    allowed_tools: allowedTools,
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
  options: { commandRunner?: CommandRunner } = {},
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

  const buildInputs = objectRecord(build.buildInputs);
  const baseImage = typeof buildInputs.base_image === "string" ? buildInputs.base_image.trim() : "";
  if (!baseImage) {
    await markFailed(database, build, "missing base_image in build_inputs");
    return { processed: true, status: "failed" };
  }

  const settings = getSettings();
  const docker = settings.DOCKER_CLI_PATH;
  const imageTag = buildImageTag(template.key, build.id);
  const buildArgs = [
    "build",
    "-f",
    settings.TEMPLATE_BUILD_DOCKERFILE_PATH,
    "--build-arg",
    `BASE_IMAGE=${baseImage}`,
    "--build-arg",
    `KUUNA_TEMPLATE_KEY=${template.key}`,
    "--build-arg",
    `KUUNA_TEMPLATE_VERSION_ID=${version.id}`,
    "-t",
    imageTag,
    settings.TEMPLATE_BUILD_CONTEXT_PATH,
  ];
  const runner = options.commandRunner ?? runCommand;
  const completed = await runner(docker, buildArgs);
  const logs = JSON.stringify({
    command: [docker, ...buildArgs],
    returncode: completed.returncode,
    stdout_tail: tail(completed.stdout, 4000),
    stderr_tail: tail(completed.stderr, 4000),
  });

  await database
    .update(templateBuilds)
    .set({ logsRef: logs, updatedAt: new Date() })
    .where(eq(templateBuilds.id, build.id));

  if (completed.returncode !== 0) {
    await markFailed(database, build, `docker build failed (exit ${completed.returncode})`);
    return { processed: true, status: "failed" };
  }

  const inspect = await runner(docker, ["image", "inspect", "--format", "{{json .RepoDigests}}", imageTag]);
  const imageRef = parseFirstDigest(inspect) ?? imageTag;

  await database
    .update(templateBuilds)
    .set({
      status: "succeeded",
      imageRef: imageRef.slice(0, 512),
      imageTag: imageTag.slice(0, 255),
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
      image_ref: imageRef.slice(0, 512),
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

  const normalized: string[] = [];
  for (const candidate of candidates) {
    const value = candidate.trim().toLowerCase();
    if (value && !normalized.includes(value)) {
      normalized.push(value);
    }
  }
  return normalized;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
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
}

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && typeof (error as NodeJS.ErrnoException).code === "string" && typeof (error as NodeJS.ErrnoException).errno === "number") {
        reject(error);
        return;
      }
      const maybeCode = error && typeof (error as { code?: unknown }).code === "number"
        ? (error as { code: number }).code
        : 0;
      resolve({
        returncode: maybeCode,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
      });
    });
  });
}

function parseFirstDigest(result: CommandResult): string | null {
  if (result.returncode !== 0 || !result.stdout.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(result.stdout.trim()) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.find((item): item is string => typeof item === "string" && Boolean(item)) ?? null;
    }
  } catch {
    return null;
  }
  return null;
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
  return `kuuna/template-${safeKey}:build-${short}`;
}

function jobToken(value: string): string {
  return value.replaceAll("-", "_").replaceAll(" ", "_");
}
