import { Worker, type Job } from "bullmq";

import { db } from "../db/client.js";
import { logger } from "../logging.js";
import {
  closeQueues,
  completeRuntimeChatDrain,
  getRedisConnection,
  parseRuntimeChatTask,
  peekRuntimeChatTask,
  refreshRuntimeChatDrain,
  removeProcessedRuntimeChatTask,
  scheduleTodoExportJob,
  type KuunaJobName,
  type RuntimeChatTask,
} from "./queues.js";
import { processKnowledgeIndexingJob } from "./knowledge-indexing.js";
import { processMediaAssetJob } from "./media-processing.js";
import { processOutboundDispatchJob } from "./outbound-dispatch.js";
import { processRetrievalIndexingJob } from "./retrieval-indexing.js";
import { processInboundExecutionJob, processPassiveMessageAnalysisJob } from "./runtime-execution.js";
import { processTemplateBuildJob } from "./template-build.js";
import { processTodoExportJob } from "./todo-export.js";

type Handler = (job: Job<Record<string, unknown>, unknown, KuunaJobName>) => Promise<unknown>;

const handlers: Record<KuunaJobName, Handler> = {
  media_processing: async (job) => processMediaJob(job),
  outbound_dispatch: async (job) => processOutboundJob(job),
  template_build: async (job) => processTemplateBuild(job),
  knowledge_indexing: async (job) => processKnowledgeJob(job),
  retrieval_indexing: async (job) => processRetrievalJob(job),
  runtime_chat_queue: async (job) => processRuntimeChatQueueJob(job),
  todo_export: async (job) => processTodoExport(job),
};

async function processOutboundJob(job: Job<Record<string, unknown>, unknown, KuunaJobName>) {
  const outboundIntentId = stringField(job.data, "outbound_intent_id");
  return processOutboundDispatchJob(
    db,
    { outboundIntentId },
    {
      retryAvailable: retryAvailable(job),
      retryInSeconds: retryDelaySeconds(job),
    },
  );
}

async function processMediaJob(job: Job<Record<string, unknown>, unknown, KuunaJobName>) {
  const mediaAssetId = stringField(job.data, "media_asset_id");
  const traceId = optionalStringField(job.data, "trace_id");
  return processMediaAssetJob(db, { mediaAssetId, traceId });
}

async function processKnowledgeJob(job: Job<Record<string, unknown>, unknown, KuunaJobName>) {
  const knowledgeVersionId = stringField(job.data, "knowledge_version_id");
  const traceId = optionalStringField(job.data, "trace_id");
  return db.transaction((tx) => processKnowledgeIndexingJob(tx, { knowledgeVersionId, traceId }));
}

async function processRetrievalJob(job: Job<Record<string, unknown>, unknown, KuunaJobName>) {
  const sourceType = stringField(job.data, "source_type");
  const sourceId = stringField(job.data, "source_id");
  const traceId = optionalStringField(job.data, "trace_id");
  return db.transaction((tx) => processRetrievalIndexingJob(tx, { sourceType, sourceId, traceId }));
}

async function processTodoExport(job: Job<Record<string, unknown>, unknown, KuunaJobName>) {
  const limit = optionalNumberField(job.data, "limit");
  const providerGroupId = optionalStringField(job.data, "provider_group_id");
  return processTodoExportJob(db, { limit: limit ?? undefined, providerGroupId });
}

async function processTemplateBuild(job: Job<Record<string, unknown>, unknown, KuunaJobName>) {
  const buildId = stringField(job.data, "build_id");
  return processTemplateBuildJob(db, { buildId });
}

async function processRuntimeChatQueueJob(job: Job<Record<string, unknown>, unknown, KuunaJobName>) {
  const providerGroupId = stringField(job.data, "provider_group_id");
  const inlineTask = job.data.queued_task === undefined ? null : parseRuntimeChatTask(job.data.queued_task);
  if (inlineTask) {
    return processRuntimeChatTask(inlineTask);
  }

  const drainToken = optionalStringField(job.data, "drain_token");
  let processed = 0;
  const refreshTimer = startRuntimeChatDrainRefresh(providerGroupId, drainToken);
  try {
    for (;;) {
      const task = await peekRuntimeChatTask(providerGroupId);
      if (!task) break;
      if (task.providerGroupId !== providerGroupId) {
        throw new Error("runtime chat task provider group mismatch");
      }
      await processRuntimeChatTask(task);
      await removeProcessedRuntimeChatTask(providerGroupId);
      processed += 1;
    }
    return { processed };
  } finally {
    if (refreshTimer) {
      clearInterval(refreshTimer);
    }
    await completeRuntimeChatDrain(providerGroupId, drainToken);
  }
}

function startRuntimeChatDrainRefresh(providerGroupId: string, drainToken: string | null): ReturnType<typeof setInterval> | null {
  if (!drainToken) return null;
  const timer = setInterval(() => {
    void refreshRuntimeChatDrain(providerGroupId, drainToken).catch((error: unknown) => {
      logger.warn("runtime_chat_drain_refresh_failed", {
        provider_group_id: providerGroupId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, 60_000);
  timer.unref();
  return timer;
}

async function processRuntimeChatTask(task: RuntimeChatTask) {
  if (task.name === "inbound_execution") {
    return processInboundExecutionJob(db, {
      messageId: task.messageId,
      providerGroupId: task.providerGroupId,
      reason: task.reason,
      traceId: task.traceId,
    });
  }
  return processPassiveMessageAnalysisJob(db, {
    messageId: task.messageId,
    providerGroupId: task.providerGroupId,
    reason: task.reason,
    traceId: task.traceId,
  });
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

function optionalNumberField(data: Record<string, unknown>, key: string): number | null {
  const value = data[key];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`job field '${key}' must be a finite number when provided`);
  }
  return value;
}

function retryAvailable(job: Job<Record<string, unknown>, unknown, KuunaJobName>): boolean {
  const attempts = typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
  return job.attemptsMade + 1 < attempts;
}

function retryDelaySeconds(job: Job<Record<string, unknown>, unknown, KuunaJobName>): number | null {
  const backoff = job.opts.backoff;
  if (backoff && typeof backoff === "object" && "delay" in backoff && typeof backoff.delay === "number") {
    return Math.round(backoff.delay / 1000);
  }
  return null;
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
  await scheduleTodoExportJob();
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
