import assert from "node:assert/strict";
import test from "node:test";

import { eq } from "drizzle-orm";

import { resetSettingsForTests } from "../src/config.js";
import { auditEvents, users } from "../src/db/schema.js";
import { contractDatabaseUrl, createContractHarness } from "./contract-harness.js";

const skipReason = contractDatabaseUrl
  ? false
  : "set BACKEND_TS_CONTRACT_DATABASE_URL to run backend-ts contract tests";

test("contract: auth login and me match expected shape", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());

  await harness.seedUser({
    email: "owner@example.com",
    password: "OwnerSecure123!",
    role: "owner",
  });

  const publicCaller = await harness.caller();
  const login = await publicCaller.auth.login({
    email: "owner@example.com",
    password: "OwnerSecure123!",
  });

  assert.equal(login.token_type, "bearer");
  assert.equal(login.user.email, "owner@example.com");
  assert.equal(login.user.role, "owner");
  assert.deepEqual(login.user.group_scope, []);

  const authedCaller = await harness.caller(login.access_token);
  const me = await authedCaller.auth.me();
  assert.equal(me.email, "owner@example.com");
  assert.equal(me.role, "owner");
  assert.deepEqual(me.group_scope, []);
});

test("contract: users create and hard delete append audit event", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());

  const owner = await harness.seedUser({
    email: "owner@example.com",
    password: "OwnerSecure123!",
    role: "owner",
  });
  const publicCaller = await harness.caller();
  const login = await publicCaller.auth.login({
    email: "owner@example.com",
    password: "OwnerSecure123!",
  });

  const authedCaller = await harness.caller(login.access_token);
  const created = await authedCaller.users.create({
    email: "operator@example.com",
    password: "Operator123!!",
    roles: ["operator"],
    groupScope: ["group-a@g.us"],
    mustChangePassword: true,
    isActive: true,
  });

  assert.deepEqual(created.roles, ["operator"]);
  assert.deepEqual(created.group_scope, ["group-a@g.us"]);

  await authedCaller.users.delete({ userId: created.id });

  const [hardDeleteEvent] = await harness.db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.eventType, "user.hard_deleted"))
    .limit(1);

  assert.ok(hardDeleteEvent);
  assert.equal(hardDeleteEvent.actorUserId, owner.id);
  assert.equal(hardDeleteEvent.entityId, created.id);
});

test("contract: internal admin bootstrap is idempotent and token protected", { skip: skipReason }, async (t) => {
  const harness = await createContractHarness();
  t.after(() => harness.close());

  process.env.INTERNAL_OPS_TOKEN = "admin-bootstrap-token";
  process.env.REQUIRED_ADMIN_EMAIL = "admin@kuuna.ai";
  process.env.DASHBOARD_REQUIRED_ADMIN_PASSWORD = "AdminBootstrap123!";
  resetSettingsForTests();
  t.after(() => {
    delete process.env.INTERNAL_OPS_TOKEN;
    delete process.env.REQUIRED_ADMIN_EMAIL;
    delete process.env.DASHBOARD_REQUIRED_ADMIN_PASSWORD;
    resetSettingsForTests();
  });

  await assert.rejects(
    async () => (await harness.internalCaller("wrong")).internal.adminBootstrap(),
    /invalid internal ops token/,
  );

  const created = await (await harness.internalCaller("admin-bootstrap-token")).internal.adminBootstrap();
  assert.equal(created.created, true);

  const second = await (await harness.internalCaller("admin-bootstrap-token")).internal.adminBootstrap();
  assert.equal(second.created, false);

  const rows = await harness.db.select().from(users).where(eq(users.email, "admin@kuuna.ai"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.isActive, true);
  assert.equal(rows[0]?.mustChangePassword, true);
});
