import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { eq } from "drizzle-orm";

import { auditEvents, groupTemplates, templateBuilds, templateVersions } from "../src/db/schema.js";
import { processTemplateBuildJob } from "../src/jobs/template-build.js";
import { contractDatabaseUrl, createContractHarness } from "./contract-harness.js";

const skipReason = contractDatabaseUrl
  ? false
  : "set BACKEND_TS_CONTRACT_DATABASE_URL to run backend-ts contract tests";

test("contract: template build tRPC queues published version", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());

  const actor = await harness.seedUser({ email: "builder@example.com", password: "LongPassword123!", role: "admin" });
  const login = await (await harness.caller()).auth.login({ email: "builder@example.com", password: "LongPassword123!" });
  const caller = await harness.caller(login.access_token);
  const seeded = await seedTemplate(harness, { status: "published" });

  const body = await caller.templates.queueBuild({
    templateId: seeded.templateId,
    versionId: seeded.versionId,
    actorUserId: actor.id,
    baseImage: "alpine-3.23",
    allowedTools: [" Search ", "TODO_CREATE"],
    dockerfileSnippet: "apk add --no-cache jq",
    piBashEnabled: true,
    piBashAllowlist: [" jq ", "PYTHON"],
  });

  assert.equal(body.template_id, seeded.templateId);
  assert.equal(body.template_version_id, seeded.versionId);
  assert.equal(body.status, "queued");
  assert.equal((body.build_inputs as Record<string, unknown>).base_image, "alpine-3.23");
  assert.deepEqual((body.build_inputs as Record<string, unknown>).allowed_tools, ["search", "todo_create"]);
  assert.equal((body.build_inputs as Record<string, unknown>).setup_script, "apk add --no-cache jq");
  assert.equal((body.build_inputs as Record<string, unknown>).pi_bash_enabled, true);
  assert.deepEqual((body.build_inputs as Record<string, unknown>).pi_bash_allowlist, ["jq", "python"]);

  assert.equal(harness.jobs.length, 1);
  assert.equal(harness.jobs[0]?.name, "template_build");
  assert.deepEqual(harness.jobs[0]?.data, { build_id: body.id });
  assert.equal(harness.jobs[0]?.jobId, `template_build_${String(body.id).replaceAll("-", "_")}`);

  const [event] = await harness.db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.eventType, "template_build.queued"))
    .limit(1);
  assert.ok(event);
  assert.equal(event.actorUserId, actor.id);
  assert.equal(event.entityId, body.id);
});

test("contract: template build tRPC uses runtime asset settings from template version", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());

  const actor = await harness.seedUser({ email: "builder-runtime@example.com", password: "LongPassword123!", role: "admin" });
  const login = await (await harness.caller()).auth.login({ email: "builder-runtime@example.com", password: "LongPassword123!" });
  const caller = await harness.caller(login.access_token);
  const seeded = await seedTemplate(harness, {
    status: "published",
    toolsConfig: {
      allowed_tools: ["message_history"],
      runtime_image: {
        setup_script: "apk add --no-cache jq",
        pi_bash_enabled: true,
        pi_bash_allowlist: [" jq ", "PYTHON"],
      },
    },
  });

  const body = await caller.templates.queueBuild({
    templateId: seeded.templateId,
    versionId: seeded.versionId,
    actorUserId: actor.id,
    baseImage: "alpine-3.23",
  });

  assert.equal((body.build_inputs as Record<string, unknown>).setup_script, "apk add --no-cache jq");
  assert.equal((body.build_inputs as Record<string, unknown>).pi_bash_enabled, true);
  assert.deepEqual((body.build_inputs as Record<string, unknown>).pi_bash_allowlist, ["jq", "python"]);
});

test("contract: template build tRPC rejects unpublished or missing versions", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());

  const actor = await harness.seedUser({ email: "builder2@example.com", password: "LongPassword123!", role: "admin" });
  const login = await (await harness.caller()).auth.login({ email: "builder2@example.com", password: "LongPassword123!" });
  const caller = await harness.caller(login.access_token);
  const seeded = await seedTemplate(harness, { status: "draft" });

  await assert.rejects(
    async () => caller.templates.queueBuild({
      templateId: seeded.templateId,
      versionId: seeded.versionId,
      actorUserId: actor.id,
      baseImage: "node:22-alpine",
    }),
    /only published template versions can be built/,
  );

  await assert.rejects(
    async () => caller.templates.queueBuild({
      templateId: seeded.templateId,
      versionId: randomUUID(),
      actorUserId: actor.id,
      baseImage: "node:22-alpine",
    }),
    /template version not found/,
  );
});

