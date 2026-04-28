import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { getSettings } from "../config.js";

export type KuunaJobName =
  | "media_processing"
  | "inbound_execution"
  | "outbound_dispatch"
  | "template_build"
  | "knowledge_indexing"
  | "retrieval_indexing"
  | "passive_message_analysis"
  | "todo_export";

export type EnqueueKuunaJob = (
  name: KuunaJobName,
  data: Record<string, unknown>,
  jobId?: string,
) => Promise<string>;

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

export async function closeQueues(): Promise<void> {
  await defaultQueue?.close();
  await redisConnection?.quit();
  defaultQueue = undefined;
  redisConnection = undefined;
}
