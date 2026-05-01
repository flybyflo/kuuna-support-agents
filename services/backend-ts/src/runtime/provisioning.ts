import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import type {
  createHttpHooks as createHttpHooksFn,
  ExecProcess,
  IngressAccess,
  RealFSProvider as RealFSProviderClass,
  RootfsMode,
  VM as VMClass,
} from "@earendil-works/gondolin";
import { and, desc, eq, sql } from "drizzle-orm";

import { getSettings, type Settings } from "../config.js";
import type { Database, DbLike } from "../db/client.js";
import { agentInstances, groupBindings, templateBuilds } from "../db/schema.js";
import { logger } from "../logging.js";

const defaultHealthcheckAttempts = 20;
const defaultHealthcheckIntervalMs = 250;
const defaultRuntimeModel = "gpt-5.5";
const defaultReasoningEffort = "medium";
const managedRuntimeLabel = "dev.kuuna.managed-runtime";
const reservedRuntimeEnvKeys = new Set([
  "PORT",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_AUDIO_TRANSCRIPTION_MODEL",
  "OPENAI_TIMEOUT_SECONDS",
  "OPENAI_VISION_MODEL",
  "RUNTIME_AGENT_DEFAULT_MODEL",
  "RUNTIME_AGENT_REASONING_EFFORT",
  "KUUNA_PROVIDER_GROUP_ID",
  "KUUNA_BINDING_ID",
  "KUUNA_AGENT_INSTANCE_ID",
  "KUUNA_SECRETS_REF",
  "KUUNA_RUNTIME_TOOL_BACKEND_BASE_URL",
  "KUUNA_RUNTIME_TOOL_TOKEN",
  "KUUNA_RUNTIME_DATA_DIR",
]);

export type RuntimeProvisioningErrorCode =
  | "runtime_binding_not_found"
  | "runtime_agent_instance_not_found"
  | "runtime_asset_required"
  | "runtime_session_unmanaged"
  | "runtime_session_identity_mismatch"
  | "runtime_session_start_failed"
  | "runtime_session_stop_failed"
  | "runtime_healthcheck_failed"
  | "runtime_extra_env_invalid"
  | "runtime_gondolin_config_invalid"
  | "runtime_gondolin_error";

export class RuntimeProvisioningError extends Error {
  readonly code: RuntimeProvisioningErrorCode;

  constructor(code: RuntimeProvisioningErrorCode, message: string) {
    super(message);
    this.name = "RuntimeProvisioningError";
    this.code = code;
  }
}

export type RuntimeIdentity = {
  providerGroupId: string;
  bindingId: string;
  agentInstanceId: string;
  containerName: string;
  secretsRef: string;
};

export type RuntimeProvisioningResult = {
  containerId: string;
  containerName: string;
  runtimeBaseUrl: string;
  dockerNetwork: string | null;
  assetRef: string;
  sessionId: string;
};

export type RuntimeVmSpec = {
  identity: RuntimeIdentity;
  assetRef: string;
  env: string[];
  configHash: string;
  dataDir: string;
  port: number;
  settings: Settings;
};

export type RuntimeVmSession = {
  sessionId: string;
  sessionLabel: string;
  runtimeBaseUrl: string;
  configHash: string;
  assetRef: string;
};

export interface GondolinRuntimeManager {
  ensure(spec: RuntimeVmSpec): Promise<RuntimeVmSession>;
  close?(sessionLabel: string): Promise<void>;
}

export type EnsureRuntimeForChatInput = {
  providerGroupId: string;
  messageId: string;
  traceId: string | null;
};

export type RuntimeProvisioner = (
  database: DbLike,
  input: EnsureRuntimeForChatInput,
) => Promise<RuntimeProvisioningResult>;

type ManagedVm = RuntimeVmSession & {
  vm: VMClass;
  ingress: IngressAccess;
  server: ExecProcess;
  lastUsedAt: number;
};

type GondolinSdk = {
  VM: typeof VMClass;
  RealFSProvider: typeof RealFSProviderClass;
  createHttpHooks: typeof createHttpHooksFn;
};