test("contract: template build tRPC rejects bash without allowlist and blocked Docker setup instructions", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());

  const actor = await harness.seedUser({ email: "builder4@example.com", password: "LongPassword123!", role: "admin" });
  const login = await (await harness.caller()).auth.login({ email: "builder4@example.com", password: "LongPassword123!" });
  const caller = await harness.caller(login.access_token);
  const seeded = await seedTemplate(harness, { status: "published" });

  await assert.rejects(
    async () => caller.templates.queueBuild({
      templateId: seeded.templateId,
      versionId: seeded.versionId,
      actorUserId: actor.id,
      baseImage: "node:22-alpine",
      piBashEnabled: true,
      piBashAllowlist: [],
    }),
    /pi_bash_allowlist is required/,
  );

  await assert.rejects(
    async () => caller.templates.queueBuild({
      templateId: seeded.templateId,
      versionId: seeded.versionId,
      actorUserId: actor.id,
      baseImage: "node:22-alpine",
      dockerfileSnippet: "ENTRYPOINT [\"bad\"]",
    }),
    /setup_script cannot contain Docker ENTRYPOINT/,
  );
});

test("contract: template build tRPC list mirrors response shape", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());

  await harness.seedUser({ email: "builder3@example.com", password: "LongPassword123!", role: "admin" });
  const login = await (await harness.caller()).auth.login({ email: "builder3@example.com", password: "LongPassword123!" });
  const caller = await harness.caller(login.access_token);

  const seeded = await seedTemplate(harness, { status: "published" });
  const [build] = await harness.db
    .insert(templateBuilds)
    .values({
      templateId: seeded.templateId,
      templateVersionId: seeded.versionId,
      status: "succeeded",
      imageRef: "/assets/template-support",
      imageTag: "gondolin-template-support-build-abc",
      buildInputs: { base_image: "alpine-3.23" },
      logsRef: "{\"returncode\":0}",
    })
    .returning();
  assert.ok(build);

  const list = await caller.templates.builds({ templateId: seeded.templateId, versionId: seeded.versionId });
  assert.equal(list.length, 1);
  assert.equal(list[0]?.id, build.id);
  assert.equal(list[0]?.image_ref, "/assets/template-support");
  assert.equal(typeof list[0]?.created_at, "string");
});

test("contract: template build job invalid or unknown id mutates nothing", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());

  assert.deepEqual(await processTemplateBuildJob(harness.db, { buildId: "not-a-uuid" }), {
    processed: false,
    status: "invalid",
  });
  assert.deepEqual(await processTemplateBuildJob(harness.db, { buildId: randomUUID() }), {
    processed: false,
    status: "not_found",
  });
  assert.equal((await harness.db.select().from(templateBuilds)).length, 0);
});

test("contract: template build job fails when base image is missing", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());

  const seeded = await seedTemplate(harness, { status: "published" });
  const [build] = await harness.db
    .insert(templateBuilds)
    .values({
      templateId: seeded.templateId,
      templateVersionId: seeded.versionId,
      status: "queued",
      buildInputs: {},
    })
    .returning();
  assert.ok(build);

  const result = await processTemplateBuildJob(harness.db, { buildId: build.id });
  assert.deepEqual(result, { processed: true, status: "failed" });

  const stored = await findBuild(harness, build.id);
  assert.equal(stored.status, "failed");
  assert.equal(stored.imageRef, null);
  const event = await findAuditEvent(harness, "template_build.failed");
  assert.deepEqual(event.payload, { error: "missing base_image in build_inputs" });
});

