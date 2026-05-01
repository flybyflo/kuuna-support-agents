import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { Settings } from "../src/config.js";
import {
  buildRuntimeEnv,
  buildRuntimeLabels,
  dataVolumeName,
  provisionGondolinRuntime,
  RuntimeProvisioningError,
  runtimeConfigHash,
  safeContainerSuffix,
  type GondolinRuntimeManager,
  type RuntimeIdentity,
  type RuntimeVmSession,
  type RuntimeVmSpec,
} from "../src/runtime/provisioning.js";

const baseSettings: Settings = {
  APP_ENV: "test",
  HOST: "::",
  PORT: 8000,
  DATABASE_URL: "postgres://test",
  REDIS_URL: "redis://test",
  REQUIRED_ADMIN_EMAIL: "admin@kuuna.ai",
  DASHBOARD_REQUIRED_ADMIN_PASSWORD: "admin123456!",
  DASHBOARD_DEV_RESET_BOOTSTRAP_ADMIN_PASSWORD: false,
  AUTH_TOKEN_SECRET: "secret",
  AUTH_TOKEN_TTL_SECONDS: 3600,
  AUTH_LOCKOUT_THRESHOLD: 5,
  AUTH_LOCKOUT_SECONDS: 900,
  AUTH_PASSWORD_MIN_LENGTH: 12,
  AUTH_PASSWORD_MAX_CONSECUTIVE: 3,
  AUTH_RATE_LIMIT_WINDOW_SECONDS: 60,
  AUTH_RATE_LIMIT_MAX_ATTEMPTS: 20,
  OPENAI_BASE_URL: "https://api.openai.com/v1",
  OPENAI_TIMEOUT_SECONDS: 30,
  OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
  OPENAI_AUDIO_TRANSCRIPTION_MODEL: "gpt-4o-mini-transcribe",
  OPENAI_VISION_MODEL: "gpt-4.1-mini",
  S3_BUCKET: "kuuna-dev",
  S3_REGION: "us-east-1",
  MEDIA_PROCESSING_ENABLED: true,
  MEDIA_DOWNLOAD_TIMEOUT_SECONDS: 20,
  GATEWAY_BASE_URL: "http://gateway:8090",
  OUTBOUND_DISPATCH_TIMEOUT_SECONDS: 10,
  TODO_EXPORT_ENABLED: false,
  TODO_EXPORT_TIMEOUT_SECONDS: 20,
  TEMPLATE_BUILD_CONTEXT_PATH: ".",
  TEMPLATE_BUILD_GONDOLIN_CONFIG_PATH: "",
  RUNTIME_AGENT_TIMEOUT_SECONDS: 45,
  RUNTIME_GONDOLIN_ASSET_REF: "/opt/kuuna/gondolin/default-runtime",
  RUNTIME_GONDOLIN_DATA_ROOT: "/tmp/kuuna-runtime-data",
  RUNTIME_GONDOLIN_BUILD_ROOT: "/tmp/kuuna-template-builds",
  RUNTIME_GONDOLIN_ROOTFS_MODE: "cow",
  RUNTIME_GONDOLIN_ALLOWED_HOSTS_JSON: JSON.stringify(["api.openai.com", "127.0.0.1"]),
  RUNTIME_GONDOLIN_START_COMMAND: "node dist/src/server.js",
  RUNTIME_AGENT_CONTAINER_PORT: 8100,
  RUNTIME_TOOL_BACKEND_BASE_URL: "http://127.0.0.1:8000",
  RUNTIME_CONTAINER_DATA_DIR: "/runtime-data",
};

class FakeGondolinRuntimeManager implements GondolinRuntimeManager {
  sessions = new Map<string, RuntimeVmSession>();
  starts: RuntimeVmSpec[] = [];
  closes: string[] = [];
  nextSessionId = "gondolin-session-new";

  async ensure(spec: RuntimeVmSpec): Promise<RuntimeVmSession> {
    const existing = this.sessions.get(spec.identity.containerName);
    if (existing && existing.configHash === spec.configHash && existing.assetRef === spec.assetRef) {
      return existing;
    }
    if (existing) {
      await this.close(spec.identity.containerName);
    }
    this.starts.push(spec);
    const session = {
      sessionId: this.nextSessionId,
      sessionLabel: spec.identity.containerName,
      runtimeBaseUrl: "http://127.0.0.1:49152",
      configHash: spec.configHash,
      assetRef: spec.assetRef,
    };
    this.sessions.set(spec.identity.containerName, session);
    return session;
  }

  async close(sessionLabel: string): Promise<void> {
    this.closes.push(sessionLabel);
    this.sessions.delete(sessionLabel);
  }
}

function identity(providerGroupId = "group-a@g.us"): RuntimeIdentity {
  const suffix = safeContainerSuffix(providerGroupId);
  return {
    providerGroupId,
    bindingId: randomUUID(),
    agentInstanceId: randomUUID(),
    containerName: `kuuna-runtime-${suffix}`,
    secretsRef: `runtime/${suffix}`,
  };
}