export async function ensureRuntimeForChat(
  database: DbLike,
  input: EnsureRuntimeForChatInput,
  options: { runtimeManager?: GondolinRuntimeManager; settings?: Settings } = {},
): Promise<RuntimeProvisioningResult> {
  const settings = options.settings ?? getSettings();
  const run = async (tx: DbLike): Promise<RuntimeProvisioningResult> => {
    await acquireChatProvisioningLock(tx, input.providerGroupId);
    const target = await resolveProvisioningTarget(tx, input.providerGroupId);
    const assetRef = target.imageRef || settings.RUNTIME_GONDOLIN_ASSET_REF.trim();
    if (!assetRef) {
      throw new RuntimeProvisioningError("runtime_asset_required", "Gondolin runtime asset ref is required");
    }

    const identity: RuntimeIdentity = {
      providerGroupId: input.providerGroupId,
      bindingId: target.bindingId,
      agentInstanceId: target.agentInstanceId,
      containerName: target.containerName,
      secretsRef: target.secretsRef,
    };
    const env = buildRuntimeEnv(identity, settings);
    const spec: RuntimeVmSpec = {
      identity,
      assetRef,
      env,
      configHash: runtimeConfigHash({ assetRef, env, identity }),
      dataDir: runtimeDataPath(identity.containerName, settings),
      port: settings.RUNTIME_AGENT_CONTAINER_PORT,
      settings,
    };
    const manager = options.runtimeManager ?? defaultRuntimeManager();
    const session = await manager.ensure(spec);
    await ensureRuntimeSessionHealthy(manager, session);

    await tx
      .update(agentInstances)
      .set({
        status: "healthy",
        runtimeBaseUrl: session.runtimeBaseUrl,
        runtimeContainerName: identity.containerName,
        secretsRef: identity.secretsRef,
        updatedAt: new Date(),
      })
      .where(eq(agentInstances.id, identity.agentInstanceId));

    return {
      containerId: session.sessionId,
      containerName: identity.containerName,
      runtimeBaseUrl: session.runtimeBaseUrl,
      dockerNetwork: null,
      assetRef: session.assetRef,
      sessionId: session.sessionId,
    };
  };

  try {
    if (hasTransaction(database)) {
      return await database.transaction(run);
    }
    return await run(database);
  } catch (error) {
    await markRuntimeDegraded(database, input.providerGroupId);
    throw error;
  }
}

export async function provisionGondolinRuntime(
  manager: GondolinRuntimeManager,
  input: {
    identity: RuntimeIdentity;
    assetRef: string;
    settings: Settings;
  },
): Promise<RuntimeProvisioningResult> {
  const env = buildRuntimeEnv(input.identity, input.settings);
  const session = await manager.ensure({
    identity: input.identity,
    assetRef: input.assetRef,
    env,
    configHash: runtimeConfigHash({ assetRef: input.assetRef, env, identity: input.identity }),
    dataDir: runtimeDataPath(input.identity.containerName, input.settings),
    port: input.settings.RUNTIME_AGENT_CONTAINER_PORT,
    settings: input.settings,
  });
  await ensureRuntimeSessionHealthy(manager, session);
  return {
    containerId: session.sessionId,
    containerName: input.identity.containerName,
    runtimeBaseUrl: session.runtimeBaseUrl,
    dockerNetwork: null,
    assetRef: session.assetRef,
    sessionId: session.sessionId,
  };
}

export function safeContainerSuffix(providerGroupId: string): string {
  const normalized = providerGroupId
    .toLowerCase()
    .replaceAll("@", "-at-")
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  const digest = createHash("sha256").update(providerGroupId).digest("hex").slice(0, 12);
  const maxPrefixLength = 80 - digest.length - 1;
  const prefix = (normalized || "group").slice(0, maxPrefixLength).replace(/^[.-]+|[.-]+$/g, "") || "group";
  return `${prefix}-${digest}`;
}

export function dataVolumeName(containerName: string, settings: Settings): string {
  return runtimeDataPath(containerName, settings);
}

export function runtimeDataPath(containerName: string, settings: Settings): string {
  return path.resolve(settings.RUNTIME_GONDOLIN_DATA_ROOT, safePathSegment(containerName));
}

