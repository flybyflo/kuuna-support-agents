import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { eq } from "drizzle-orm";

import {
  agentInstances,
  agentRuns,
  groupBindings,
  groupTemplates,
  mediaAssets,
  messageDecisions,
  messages,
  messageVersions,
  outboundIntents,
  templateVersions,
  todos,
  toolInvocations,
  transcripts,
} from "../src/db/schema.js";
import { resetSettingsForTests } from "../src/config.js";
import { processInboundExecutionJob, processPassiveMessageAnalysisJob } from "../src/jobs/runtime-execution.js";
import { RuntimeProvisioningError } from "../src/runtime/provisioning.js";
import { contractDatabaseUrl, createContractHarness } from "./contract-harness.js";

const skipReason = contractDatabaseUrl
  ? false
  : "set BACKEND_TS_CONTRACT_DATABASE_URL to run backend-ts contract tests";

test("contract: passive message analysis persists agent run, tool invocation, todo and decision", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());
  const seeded = await seedRuntimeScenario(harness, { messageText: "Please follow up on missing invoice screenshots" });
  const [asset] = await harness.db.insert(mediaAssets).values({
    messageId: seeded.messageId,
    providerMediaId: "media-passive",
    mimeType: "image/jpeg",
    status: "ready",
    metadataJson: { preview_url: "data:image/jpeg;base64,aGVsbG8=" },
  }).returning();
  assert.ok(asset);

  const result = await processPassiveMessageAnalysisJob(
    harness.db,
    {
      messageId: seeded.messageId,
      providerGroupId: seeded.providerGroupId,
      reason: "message_received",
      traceId: "trace-passive",
    },
    {
      enqueueJob: async (name, data, jobId) => {
        harness.jobs.push({ name, data, jobId });
        return jobId ?? name;
      },
      runtimeAgentCaller: async () => ({
          success: true,
          prompt: "prompt",
          system_prompt: "system",
          user_prompt: "user",
          reasoning_effort: "medium",
          model_used: "gpt-5.5",
          attempts: [{ model: "gpt-5.5", success: true }],
          response_text: "{\"decision\":\"todo\"}",
          tool_results: [
            {
              name: "todo_create",
              ok: true,
              stdout: "{\"title\":\"Collect invoice screenshots\",\"priority\":\"high\"}",
              stderr: "",
              timed_out: false,
              duration_ms: 12,
              details: { title: "Collect invoice screenshots", priority: "high", description: "Ask client for screenshots." },
            },
          ],
          media_insights: [
            {
              media_asset_id: asset.id,
              mime_type: "image/jpeg",
              kind: "image",
              status: "ready",
              summary: "Invoice screenshot for staff review.",
              transcript: "Invoice screenshot for staff review.",
            },
          ],
          error: null,
        }),
    },
  );

  assert.deepEqual(result, { processed: true, status: "analyzed" });
  const [run] = await harness.db.select().from(agentRuns).where(eq(agentRuns.traceId, "trace-passive")).limit(1);
  assert.ok(run);
  assert.equal(run.status, "succeeded");
  assert.equal(run.modelUsed, "gpt-5.5");

  const [todo] = await harness.db.select().from(todos).where(eq(todos.agentRunId, run.id)).limit(1);
  assert.ok(todo);
  assert.equal(todo.title, "Collect invoice screenshots");
  assert.equal(todo.priority, "high");

  const [invocation] = await harness.db.select().from(toolInvocations).where(eq(toolInvocations.agentRunId, run.id)).limit(1);
  assert.ok(invocation);
  assert.equal(invocation.toolName, "todo_create");
  assert.equal(invocation.ok, true);

  const [transcript] = await harness.db.select().from(transcripts).where(eq(transcripts.mediaAssetId, asset.id)).limit(1);
  assert.ok(transcript);
  assert.equal(transcript.textContent, "Invoice screenshot for staff review.");
  assert.equal(harness.jobs.some((job) => job.name === "retrieval_indexing"), true);

  const [decision] = await harness.db.select().from(messageDecisions).where(eq(messageDecisions.messageId, seeded.messageId)).limit(1);
  assert.ok(decision);
  assert.equal(decision.decisionType, "passive_analysis");
  assert.equal((decision.payload as Record<string, unknown>).created_todo_count, 1);
});