async function withHealthyRuntime<T>(callback: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 });
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("provisionGondolinRuntime creates a lazy per-chat VM with data mount path", async () => {
  await withHealthyRuntime(async () => {
    const runtimeIdentity = identity();
    const manager = new FakeGondolinRuntimeManager();

    const result = await provisionGondolinRuntime(manager, {
      identity: runtimeIdentity,
      assetRef: "/assets/runtime-a",
      settings: baseSettings,
    });

    assert.equal(result.containerId, "gondolin-session-new");
    assert.equal(result.runtimeBaseUrl, "http://127.0.0.1:49152");
    assert.equal(result.dockerNetwork, null);
    assert.equal(result.assetRef, "/assets/runtime-a");
    assert.equal(manager.starts.length, 1);
    const spec = manager.starts[0]!;
    assert.equal(spec.identity.providerGroupId, runtimeIdentity.providerGroupId);
    assert.equal(spec.dataDir, dataVolumeName(runtimeIdentity.containerName, baseSettings));
    assert.ok(spec.env.includes(`KUUNA_PROVIDER_GROUP_ID=${runtimeIdentity.providerGroupId}`));
  });
});

test("Gondolin manager fake reuses a matching healthy VM", async () => {
  await withHealthyRuntime(async () => {
    const runtimeIdentity = identity();
    const manager = new FakeGondolinRuntimeManager();

    await provisionGondolinRuntime(manager, {
      identity: runtimeIdentity,
      assetRef: "/assets/runtime-a",
      settings: baseSettings,
    });
    await provisionGondolinRuntime(manager, {
      identity: runtimeIdentity,
      assetRef: "/assets/runtime-a",
      settings: baseSettings,
    });

    assert.equal(manager.starts.length, 1);
    assert.deepEqual(manager.closes, []);
  });
});

test("Gondolin manager fake restarts stale asset or config sessions", async () => {
  await withHealthyRuntime(async () => {
    const runtimeIdentity = identity();
    const manager = new FakeGondolinRuntimeManager();

    await provisionGondolinRuntime(manager, {
      identity: runtimeIdentity,
      assetRef: "/assets/runtime-a",
      settings: baseSettings,
    });
    await provisionGondolinRuntime(manager, {
      identity: runtimeIdentity,
      assetRef: "/assets/runtime-b",
      settings: baseSettings,
    });

    assert.equal(manager.starts.length, 2);
    assert.deepEqual(manager.closes, [runtimeIdentity.containerName]);
  });
});

test("provisionGondolinRuntime closes VM sessions that fail health checks", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ status: "starting" }), { status: 503 });
  try {
    const runtimeIdentity = identity();
    const manager = new FakeGondolinRuntimeManager();

    await assert.rejects(
      async () => provisionGondolinRuntime(manager, {
        identity: runtimeIdentity,
        assetRef: "/assets/runtime-a",
        settings: baseSettings,
      }),
      (error: unknown) => error instanceof RuntimeProvisioningError && error.code === "runtime_healthcheck_failed",
    );

    assert.deepEqual(manager.closes, [runtimeIdentity.containerName]);
    assert.equal(manager.sessions.has(runtimeIdentity.containerName), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runtime config hash changes when binding identity changes", () => {
  const runtimeIdentity = identity("group-a@g.us");
  const oldIdentity: RuntimeIdentity = {
    ...runtimeIdentity,
    bindingId: randomUUID(),
    agentInstanceId: randomUUID(),
    secretsRef: "runtime/old-group-a",
  };
  const env = buildRuntimeEnv(runtimeIdentity, baseSettings);
  const oldEnv = buildRuntimeEnv(oldIdentity, baseSettings);

  assert.notEqual(
    runtimeConfigHash({ assetRef: "/assets/runtime-a", env, identity: runtimeIdentity }),
    runtimeConfigHash({ assetRef: "/assets/runtime-a", env: oldEnv, identity: oldIdentity }),
  );
});

test("buildRuntimeEnv refuses extra env overrides for reserved runtime identity", () => {
  const settings: Settings = {
    ...baseSettings,
    RUNTIME_CONTAINER_EXTRA_ENV_JSON: JSON.stringify({ KUUNA_PROVIDER_GROUP_ID: "group-b@g.us" }),
  };

  assert.throws(
    () => buildRuntimeEnv(identity("group-a@g.us"), settings),
    (error: unknown) => error instanceof RuntimeProvisioningError && error.code === "runtime_extra_env_invalid",
  );
});

test("safeContainerSuffix and runtime data paths are stable per chat", () => {
  const first = safeContainerSuffix("customer chat@g.us");
  const second = safeContainerSuffix("customer chat@g.us");
  const third = safeContainerSuffix("other chat@g.us");

  assert.equal(first, second);
  assert.notEqual(first, third);
  assert.equal(dataVolumeName(`kuuna-runtime-${first}`, baseSettings), `/tmp/kuuna-runtime-data/kuuna-runtime-${first}`);
});

test("buildRuntimeLabels retains identity labels for audit compatibility", () => {
  const runtimeIdentity = identity("group-a@g.us");
  const labels = buildRuntimeLabels(runtimeIdentity);

  assert.equal(labels["dev.kuuna.managed-runtime"], "true");
  assert.equal(labels["dev.kuuna.provider-group-id"], runtimeIdentity.providerGroupId);
  assert.equal(labels["dev.kuuna.binding-id"], runtimeIdentity.bindingId);
});
