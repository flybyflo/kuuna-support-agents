import { Worker, type Job } from "bullmq";

import { db } from "../db/client.js";
import { logger } from "../logging.js";
import { closeQueues, getRedisConnection, type KuunaJobName } from "./queues.js";
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
  inbound_execution: async (job) => processInboundJob(job),
  outbound_dispatch: async (job) => processOutboundJob(job),
  template_build: async (job) => processTemplateBuild(job),
  knowledge_indexing: async (job) => processKnowledgeJob(job),
  retrieval_indexing: async (job) => processRetrievalJob(job),
  passive_message_analysis: async (job) => processPassiveAnalysisJob(job),
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

async function processInboundJob(job: Job<Record<string, unknown>, unknown, KuunaJobName>) {
  const messageId = stringField(job.data, "message_id");
  const providerGroupId = stringField(job.data, "provider_group_id");
  const reason = optionalStringField(job.data, "reason");
  const traceId = optionalStringField(job.data, "trace_id");
  return processInboundExecutionJob(db, { messageId, providerGroupId, reason, traceId });
}

async function processPassiveAnalysisJob(job: Job<Record<string, unknown>, unknown, KuunaJobName>) {
  const messageId = stringField(job.data, "message_id");
  const providerGroupId = stringField(job.data, "provider_group_id");
  const reason = optionalStringField(job.data, "reason");
  const traceId = optionalStringField(job.data, "trace_id");
  return processPassiveMessageAnalysisJob(db, { messageId, providerGroupId, reason, traceId });
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