test("contract: inbound execution creates outbound intent and dispatch job", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());
  const seeded = await seedRuntimeScenario(harness, { messageText: "@agent help with my tax form" });

  const result = await processInboundExecutionJob(
    harness.db,
    {
      messageId: seeded.messageId,
      providerGroupId: seeded.providerGroupId,
      reason: "mention",
      traceId: "trace-inbound",
    },
    {
      enqueueJob: async (name, data, jobId) => {
        harness.jobs.push({ name, data, jobId });
        return jobId ?? name;
      },
      runtimeAgentCaller: async () => ({
          success: true,
          prompt: "prompt",
          system_prompt: "system",
          user_prompt: "user",
          reasoning_effort: "medium",
          model_used: "gpt-5.5",
          attempts: [{ model: "gpt-5.5", success: true }],
          response_text: "Please upload the tax form and I will review it.",
          tool_results: [],
          media_insights: [],
          error: null,
        }),
    },
  );

  assert.deepEqual(result, { processed: true, status: "enqueued" });
  const [intent] = await harness.db.select().from(outboundIntents).where(eq(outboundIntents.providerGroupId, seeded.providerGroupId)).limit(1);
  assert.ok(intent);
  assert.equal(intent.status, "pending");
  const payload = intent.payload as Record<string, unknown>;
  assert.equal(payload.reply_to_provider_message_id, seeded.providerMessageId);
  assert.equal(payload.text, "Please upload the tax form and I will review it.");
  assert.equal(harness.jobs[0]?.name, "outbound_dispatch");
  assert.deepEqual(harness.jobs[0]?.data, { outbound_intent_id: intent.outboundIntentId });
  assert.equal(harness.jobs[0]?.jobId, `outbound_dispatch_${intent.outboundIntentId.replaceAll("-", "_")}`);
});

test("contract: inbound execution invalid or unbound message is skipped without mutation", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());

  assert.deepEqual(
    await processInboundExecutionJob(harness.db, { messageId: "bad", providerGroupId: "group@g.us" }),
    { processed: false, status: "invalid" },
  );

  const [message] = await harness.db
    .insert(messages)
    .values({ providerGroupId: "unbound@g.us", providerMessageId: "msg-unbound", latestVersionNo: 1 })
    .returning();
  assert.ok(message);
  await harness.db.insert(messageVersions).values({
    messageId: message.id,
    versionNo: 1,
    eventType: "message_created",
    isDeleted: false,
    textContent: "hello",
    rawEvent: {},
    occurredAt: new Date(),
  });

  assert.deepEqual(
    await processInboundExecutionJob(harness.db, { messageId: message.id, providerGroupId: "unbound@g.us" }),
    { processed: false, status: "skipped" },
  );
  assert.equal((await harness.db.select().from(outboundIntents)).length, 0);
});

test("contract: inbound execution provisions strict per-chat runtime", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());
  const seeded = await seedRuntimeScenario(harness, { messageText: "@agent use my isolated runtime" });
  const provisioned: string[] = [];

  const result = await processInboundExecutionJob(
    harness.db,
    {
      messageId: seeded.messageId,
      providerGroupId: seeded.providerGroupId,
      reason: "mention",
      traceId: "trace-provisioned",
    },
    {
      enqueueJob: async (name, data, jobId) => {
        harness.jobs.push({ name, data, jobId });
        return jobId ?? name;
      },
      runtimeProvisioner: async (_database, input) => {
        provisioned.push(`${input.providerGroupId}:${input.messageId}`);
        return {
          containerId: "container-chat",
          containerName: "kuuna-runtime-chat",
          runtimeBaseUrl: "http://kuuna-runtime-chat:8100",
          dockerNetwork: "kuuna-dev_default",
        };
      },
      runtimeAgentCaller: async (runtimeBaseUrl, request) => {
        assert.equal(runtimeBaseUrl, "http://kuuna-runtime-chat:8100");
        assert.equal(request.context.provider_group_id, seeded.providerGroupId);
        assert.equal(request.context.binding_id, seeded.bindingId);
        assert.equal(request.context.agent_instance_id, seeded.agentInstanceId);
        return {
          success: true,
          prompt: "prompt",
          system_prompt: "system",
          user_prompt: "user",
          reasoning_effort: "medium",
          model_used: "gpt-5.5",
          attempts: [{ model: "gpt-5.5", success: true }],
          response_text: "I am isolated.",
          tool_results: [],
          media_insights: [],
          error: null,
        };
      },
    },
  );

  assert.deepEqual(result, { processed: true, status: "enqueued" });
  assert.deepEqual(provisioned, [`${seeded.providerGroupId}:${seeded.messageId}`]);
});

