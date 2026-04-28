import assert from "node:assert/strict";
import test from "node:test";

import {
  enqueueRuntimeChatTask,
  parseRuntimeChatTask,
  runtimeChatDrainJobId,
  type EnqueueRuntimeChatTaskOptions,
  type KuunaJobName,
} from "../src/jobs/queues.js";

test("enqueueRuntimeChatTask appends to the per-chat Redis queue and schedules one drain job", async () => {
  const jobs: Array<{ name: KuunaJobName; data: Record<string, unknown>; jobId?: string }> = [];
  const queuedTasks: string[] = [];
  const redis: NonNullable<EnqueueRuntimeChatTaskOptions["redis"]> = {
    async rpush(_key, value) {
      queuedTasks.push(value);
      return queuedTasks.length;
    },
    async set() {
      return "OK";
    },
  };

  const jobId = await enqueueRuntimeChatTask(
    {
      name: "inbound_execution",
      messageId: "message-1",
      providerGroupId: "group-a@g.us",
      reason: "mention",
      traceId: "trace-1",
    },
    {
      redis,
      tokenFactory: () => "drain-token",
      enqueueJob: async (name, data, queuedJobId) => {
        jobs.push({ name, data, jobId: queuedJobId });
        return queuedJobId ?? name;
      },
    },
  );

  assert.equal(jobId, runtimeChatDrainJobId("group-a@g.us"));
  assert.equal(queuedTasks.length, 1);
  assert.deepEqual(parseRuntimeChatTask(queuedTasks[0]), {
    name: "inbound_execution",
    messageId: "message-1",
    providerGroupId: "group-a@g.us",
    reason: "mention",
    traceId: "trace-1",
    enqueuedAt: parseRuntimeChatTask(queuedTasks[0]).enqueuedAt,
  });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.name, "runtime_chat_queue");
  assert.equal(jobs[0]?.data.provider_group_id, "group-a@g.us");
  assert.equal(jobs[0]?.data.drain_token, "drain-token");
  assert.match(jobs[0]?.jobId ?? "", new RegExp(`^${runtimeChatDrainJobId("group-a@g.us")}_`));
  assert.equal(jobs[0]?.data.queued_task, undefined);
});

test("runtimeChatDrainJobId is stable per provider group", () => {
  assert.equal(runtimeChatDrainJobId("group-a@g.us"), runtimeChatDrainJobId("group-a@g.us"));
  assert.notEqual(runtimeChatDrainJobId("group-a@g.us"), runtimeChatDrainJobId("group-b@g.us"));
});

test("parseRuntimeChatTask rejects invalid task names", () => {
  assert.throws(
    () =>
      parseRuntimeChatTask({
        name: "outbound_dispatch",
        messageId: "message-1",
        providerGroupId: "group-a@g.us",
        enqueuedAt: new Date().toISOString(),
      }),
    /invalid name/,
  );
});
