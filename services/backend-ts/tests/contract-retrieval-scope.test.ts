import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { retrievalChunks } from "../src/db/schema.js";
import { retrieveScopedRuntimeContext } from "../src/jobs/retrieval.js";
import { contractDatabaseUrl, createContractHarness } from "./contract-harness.js";

const skipReason = contractDatabaseUrl
  ? false
  : "set BACKEND_TS_CONTRACT_DATABASE_URL to run backend-ts contract tests";

test("contract: scoped retrieval falls back to common when private access context is incomplete", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());
  const groupA = `scope-a-${randomUUID()}@g.us`;
  const groupB = `scope-b-${randomUUID()}@g.us`;
  await seedChunk(harness, {
    scope: "common",
    providerGroupId: null,
    sourceType: "knowledge_version",
    content: "Evidence upload process for all clients.",
    metadataJson: { doc_key: "evidence-process" },
  });
  await seedChunk(harness, {
    scope: "group",
    providerGroupId: groupA,
    sourceType: "knowledge_version",
    content: "Private Group A evidence strategy.",
    metadataJson: { doc_key: "group-a" },
  });
  await seedChunk(harness, {
    scope: "group",
    providerGroupId: groupB,
    sourceType: "knowledge_version",
    content: "Private Group B evidence strategy.",
    metadataJson: { doc_key: "group-b" },
  });

  const result = await retrieveScopedRuntimeContext(harness.db, {
    query: "evidence strategy",
    limit: 10,
    access: { providerGroupId: groupA },
  });

  assert.equal(result.access.private_scopes_allowed, false);
  assert.match(result.access.fallback_reason ?? "", /missing_private_access_context/);
  assert.deepEqual(result.hits.map((hit) => hit.source_scope), ["common"]);
});

test("contract: scoped retrieval does not leak chunks from another group", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());
  const groupA = `scope-a-${randomUUID()}@g.us`;
  const groupB = `scope-b-${randomUUID()}@g.us`;
  await seedChunk(harness, {
    scope: "group",
    providerGroupId: groupA,
    sourceType: "knowledge_version",
    content: "Invoice screenshot from Group A.",
    metadataJson: { doc_key: "allowed" },
  });
  await seedChunk(harness, {
    scope: "group",
    providerGroupId: groupB,
    sourceType: "knowledge_version",
    content: "Invoice screenshot from Group B.",
    metadataJson: { doc_key: "allowed" },
  });

  const result = await retrieveScopedRuntimeContext(harness.db, {
    query: "invoice screenshot",
    limit: 10,
    toolsConfig: { knowledge: { group_doc_keys: ["allowed"], include_group_knowledge: true } },
    access: {
      providerGroupId: groupA,
      bindingId: randomUUID(),
      agentInstanceId: randomUUID(),
      senderProviderUserId: "lawyer@s.whatsapp.net",
      senderRole: "lawyer",
      primaryClientProfileId: "client-a",
      authorizedPersonalProfileIds: ["client-a"],
    },
  });

  assert.equal(result.access.private_scopes_allowed, true);
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0]?.content, "Invoice screenshot from Group A.");
});

test("contract: scoped retrieval does not leak personal chunks for another client profile", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());
  const groupA = `scope-a-${randomUUID()}@g.us`;
  await seedChunk(harness, {
    scope: "personal",
    providerGroupId: groupA,
    sourceType: "knowledge_version",
    content: "Client A personal court date.",
    metadataJson: { doc_key: "profile", client_profile_id: "client-a" },
  });
  await seedChunk(harness, {
    scope: "personal",
    providerGroupId: groupA,
    sourceType: "knowledge_version",
    content: "Client B personal court date.",
    metadataJson: { doc_key: "profile", client_profile_id: "client-b" },
  });

  const result = await retrieveScopedRuntimeContext(harness.db, {
    query: "personal court date",
    limit: 10,
    toolsConfig: { knowledge: { group_doc_keys: ["profile"], include_group_knowledge: true } },
    access: {
      providerGroupId: groupA,
      bindingId: randomUUID(),
      agentInstanceId: randomUUID(),
      senderProviderUserId: "staff@s.whatsapp.net",
      senderRole: "company_staff",
      primaryClientProfileId: "client-a",
      authorizedPersonalProfileIds: ["client-a"],
    },
  });

  assert.equal(result.access.private_scopes_allowed, true);
  assert.deepEqual(result.hits.map((hit) => hit.content), ["Client A personal court date."]);
});

test("contract: scoped retrieval enforces template doc-key filters before ranking", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());
  const groupA = `scope-a-${randomUUID()}@g.us`;
  await seedChunk(harness, {
    scope: "common",
    providerGroupId: null,
    sourceType: "knowledge_version",
    content: "Allowed evidence intake checklist.",
    metadataJson: { doc_key: "allowed-common" },
  });
  await seedChunk(harness, {
    scope: "common",
    providerGroupId: null,
    sourceType: "knowledge_version",
    content: "Denied evidence intake checklist.",
    metadataJson: { doc_key: "denied-common" },
  });
  await seedChunk(harness, {
    scope: "group",
    providerGroupId: groupA,
    sourceType: "knowledge_version",
    content: "Allowed group evidence checklist.",
    metadataJson: { doc_key: "allowed-group" },
  });
  await seedChunk(harness, {
    scope: "group",
    providerGroupId: groupA,
    sourceType: "knowledge_version",
    content: "Denied group evidence checklist.",
    metadataJson: { doc_key: "denied-group" },
  });

  const result = await retrieveScopedRuntimeContext(harness.db, {
    query: "evidence checklist",
    limit: 10,
    toolsConfig: {
      knowledge: {
        common_doc_keys: ["allowed-common"],
        group_doc_keys: ["allowed-group"],
        include_group_knowledge: true,
      },
    },
    access: {
      providerGroupId: groupA,
      bindingId: randomUUID(),
      agentInstanceId: randomUUID(),
      senderProviderUserId: "client@s.whatsapp.net",
      senderRole: "client",
      primaryClientProfileId: "client-a",
      authorizedPersonalProfileIds: ["client-a"],
    },
  });

  assert.deepEqual(
    result.hits.map((hit) => hit.content).sort(),
    ["Allowed evidence intake checklist.", "Allowed group evidence checklist."].sort(),
  );
});

async function seedChunk(
  harness: Awaited<ReturnType<typeof createContractHarness>>,
  input: {
    scope: string;
    providerGroupId: string | null;
    sourceType: string;
    content: string;
    metadataJson?: Record<string, unknown>;
  },
) {
  const [chunk] = await harness.db.insert(retrievalChunks).values({
    scope: input.scope,
    providerGroupId: input.providerGroupId,
    sourceType: input.sourceType,
    sourceId: randomUUID(),
    chunkNo: 1,
    content: input.content,
    tokenCount: input.content.split(/\s+/).length,
    embedding: "[0]",
    metadataJson: input.metadataJson ?? {},
  }).returning();
  assert.ok(chunk);
  return chunk;
}