test("contract: provisioning failure fails run without fallback", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());
  const seeded = await seedRuntimeScenario(harness, { messageText: "@agent do not use fallback" });
  let runtimeCalled = false;

  const result = await processInboundExecutionJob(
    harness.db,
    {
      messageId: seeded.messageId,
      providerGroupId: seeded.providerGroupId,
      reason: "mention",
      traceId: "trace-provisioning-failed",
    },
    {
      runtimeProvisioner: async () => {
        throw new RuntimeProvisioningError("runtime_container_identity_mismatch", "wrong chat container");
      },
      runtimeAgentCaller: async () => {
        runtimeCalled = true;
        throw new Error("should not call runtime agent");
      },
    },
  );

  assert.deepEqual(result, { processed: false, status: "skipped" });
  assert.equal(runtimeCalled, false);
  const [run] = await harness.db.select().from(agentRuns).where(eq(agentRuns.traceId, "trace-provisioning-failed")).limit(1);
  assert.ok(run);
  assert.equal(run.status, "failed");
  assert.match(run.error ?? "", /wrong chat container/);
  const intents = await harness.db.select().from(outboundIntents).where(eq(outboundIntents.providerGroupId, seeded.providerGroupId));
  assert.equal(intents.length, 0);
});

async function seedRuntimeScenario(
  harness: Awaited<ReturnType<typeof createContractHarness>>,
  input: { messageText: string },
) {
  const providerGroupId = `runtime-${randomUUID()}@g.us`;
  const providerMessageId = `msg-${randomUUID()}`;
  const [template] = await harness.db
    .insert(groupTemplates)
    .values({ key: `runtime-${randomUUID()}`, displayName: "Runtime Template" })
    .returning();
  assert.ok(template);
  const [version] = await harness.db
    .insert(templateVersions)
    .values({
      templateId: template.id,
      versionNo: 1,
      status: "published",
      systemPrompt: "You are a support assistant.",
      modelConfig: { model: "gpt-5.5", reasoning_effort: "medium" },
      toolsConfig: { tools: ["todo_create", "todo_list", "knowledge_search", "message_history"] },
      egressPolicy: {},
    })
    .returning();
  assert.ok(version);
  const [binding] = await harness.db
    .insert(groupBindings)
    .values({ providerGroupId, templateVersionId: version.id, status: "active" })
    .returning();
  assert.ok(binding);
  const [agentInstance] = await harness.db.insert(agentInstances).values({
    groupBindingId: binding.id,
    runtimeMode: "on_demand",
    status: "healthy",
    runtimeBaseUrl: "http://runtime.test",
  }).returning();
  assert.ok(agentInstance);
  const [message] = await harness.db
    .insert(messages)
    .values({
      providerGroupId,
      providerMessageId,
      senderProviderUserId: "user@s.whatsapp.net",
      latestVersionNo: 1,
    })
    .returning();
  assert.ok(message);
  await harness.db.insert(messageVersions).values({
    messageId: message.id,
    versionNo: 1,
    eventType: "message_created",
    isDeleted: false,
    textContent: input.messageText,
    rawEvent: {},
    occurredAt: new Date(),
  });
  return { providerGroupId, providerMessageId, messageId: message.id, bindingId: binding.id, agentInstanceId: agentInstance.id };
}
