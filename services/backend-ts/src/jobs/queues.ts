import { createHash, randomUUID } from "node:crypto";

import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { getSettings } from "../config.js";

export type KuunaJobName =
  | "media_processing"
  | "outbound_dispatch"
  | "template_build"
  | "knowledge_indexing"
  | "retrieval_indexing"
  | "runtime_chat_queue"
  | "todo_export";

export type RuntimeChatTaskName = "inbound_execution" | "passive_message_analysis";

export type RuntimeChatTask = {
  name: RuntimeChatTaskName;
  messageId: string;
  providerGroupId: string;
  reason: string | null;
  traceId: string | null;
  enqueuedAt: string;
};

const runtimeChatDrainTtlSeconds = 60 * 30;

export type EnqueueKuunaJob = (
  name: KuunaJobName,
  data: Record<string, unknown>,
  jobId?: string,
) => Promise<string>;

export type RuntimeChatTaskQueueClient = {
  rpush(key: string, value: string): Promise<number>;
  set(
    key: string,
    value: string,
    expiryMode: "EX",
    expirySeconds: number,
    condition: "NX",
  ): Promise<"OK" | null>;
};

export type EnqueueRuntimeChatTaskOptions = {
  enqueueJob?: EnqueueKuunaJob;
  redis?: RuntimeChatTaskQueueClient;
  tokenFactory?: () => string;
};

export type TodoExportSchedulerQueue = {
  add(
    name: "todo_export",
    data: Record<string, unknown>,
    options: {
      jobId: string;
      repeat: { every: number };
      removeOnComplete: number;
      removeOnFail: number;
    },
  ): Promise<unknown>;
};

export type ScheduleTodoExportJobOptions = {
  enabled?: boolean;
  queue?: TodoExportSchedulerQueue;
};

let redisConnection: Redis | undefined;
let defaultQueue: Queue<Record<string, unknown>, unknown, KuunaJobName> | undefined;

export function getRedisConnection(): Redis {
  redisConnection ??= new Redis(getSettings().REDIS_URL, {
    maxRetriesPerRequest: null,
  });
  return redisConnection;
}

export function getDefaultQueue(): Queue<Record<string, unknown>, unknown, KuunaJobName> {
  defaultQueue ??= new Queue<Record<string, unknown>, unknown, KuunaJobName>("default", {
    connection: getRedisConnection(),
  });
  return defaultQueue;
}

export async function enqueueKuunaJob(
  name: KuunaJobName,
  data: Record<string, unknown>,
  jobId?: string,
): Promise<string> {
  const job = await getDefaultQueue().add(name, data, {
    jobId,
    removeOnComplete: 500,
    removeOnFail: 1000,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
  });
  return job.id ?? name;
}

export async function scheduleTodoExportJob(
  options: ScheduleTodoExportJobOptions = {},
): Promise<boolean> {
  const enabled = options.enabled ?? getSettings().TODO_EXPORT_ENABLED;
  if (!enabled) {
    return false;
  }
  const queue = options.queue ?? getDefaultQueue();
  await queue.add(
    "todo_export",
    {},
    {
      jobId: "todo_export_repeat",
      repeat: { every: 10 * 60 * 1000 },
      removeOnComplete: 500,
      removeOnFail: 1000,
    },
  );
  return true;
}

export async function enqueueRuntimeChatTask(
  input: Omit<RuntimeChatTask, "enqueuedAt">,
  options: EnqueueRuntimeChatTaskOptions = {},
): Promise<string> {
  const task: RuntimeChatTask = {
    ...input,
    enqueuedAt: new Date().toISOString(),
  };
  const jobId = runtimeChatDrainJobId(input.providerGroupId);
  const redis = options.redis ?? getRedisConnection();
  await redis.rpush(runtimeChatQueueKey(input.providerGroupId), JSON.stringify(task));
  await scheduleRuntimeChatDrain(input.providerGroupId, options);
  return jobId;
}

