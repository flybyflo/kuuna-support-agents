import { Worker, type Job } from "bullmq";

import { logger } from "../logging.js";
import { redisConnection, type KuunaJobName } from "./queues.js";

type Handler = (job: Job<Record<string, unknown>, unknown, KuunaJobName>) => Promise<unknown>;

const handlers: Record<KuunaJobName, Handler> = {
  media_processing: async (job) => recordDeferredJob(job),
  inbound_execution: async (job) => recordDeferredJob(job),
  outbound_dispatch: async (job) => recordDeferredJob(job),
  template_build: async (job) => recordDeferredJob(job),
  knowledge_indexing: async (job) => recordDeferredJob(job),
  retrieval_indexing: async (job) => recordDeferredJob(job),
  passive_message_analysis: async (job) => recordDeferredJob(job),
  todo_export: async (job) => recordDeferredJob(job),
};

async function recordDeferredJob(job: Job<Record<string, unknown>, unknown, KuunaJobName>) {
  logger.warn("backend_ts_job_deferred_to_python_parity_work", {
    job_id: job.id,
    job_name: job.name,
    data: job.data,
  });
  return { deferred: true, job_name: job.name };
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
      connection: redisConnection,
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
    await redisConnection.quit();
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