test("contract: template build job records Gondolin failure logs", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());

  const seeded = await seedTemplate(harness, { status: "published" });
  const [build] = await harness.db
    .insert(templateBuilds)
    .values({
      templateId: seeded.templateId,
      templateVersionId: seeded.versionId,
      status: "queued",
      buildInputs: { base_image: "alpine-3.23" },
    })
    .returning();
  assert.ok(build);

  const result = await processTemplateBuildJob(
    harness.db,
    { buildId: build.id },
    { gondolinBuilder: async () => { throw new Error("bad gondolin build"); } },
  );
  assert.deepEqual(result, { processed: true, status: "failed" });

  const stored = await findBuild(harness, build.id);
  assert.equal(stored.status, "failed");
  const logs = JSON.parse(stored.logsRef ?? "{}") as Record<string, unknown>;
  assert.equal(logs.returncode, null);
  assert.equal(logs.stderr_tail, "bad gondolin build");
  const event = await findAuditEvent(harness, "template_build.failed");
  assert.deepEqual(event.payload, { error: "Gondolin asset build failed: bad gondolin build" });
});

test("contract: template build job marks failed when setup script is invalid", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());

  const seeded = await seedTemplate(harness, { status: "published" });
  const [build] = await harness.db
    .insert(templateBuilds)
    .values({
      templateId: seeded.templateId,
      templateVersionId: seeded.versionId,
      status: "queued",
      buildInputs: { base_image: "alpine-3.23", setup_script: "FROM alpine" },
    })
    .returning();
  assert.ok(build);

  const result = await processTemplateBuildJob(harness.db, { buildId: build.id });
  assert.deepEqual(result, { processed: true, status: "failed" });

  const stored = await findBuild(harness, build.id);
  assert.equal(stored.status, "failed");
  const event = await findAuditEvent(harness, "template_build.failed");
  assert.deepEqual(event.payload, { error: "setup_script cannot contain Docker FROM instructions" });
});

test("contract: template build job succeeds and stores Gondolin asset ref", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());

  const seeded = await seedTemplate(harness, { status: "published", key: "Support Bot!" });
  const [build] = await harness.db
    .insert(templateBuilds)
    .values({
      templateId: seeded.templateId,
      templateVersionId: seeded.versionId,
      status: "queued",
      buildInputs: { base_image: "alpine-3.23" },
    })
    .returning();
  assert.ok(build);

  const result = await processTemplateBuildJob(
    harness.db,
    { buildId: build.id },
    {
      gondolinBuilder: async () => ({
        assetRef: "/repo/.kuuna/gondolin/template-builds/support-bot",
        assetLabel: `gondolin-template-support-bot-build-${build.id.replaceAll("-", "").slice(0, 12)}`,
        logs: "built",
      }),
    },
  );

  assert.deepEqual(result, { processed: true, status: "succeeded" });

  const stored = await findBuild(harness, build.id);
  assert.equal(stored.status, "succeeded");
  assert.equal(stored.imageTag, `gondolin-template-support-bot-build-${build.id.replaceAll("-", "").slice(0, 12)}`);
  assert.equal(stored.imageRef, "/repo/.kuuna/gondolin/template-builds/support-bot");
  const event = await findAuditEvent(harness, "template_build.succeeded");
  assert.equal((event.payload as Record<string, unknown>).image_ref, stored.imageRef);
});

async function seedTemplate(
  harness: Awaited<ReturnType<typeof createContractHarness>>,
  input: {
    status: "draft" | "ready" | "published" | "archived";
    key?: string;
    toolsConfig?: Record<string, unknown>;
  },
) {
  const [template] = await harness.db
    .insert(groupTemplates)
    .values({ key: input.key ?? `template-${randomUUID()}`, displayName: "Support Template" })
    .returning();
  assert.ok(template);

  const [version] = await harness.db
    .insert(templateVersions)
    .values({
      templateId: template.id,
      versionNo: 1,
      status: input.status,
      modelConfig: { model: "gpt-5-mini" },
      toolsConfig: input.toolsConfig ?? { tools: [{ name: "search" }, { name: "disabled", enabled: false }] },
      egressPolicy: { allow: ["https://example.com"] },
    })
    .returning();
  assert.ok(version);
  return { templateId: template.id, versionId: version.id };
}

async function findBuild(harness: Awaited<ReturnType<typeof createContractHarness>>, buildId: string) {
  const [build] = await harness.db.select().from(templateBuilds).where(eq(templateBuilds.id, buildId)).limit(1);
  assert.ok(build);
  return build;
}

async function findAuditEvent(
  harness: Awaited<ReturnType<typeof createContractHarness>>,
  eventType: string,
) {
  const [event] = await harness.db.select().from(auditEvents).where(eq(auditEvents.eventType, eventType)).limit(1);
  assert.ok(event);
  return event;
}