export async function peekRuntimeChatTask(providerGroupId: string): Promise<RuntimeChatTask | null> {
  const raw = await getRedisConnection().lindex(runtimeChatQueueKey(providerGroupId), 0);
  if (!raw) return null;
  return parseRuntimeChatTask(raw);
}

export async function removeProcessedRuntimeChatTask(providerGroupId: string): Promise<void> {
  await getRedisConnection().lpop(runtimeChatQueueKey(providerGroupId));
}

export async function completeRuntimeChatDrain(providerGroupId: string, drainToken: string | null): Promise<void> {
  if (drainToken) {
    await releaseRuntimeChatDrain(providerGroupId, drainToken);
  }
  if (await getRedisConnection().llen(runtimeChatQueueKey(providerGroupId)) > 0) {
    await scheduleRuntimeChatDrain(providerGroupId);
  }
}

export async function refreshRuntimeChatDrain(providerGroupId: string, drainToken: string): Promise<boolean> {
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("expire", KEYS[1], ARGV[2])
    end
    return 0
  `;
  const result = await getRedisConnection().eval(
    script,
    1,
    runtimeChatActiveKey(providerGroupId),
    drainToken,
    String(runtimeChatDrainTtlSeconds),
  );
  return result === 1;
}

export function runtimeChatDrainJobId(providerGroupId: string): string {
  return `runtime_chat_queue_${chatQueueDigest(providerGroupId)}`;
}

export function parseRuntimeChatTask(raw: unknown): RuntimeChatTask {
  const decoded = typeof raw === "string" ? JSON.parse(raw) as unknown : raw;
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new Error("runtime chat task must be an object");
  }
  const record = decoded as Record<string, unknown>;
  const name = record.name;
  if (name !== "inbound_execution" && name !== "passive_message_analysis") {
    throw new Error("runtime chat task has invalid name");
  }
  const messageId = requiredString(record, "messageId");
  if (messageId === "__drain__") {
    throw new Error("runtime chat task cannot use drain sentinel");
  }
  const providerGroupId = requiredString(record, "providerGroupId");
  return {
    name,
    messageId,
    providerGroupId,
    reason: nullableString(record.reason),
    traceId: nullableString(record.traceId),
    enqueuedAt: requiredString(record, "enqueuedAt"),
  };
}

export async function closeQueues(): Promise<void> {
  await defaultQueue?.close();
  await redisConnection?.quit();
  defaultQueue = undefined;
  redisConnection = undefined;
}

function runtimeChatQueueKey(providerGroupId: string): string {
  return `kuuna:runtime-chat:${chatQueueDigest(providerGroupId)}:tasks`;
}

function runtimeChatActiveKey(providerGroupId: string): string {
  return `kuuna:runtime-chat:${chatQueueDigest(providerGroupId)}:active`;
}

function chatQueueDigest(providerGroupId: string): string {
  return createHash("sha256").update(providerGroupId).digest("hex").slice(0, 24);
}

async function releaseRuntimeChatDrain(providerGroupId: string, drainToken: string): Promise<void> {
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    end
    return 0
  `;
  await getRedisConnection().eval(script, 1, runtimeChatActiveKey(providerGroupId), drainToken);
}

async function scheduleRuntimeChatDrain(
  providerGroupId: string,
  options: Pick<EnqueueRuntimeChatTaskOptions, "enqueueJob" | "redis" | "tokenFactory"> = {},
): Promise<void> {
  const token = options.tokenFactory?.() ?? randomUUID();
  const redis = options.redis ?? getRedisConnection();
  const scheduled = await redis.set(runtimeChatActiveKey(providerGroupId), token, "EX", runtimeChatDrainTtlSeconds, "NX");
  if (scheduled !== "OK") return;
  const enqueue = options.enqueueJob ?? enqueueKuunaJob;
  await enqueue(
    "runtime_chat_queue",
    { provider_group_id: providerGroupId, drain_token: token },
    `${runtimeChatDrainJobId(providerGroupId)}_${chatQueueDigest(token)}`,
  );
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`runtime chat task field '${key}' must be a non-empty string`);
  }
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error("runtime chat task optional fields must be strings when provided");
  }
  return value;
}
