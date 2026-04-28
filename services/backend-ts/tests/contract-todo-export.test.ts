import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { eq } from "drizzle-orm";

import { todos } from "../src/db/schema.js";
import { processTodoExportJob } from "../src/jobs/todo-export.js";
import { contractDatabaseUrl, createContractHarness } from "./contract-harness.js";

const skipReason = contractDatabaseUrl
  ? false
  : "set BACKEND_TS_CONTRACT_DATABASE_URL to run backend-ts contract tests";

test("contract: todo export disabled or missing webhook returns zero", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());

  assert.equal(await processTodoExportJob(harness.db, {}, { enabled: false, webhookUrl: "http://todo.test" }), 0);
  assert.equal(await processTodoExportJob(harness.db, {}, { enabled: true, webhookUrl: null }), 0);
});

test("contract: todo export success updates exported fields", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());

  const todoId = randomUUID();
  await harness.db.insert(todos).values({
    id: todoId,
    providerGroupId: "group-a@g.us",
    title: "Call customer",
    description: "Need follow-up",
    status: "open",
    priority: "high",
    lastExportError: "old error",
  });

  const bodies: unknown[] = [];
  const exported = await processTodoExportJob(
    harness.db,
    {},
    {
      enabled: true,
      webhookUrl: "http://todo.test/export",
      httpClient: async (_url, init) => {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ external_ref: "task-123" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  );

  assert.equal(exported, 1);
  assert.equal((bodies[0] as Record<string, unknown>).id, todoId);

  const stored = await findTodo(harness, todoId);
  assert.equal(stored.exportAttemptCount, 1);
  assert.ok(stored.exportedAt);
  assert.equal(stored.externalRef, "task-123");
  assert.equal(stored.lastExportError, null);
});

test("contract: failed todo export records error and leaves todo exportable", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());

  const todoId = randomUUID();
  await harness.db.insert(todos).values({
    id: todoId,
    providerGroupId: "group-a@g.us",
    title: "Retry customer",
    status: "in_progress",
    priority: "normal",
  });

  const exported = await processTodoExportJob(
    harness.db,
    {},
    {
      enabled: true,
      webhookUrl: "http://todo.test/export",
      httpClient: async () => new Response("boom", { status: 500 }),
    },
  );

  assert.equal(exported, 0);
  const stored = await findTodo(harness, todoId);
  assert.equal(stored.exportAttemptCount, 1);
  assert.equal(stored.exportedAt, null);
  assert.match(stored.lastExportError ?? "", /todo_export_http_500/);
});

test("contract: todo export limit and provider group filters are honored", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());

  const firstId = randomUUID();
  const secondId = randomUUID();
  const thirdId = randomUUID();
  await harness.db.insert(todos).values([
    {
      id: firstId,
      providerGroupId: "group-a@g.us",
      title: "first",
      status: "open",
      priority: "normal",
      createdAt: new Date("2026-04-18T10:00:00Z"),
    },
    {
      id: secondId,
      providerGroupId: "group-a@g.us",
      title: "second",
      status: "open",
      priority: "normal",
      createdAt: new Date("2026-04-18T11:00:00Z"),
    },
    {
      id: thirdId,
      providerGroupId: "group-b@g.us",
      title: "third",
      status: "open",
      priority: "normal",
      createdAt: new Date("2026-04-18T09:00:00Z"),
    },
  ]);

  const exportedIds: string[] = [];
  const exported = await processTodoExportJob(
    harness.db,
    { limit: 1, providerGroupId: "group-a@g.us" },
    {
      enabled: true,
      webhookUrl: "http://todo.test/export",
      httpClient: async (_url, init) => {
        const body = JSON.parse(String(init.body)) as { id: string };
        exportedIds.push(body.id);
        return new Response(JSON.stringify({ id: `external-${body.id}` }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  );

  assert.equal(exported, 1);
  assert.deepEqual(exportedIds, [firstId]);
  assert.ok((await findTodo(harness, firstId)).exportedAt);
  assert.equal((await findTodo(harness, secondId)).exportedAt, null);
  assert.equal((await findTodo(harness, thirdId)).exportedAt, null);
});

async function findTodo(harness: Awaited<ReturnType<typeof createContractHarness>>, todoId: string) {
  const [stored] = await harness.db.select().from(todos).where(eq(todos.id, todoId)).limit(1);
  assert.ok(stored);
  return stored;
}
