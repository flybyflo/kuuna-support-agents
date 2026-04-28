import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { getSettings } from "../config.js";

export const redisConnection = new Redis(getSettings().REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const defaultQueue = new Queue("default", {
  connection: redisConnection,
});

export type KuunaJobName =
  | "media_processing"
  | "inbound_execution"
  | "outbound_dispatch"
  | "template_build"
  | "knowledge_indexing"
  | "retrieval_indexing"
  | "passive_message_analysis"
  | "todo_export";

export async function enqueueKuunaJob(
  name: KuunaJobName,
  data: Record<string, unknown>,
  jobId?: string,
): Promise<string> {
  const job = await defaultQueue.add(name, data, {
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
  await defaultQueue.close();
  await redisConnection.quit();
}
