import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  agentInstances,
  groupBindings,
  groupTemplates,
  retrievalChunks,
  templateVersions,
} from "../src/db/schema.js";
import { searchRuntimeTool, RuntimeToolSearchError } from "../src/runtime/tool-search.js";
import { contractDatabaseUrl, createContractHarness } from "./contract-harness.js";

const skipReason = contractDatabaseUrl
  ? false
  : "set BACKEND_TS_CONTRACT_DATABASE_URL to run backend-ts contract tests";

test("contract: runtime chat search is hard-scoped to bound provider group", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());
  const own = await seedBoundRuntime(harness, {
    tools: ["chat_history_search", "knowledge_search"],
  });
  const otherGroupId = `other-${randomUUID()}@g.us`;

  await harness.db.insert(retrievalChunks).values([
    {
      scope: "conversation",
      providerGroupId: own.providerGroupId,
      sourceType: "message",
      sourceId: randomUUID(),
      chunkNo: 1,
      content: "Invoice screenshot was uploaded yesterday.",
      tokenCount: 5,
      embedding: null,
      embeddingVector: null,
      metadataJson: { provider_message_id: "own-message" },
    },
    {
      scope: "conversation",
      providerGroupId: otherGroupId,
      sourceType: "message",
      sourceId: randomUUID(),
      chunkNo: 1,
      content: "Invoice screenshot from a different WhatsApp group.",
      tokenCount: 7,
      embedding: null,
      embeddingVector: null,
      metadataJson: { provider_message_id: "other-message" },
    },
  ]);

  const result = await searchRuntimeTool(harness.db, {
    tool_name: "chat_history_search",
    query: "invoice screenshot",
    limit: 8,
    context: {
      provider_group_id: own.providerGroupId,
      binding_id: own.bindingId,
      agent_instance_id: own.agentInstanceId,
      sender_provider_user_id: "user@s.whatsapp.net",
    },
  });

  assert.equal(result.tool_name, "chat_history_search");
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0]?.provider_message_id, "own-message");
});

test("contract: runtime search rejects identity mismatch and template-denied tools", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());
  const own = await seedBoundRuntime(harness, {
    tools: ["knowledge_search"],
  });

  await assert.rejects(
    () =>
      searchRuntimeTool(harness.db, {
        tool_name: "knowledge_search",
        query: "anything",
        context: {
          provider_group_id: `wrong-${randomUUID()}@g.us`,
          binding_id: own.bindingId,
          agent_instance_id: own.agentInstanceId,
        },
      }),
    (error) =>
      error instanceof RuntimeToolSearchError &&
      error.statusCode === 403 &&
      /provider_group_id mismatch/.test(error.message),
  );

  await assert.rejects(
    () =>
      searchRuntimeTool(harness.db, {
        tool_name: "chat_history_search",
        query: "anything",
        context: {
          provider_group_id: own.providerGroupId,
          binding_id: own.bindingId,
          agent_instance_id: own.agentInstanceId,
        },
      }),
    (error) =>
      error instanceof RuntimeToolSearchError &&
      error.statusCode === 403 &&
      /not allowed by template/.test(error.message),
  );
});

async function seedBoundRuntime(
  harness: Awaited<ReturnType<typeof createContractHarness>>,
  input: { tools: string[] },
) {
  const providerGroupId = `runtime-tool-${randomUUID()}@g.us`;
  const [template] = await harness.db
    .insert(groupTemplates)
    .values({ key: `runtime-tool-${randomUUID()}`, displayName: "Runtime Tool Template" })
    .returning();
  assert.ok(template);
  const [version] = await harness.db
    .insert(templateVersions)
    .values({
      templateId: template.id,
      versionNo: 1,
      status: "published",
      systemPrompt: "Search safely.",
      modelConfig: {},
      toolsConfig: { tools: input.tools },
      egressPolicy: {},
    })
    .returning();
  assert.ok(version);
  const [binding] = await harness.db
    .insert(groupBindings)
    .values({ providerGroupId, templateVersionId: version.id, status: "active" })
    .returning();
  assert.ok(binding);
  const [agentInstance] = await harness.db
    .insert(agentInstances)
    .values({
      groupBindingId: binding.id,
      runtimeMode: "on_demand",
      status: "healthy",
      runtimeBaseUrl: "http://runtime.test",
    })
    .returning();
  assert.ok(agentInstance);
  return {
    providerGroupId,
    bindingId: binding.id,
    agentInstanceId: agentInstance.id,
  };
}