export function buildRuntimeLabels(identity: RuntimeIdentity): Record<string, string> {
  return {
    [managedRuntimeLabel]: "true",
    "dev.kuuna.provider-group-id": identity.providerGroupId,
    "dev.kuuna.binding-id": identity.bindingId,
    "dev.kuuna.agent-instance-id": identity.agentInstanceId,
    "dev.kuuna.secrets-ref": identity.secretsRef,
  };
}

export function buildRuntimeEnv(identity: RuntimeIdentity, settings: Settings): string[] {
  const env: Record<string, string> = {
    PORT: String(settings.RUNTIME_AGENT_CONTAINER_PORT),
    OPENAI_BASE_URL: settings.OPENAI_BASE_URL,
    OPENAI_AUDIO_TRANSCRIPTION_MODEL: settings.OPENAI_AUDIO_TRANSCRIPTION_MODEL,
    OPENAI_TIMEOUT_SECONDS: String(settings.OPENAI_TIMEOUT_SECONDS),
    OPENAI_VISION_MODEL: settings.OPENAI_VISION_MODEL,
    RUNTIME_AGENT_DEFAULT_MODEL: defaultRuntimeModel,
    RUNTIME_AGENT_REASONING_EFFORT: defaultReasoningEffort,
    KUUNA_PROVIDER_GROUP_ID: identity.providerGroupId,
    KUUNA_BINDING_ID: identity.bindingId,
    KUUNA_AGENT_INSTANCE_ID: identity.agentInstanceId,
    KUUNA_SECRETS_REF: identity.secretsRef,
    KUUNA_RUNTIME_TOOL_BACKEND_BASE_URL: settings.RUNTIME_TOOL_BACKEND_BASE_URL,
    KUUNA_RUNTIME_DATA_DIR: settings.RUNTIME_CONTAINER_DATA_DIR,
  };
  const runtimeToolToken = settings.RUNTIME_TOOL_TOKEN?.trim() || settings.INTERNAL_OPS_TOKEN?.trim();
  if (runtimeToolToken) {
    env.KUUNA_RUNTIME_TOOL_TOKEN = runtimeToolToken;
  }
  if (settings.OPENAI_API_KEY?.trim()) {
    env.OPENAI_API_KEY = settings.OPENAI_API_KEY;
  }
  Object.assign(env, parseExtraEnv(settings.RUNTIME_CONTAINER_EXTRA_ENV_JSON));
  return Object.entries(env).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`);
}

export function parseExtraEnv(rawValue: string | undefined): Record<string, string> {
  const normalized = normalizeOptional(rawValue);
  if (!normalized) return {};
  let decoded: unknown;
  try {
    decoded = JSON.parse(normalized);
  } catch (error) {
    throw new RuntimeProvisioningError(
      "runtime_extra_env_invalid",
      `RUNTIME_CONTAINER_EXTRA_ENV_JSON must be valid JSON: ${errorMessage(error)}`,
    );
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new RuntimeProvisioningError("runtime_extra_env_invalid", "RUNTIME_CONTAINER_EXTRA_ENV_JSON must be an object");
  }
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(decoded)) {
    if (!key || key.includes("=")) {
      throw new RuntimeProvisioningError("runtime_extra_env_invalid", "RUNTIME_CONTAINER_EXTRA_ENV_JSON contains an invalid key");
    }
    if (reservedRuntimeEnvKeys.has(key) || key.startsWith("KUUNA_")) {
      throw new RuntimeProvisioningError("runtime_extra_env_invalid", `RUNTIME_CONTAINER_EXTRA_ENV_JSON cannot override reserved key ${key}`);
    }
    if (value === null || value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      env[key] = String(value);
      continue;
    }
    throw new RuntimeProvisioningError("runtime_extra_env_invalid", "RUNTIME_CONTAINER_EXTRA_ENV_JSON values must be scalar");
  }
  return env;
}

export function runtimeConfigHash(input: {
  assetRef: string;
  env: string[];
  identity: RuntimeIdentity;
}): string {
  return createHash("sha256")
    .update(JSON.stringify({
      assetRef: input.assetRef,
      env: [...input.env].sort(),
      labels: Object.entries(buildRuntimeLabels(input.identity)).sort(([left], [right]) => left.localeCompare(right)),
    }))
    .digest("hex");
}

export class SdkGondolinRuntimeManager implements GondolinRuntimeManager {
  private readonly sessions = new Map<string, ManagedVm>();
  private readonly idleTtlMs: number;
  private gcTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: { idleTtlMs?: number } = {}) {
    this.idleTtlMs = options.idleTtlMs ?? 15 * 60 * 1000;
    this.startGc();
  }

  async ensure(spec: RuntimeVmSpec): Promise<RuntimeVmSession> {
    const existing = this.sessions.get(spec.identity.containerName);
    if (existing && existing.configHash === spec.configHash && existing.assetRef === spec.assetRef) {
      existing.lastUsedAt = Date.now();
      return toRuntimeVmSession(existing);
    }
    if (existing) {
      await this.closeManaged(existing);
      this.sessions.delete(spec.identity.containerName);
    }

    const session = await this.start(spec);
    this.sessions.set(spec.identity.containerName, session);
    return toRuntimeVmSession(session);
  }

  async close(sessionLabel: string): Promise<void> {
    const existing = this.sessions.get(sessionLabel);
    if (!existing) return;
    await this.closeManaged(existing);
    this.sessions.delete(sessionLabel);
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(sessions.map((session) => this.closeManaged(session)));
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
  }

  private async start(spec: RuntimeVmSpec): Promise<ManagedVm> {
    const { VM, RealFSProvider, createHttpHooks } = await loadGondolinSdk();
    await mkdir(spec.dataDir, { recursive: true });
    const envRecord = envArrayToRecord(spec.env);
    const secretHooks = runtimeHttpHooks(createHttpHooks, envRecord, spec.settings);
    const vmEnv = { ...envRecord, ...secretHooks.env };
    const rootfsMode = parseRootfsMode(spec.settings.RUNTIME_GONDOLIN_ROOTFS_MODE);
    const tcp = parseTcpMap(spec.settings.RUNTIME_GONDOLIN_TCP_MAP_JSON);
    const vm = await VM.create({
      sessionLabel: spec.identity.containerName,
      sandbox: { imagePath: spec.assetRef },
      rootfs: { mode: rootfsMode },
      httpHooks: secretHooks.httpHooks,
      env: vmEnv,
      tcp: tcp ? { hosts: tcp } : undefined,
      dns: tcp ? { mode: "synthetic", syntheticHostMapping: "per-host" } : undefined,
      vfs: {
        mounts: {
          [spec.settings.RUNTIME_CONTAINER_DATA_DIR]: new RealFSProvider(spec.dataDir),
        },
      },
    });
    const ingress = await vm.enableIngress({ listenHost: "127.0.0.1", listenPort: 0 });
    vm.setIngressRoutes([{ prefix: "/", port: spec.port, stripPrefix: true }]);
    const server = vm.exec(["/bin/sh", "-lc", runtimeStartCommand(spec.settings)], {
      cwd: "/workspace/services/runtime-agent-ts",
      env: vmEnv,
      stdout: "pipe",
      stderr: "pipe",
      buffer: false,
    });
    server.catch((error: unknown) => {
      // The health check and next provisioning attempt report failures to callers.
      void error;
    });
    return {
      vm,
      ingress,
      server,
      sessionId: vm.id,
      sessionLabel: spec.identity.containerName,
      runtimeBaseUrl: ingress.url,
      configHash: spec.configHash,
      assetRef: spec.assetRef,
      lastUsedAt: Date.now(),
    };
  }

  private async closeManaged(session: ManagedVm): Promise<void> {
    await Promise.allSettled([
      session.ingress.close(),
      session.vm.close(),
    ]);
  }

  private startGc(): void {
    if (this.gcTimer || this.idleTtlMs <= 0) return;
    this.gcTimer = setInterval(() => {
      const cutoff = Date.now() - this.idleTtlMs;
      for (const [label, session] of this.sessions.entries()) {
        if (session.lastUsedAt >= cutoff) continue;
        this.sessions.delete(label);
        void this.closeManaged(session);
      }
    }, Math.min(this.idleTtlMs, 60_000));
    this.gcTimer.unref();
  }
}

let singletonRuntimeManager: SdkGondolinRuntimeManager | null = null;

export function defaultRuntimeManager(): SdkGondolinRuntimeManager {
  singletonRuntimeManager ??= new SdkGondolinRuntimeManager();
  return singletonRuntimeManager;
}

export async function closeDefaultRuntimeManager(): Promise<void> {
  if (!singletonRuntimeManager) return;
  await singletonRuntimeManager.closeAll();
  singletonRuntimeManager = null;
}

async function resolveProvisioningTarget(database: DbLike, providerGroupId: string): Promise<RuntimeIdentity & { imageRef: string | null }> {
  const rows = await database
    .select({
      bindingId: groupBindings.id,
      templateVersionId: groupBindings.templateVersionId,
      agentInstanceId: agentInstances.id,
      containerName: agentInstances.runtimeContainerName,
      secretsRef: agentInstances.secretsRef,
    })
    .from(groupBindings)
    .leftJoin(agentInstances, eq(agentInstances.groupBindingId, groupBindings.id))
    .where(and(eq(groupBindings.providerGroupId, providerGroupId), eq(groupBindings.status, "active")))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new RuntimeProvisioningError("runtime_binding_not_found", `active binding not found for ${providerGroupId}`);
  }
  if (!row.agentInstanceId) {
    throw new RuntimeProvisioningError("runtime_agent_instance_not_found", `agent instance not found for ${providerGroupId}`);
  }
  const containerName = row.containerName?.trim() || `kuuna-runtime-${safeContainerSuffix(providerGroupId)}`;
  const secretsRef = row.secretsRef?.trim() || `runtime/${safeContainerSuffix(providerGroupId)}`;
  const [build] = await database
    .select({ imageRef: templateBuilds.imageRef })
    .from(templateBuilds)
    .where(and(eq(templateBuilds.templateVersionId, row.templateVersionId), eq(templateBuilds.status, "succeeded")))
    .orderBy(desc(templateBuilds.createdAt), desc(templateBuilds.id))
    .limit(1);
  const imageRef = build?.imageRef?.trim() || null;
  return {
    providerGroupId,
    bindingId: row.bindingId,
    agentInstanceId: row.agentInstanceId,
    containerName,
    secretsRef,
    imageRef,
  };
}

async function acquireChatProvisioningLock(database: DbLike, providerGroupId: string): Promise<void> {
  await database.execute(sql`select pg_advisory_xact_lock(hashtext(${`runtime:${providerGroupId}`}))`);
}

async function markRuntimeDegraded(database: DbLike, providerGroupId: string): Promise<void> {
  const rows = await database
    .select({ id: agentInstances.id })
    .from(groupBindings)
    .innerJoin(agentInstances, eq(agentInstances.groupBindingId, groupBindings.id))
    .where(and(eq(groupBindings.providerGroupId, providerGroupId), eq(groupBindings.status, "active")))
    .limit(1);
  const row = rows[0];
  if (!row) return;
  await database
    .update(agentInstances)
    .set({ status: "degraded", updatedAt: new Date() })
    .where(eq(agentInstances.id, row.id));
}

function hasTransaction(database: DbLike): database is Database {
  return "transaction" in database && typeof database.transaction === "function";
}

async function waitForRuntimeHealth(runtimeBaseUrl: string): Promise<void> {
  const healthUrl = `${runtimeBaseUrl.replace(/\/$/, "")}/healthz`;
  let lastError = "no response";
  for (let attempt = 0; attempt < defaultHealthcheckAttempts; attempt += 1) {
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = errorMessage(error);
    }
    if (attempt < defaultHealthcheckAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, defaultHealthcheckIntervalMs));
    }
  }
  throw new RuntimeProvisioningError(
    "runtime_healthcheck_failed",
    `Gondolin runtime did not become healthy at ${healthUrl}: ${lastError}`,
  );
}

async function ensureRuntimeSessionHealthy(
  manager: GondolinRuntimeManager,
  session: RuntimeVmSession,
): Promise<void> {
  try {
    await waitForRuntimeHealth(session.runtimeBaseUrl);
  } catch (error) {
    await manager.close?.(session.sessionLabel).catch((closeError: unknown) => {
      logger.warn("runtime_gondolin_close_after_health_failure_failed", {
        session_label: session.sessionLabel,
        error: errorMessage(closeError),
      });
    });
    throw error;
  }
}

async function loadGondolinSdk(): Promise<GondolinSdk> {
  return import("@earendil-works/gondolin");
}

function runtimeHttpHooks(
  createHttpHooks: typeof createHttpHooksFn,
  env: Record<string, string>,
  settings: Settings,
) {
  const allowedHosts = parseStringListJson(settings.RUNTIME_GONDOLIN_ALLOWED_HOSTS_JSON);
  const internalHosts = allowedHosts.filter((host) => isInternalHost(host));
  const secrets: Record<string, { hosts: string[]; value: string }> = {};
  const openAiHost = hostnameFromUrl(settings.OPENAI_BASE_URL);
  if (env.OPENAI_API_KEY && openAiHost) {
    secrets.OPENAI_API_KEY = { hosts: [openAiHost], value: env.OPENAI_API_KEY };
  }
  const runtimeToolHost = hostnameFromUrl(settings.RUNTIME_TOOL_BACKEND_BASE_URL);
  if (env.KUUNA_RUNTIME_TOOL_TOKEN && runtimeToolHost) {
    secrets.KUUNA_RUNTIME_TOOL_TOKEN = { hosts: [runtimeToolHost], value: env.KUUNA_RUNTIME_TOOL_TOKEN };
  }
  return createHttpHooks({
    allowedHosts: [...allowedHosts, ...Object.values(secrets).flatMap((secret) => secret.hosts)],
    allowedInternalHosts: internalHosts,
    secrets,
  });
}

function runtimeStartCommand(settings: Settings): string {
  const command = settings.RUNTIME_GONDOLIN_START_COMMAND.trim();
  return command || "node dist/src/server.js";
}

function toRuntimeVmSession(session: ManagedVm): RuntimeVmSession {
  return {
    sessionId: session.sessionId,
    sessionLabel: session.sessionLabel,
    runtimeBaseUrl: session.runtimeBaseUrl,
    configHash: session.configHash,
    assetRef: session.assetRef,
  };
}

function envArrayToRecord(env: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const item of env) {
    const index = item.indexOf("=");
    if (index <= 0) continue;
    record[item.slice(0, index)] = item.slice(index + 1);
  }
  return record;
}

function parseStringListJson(rawValue: string | undefined): string[] {
  const normalized = normalizeOptional(rawValue);
  if (!normalized) return [];
  let decoded: unknown;
  try {
    decoded = JSON.parse(normalized);
  } catch (error) {
    throw new RuntimeProvisioningError("runtime_gondolin_config_invalid", `invalid JSON string list: ${errorMessage(error)}`);
  }
  if (!Array.isArray(decoded) || !decoded.every((item) => typeof item === "string")) {
    throw new RuntimeProvisioningError("runtime_gondolin_config_invalid", "expected JSON string list");
  }
  return decoded.map((item) => item.trim()).filter(Boolean);
}

function parseTcpMap(rawValue: string | undefined): Record<string, string> | null {
  const normalized = normalizeOptional(rawValue);
  if (!normalized) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(normalized);
  } catch (error) {
    throw new RuntimeProvisioningError("runtime_gondolin_config_invalid", `RUNTIME_GONDOLIN_TCP_MAP_JSON must be valid JSON: ${errorMessage(error)}`);
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new RuntimeProvisioningError("runtime_gondolin_config_invalid", "RUNTIME_GONDOLIN_TCP_MAP_JSON must be an object");
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(decoded)) {
    if (typeof value !== "string" || !key.trim() || !value.trim()) {
      throw new RuntimeProvisioningError("runtime_gondolin_config_invalid", "RUNTIME_GONDOLIN_TCP_MAP_JSON values must be strings");
    }
    out[key.trim()] = value.trim();
  }
  return out;
}

function parseRootfsMode(value: string): RootfsMode {
  if (value === "readonly" || value === "memory" || value === "cow") return value;
  throw new RuntimeProvisioningError("runtime_gondolin_config_invalid", `invalid RUNTIME_GONDOLIN_ROOTFS_MODE: ${value}`);
}

function hostnameFromUrl(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function isInternalHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".internal");
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "") || "runtime";
}

function normalizeOptional(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
