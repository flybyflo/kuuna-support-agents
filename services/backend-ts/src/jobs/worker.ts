import { Worker, type Job } from "bullmq";

import { db } from "../db/client.js";
import { logger } from "../logging.js";
import { closeQueues, getRedisConnection, type KuunaJobName } from "./queues.js";
import { processRetrievalIndexingJob } from "./retrieval-indexing.js";

type Handler = (job: Job<Record<string, unknown>, unknown, KuunaJobName>) => Promise<unknown>;

const handlers: Record<KuunaJobName, Handler> = {
  media_processing: async (job) => recordDeferredJob(job),
  inbound_execution: async (job) => recordDeferredJob(job),
  outbound_dispatch: async (job) => recordDeferredJob(job),
  template_build: async (job) => recordDeferredJob(job),
  knowledge_indexing: async (job) => recordDeferredJob(job),
  retrieval_indexing: async (job) => processRetrievalJob(job),
  passive_message_analysis: async (job) => recordDeferredJob(job),
  todo_export: async (job) => recordDeferredJob(job),
};

async function processRetrievalJob(job: Job<Record<string, unknown>, unknown, KuunaJobName>) {
  const sourceType = stringField(job.data, "source_type");
  const sourceId = stringField(job.data, "source_id");
  const traceId = optionalStringField(job.data, "trace_id");
  return db.transaction((tx) => processRetrievalIndexingJob(tx, { sourceType, sourceId, traceId }));
}

async function recordDeferredJob(job: Job<Record<string, unknown>, unknown, KuunaJobName>) {
  logger.warn("backend_ts_job_deferred_to_python_parity_work", {
    job_id: job.id,
    job_name: job.name,
    data: job.data,
  });
  return { deferred: true, job_name: job.name };
}

function stringField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`job field '${key}' must be a non-empty string`);
  }
  return value;
}

function optionalStringField(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`job field '${key}' must be a string when provided`);
  }
  return value;
}

export function createDefaultWorker(): Worker<Record<string, unknown>, unknown, KuunaJobName> {
  const worker = new Worker<Record<string, unknown>, unknown, KuunaJobName>(
    "default",
    async (job) => {
      const handler = handlers[job.name];
      if (!handler) {
        throw new Error(`unsupported job '${job.name}'`);
      }
      return handler(job);
    },
    {
      connection: getRedisConnection(),
    },
  );

  worker.on("completed", (job) => {
    logger.info("backend_ts_job_completed", { job_id: job.id, job_name: job.name });
  });
  worker.on("failed", (job, error) => {
    logger.error("backend_ts_job_failed", {
      job_id: job?.id,
      job_name: job?.name,
      error: error.message,
    });
  });

  return worker;
}

export async function runWorker(): Promise<void> {
  const worker = createDefaultWorker();
  logger.info("backend_ts_worker_started", { queue: "default" });

  const shutdown = async () => {
    await worker.close();
    await closeQueues();
  };

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runWorker().catch((error) => {
    logger.error("backend_ts_worker_boot_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
