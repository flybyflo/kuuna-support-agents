import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  groupTemplates,
  mediaAssets,
  messages,
  messageVersions,
  runtimeRuns,
  templateVersions,
} from "../src/db/schema.js";
import { contractDatabaseUrl, createContractHarness } from "./contract-harness.js";

const skipReason = contractDatabaseUrl
  ? false
  : "set BACKEND_TS_CONTRACT_DATABASE_URL to run backend-ts contract tests";

async function login(
  harness: Awaited<ReturnType<typeof createContractHarness>>,
  input: { email: string; password: string },
): Promise<string> {
  const publicCaller = await harness.caller();
  const result = await publicCaller.auth.login(input);
  return result.access_token;
}

test("contract: publishVersion returns mapped JSON response shape", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());

  await harness.seedUser({ email: "owner@example.com", password: "OwnerSecure123!", role: "owner" });
  const token = await login(harness, { email: "owner@example.com", password: "OwnerSecure123!" });
  const caller = await harness.caller(token);

  const [template] = await harness.db
    .insert(groupTemplates)
    .values({ key: `template-${randomUUID()}`, displayName: "Review Template" })
    .returning();
  assert.ok(template);
  const [version] = await harness.db
    .insert(templateVersions)
    .values({
      templateId: template.id,
      versionNo: 1,
      status: "draft",
      systemPrompt: "System",
      modelConfig: { model: "gpt-5.5" },
      toolsConfig: {},
      egressPolicy: {},
    })
    .returning();
  assert.ok(version);

  const published = await caller.templates.publishVersion({ templateId: template.id, versionId: version.id });

  assert.equal(published.id, version.id);
  assert.equal(published.template_id, template.id);
  assert.equal(published.version_no, 1);
  assert.equal(published.status, "published");
  assert.equal(published.system_prompt, "System");
  assert.equal(typeof published.created_at, "string");
  assert.equal(typeof published.updated_at, "string");
});

test("contract: internal runtimeRuns requires owner or admin role", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());

  await harness.seedUser({
    email: "operator@example.com",
    password: "OperatorSecure123!",
    role: "operator",
    groupScope: ["group-a@g.us"],
  });
  await harness.seedUser({ email: "admin@example.com", password: "AdminSecure123!", role: "admin" });

  await harness.db.insert(runtimeRuns).values({
    providerGroupId: "group-a@g.us",
    messageId: randomUUID(),
    bindingId: randomUUID(),
    templateVersionId: randomUUID(),
    imageRef: "kuuna/template:test",
    status: "succeeded",
    startedAt: new Date(),
    execution: {},
  });

  const operatorToken = await login(harness, { email: "operator@example.com", password: "OperatorSecure123!" });
  const operatorCaller = await harness.caller(operatorToken);
  await assert.rejects(
    () => operatorCaller.internal.runtimeRuns({ limit: 10 }),
    /insufficient role/,
  );

  const adminToken = await login(harness, { email: "admin@example.com", password: "AdminSecure123!" });
  const adminCaller = await harness.caller(adminToken);
  const rows = await adminCaller.internal.runtimeRuns({ limit: 10 });
  assert.equal(rows.length, 1);
});

test("contract: messages list includes latest preview and media flag", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());

  await harness.seedUser({ email: "operator@example.com", password: "OperatorSecure123!", role: "operator", groupScope: ["group-a@g.us"] });
  const token = await login(harness, { email: "operator@example.com", password: "OperatorSecure123!" });
  const caller = await harness.caller(token);

  const [message] = await harness.db
    .insert(messages)
    .values({
      providerGroupId: "group-a@g.us",
      providerMessageId: "msg-media",
      senderProviderUserId: "sender@s.whatsapp.net",
      latestVersionNo: 2,
    })
    .returning();
  assert.ok(message);
  await harness.db.insert(messageVersions).values([
    {
      messageId: message.id,
      versionNo: 1,
      eventType: "message_created",
      isDeleted: false,
      textContent: "old text",
      rawEvent: {},
      occurredAt: new Date(),
    },
    {
      messageId: message.id,
      versionNo: 2,
      eventType: "message_edited",
      isDeleted: false,
      textContent: "latest text",
      rawEvent: { sender_phone: "+491234", sender_push_name: "Felix" },
      occurredAt: new Date(),
    },
  ]);
  await harness.db.insert(mediaAssets).values({
    messageId: message.id,
    providerMediaId: "media-1",
    mimeType: "image/png",
    fileName: "proof.png",
    status: "ready",
  });

  const rows = await caller.messages.list({ providerGroupId: "group-a@g.us", limit: 100 });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.latest_text, "latest text");
  assert.equal(rows[0]?.latest_is_deleted, false);
  assert.equal(rows[0]?.has_media, true);
  assert.deepEqual(rows[0]?.latest_raw_event, { sender_phone: "+491234", sender_push_name: "Felix" });
});
