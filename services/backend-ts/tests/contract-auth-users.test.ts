import assert from "node:assert/strict";
import test from "node:test";

import { eq } from "drizzle-orm";

import { auditEvents } from "../src/db/schema.js";
import { contractDatabaseUrl, createContractHarness } from "./contract-harness.js";

const skipReason = contractDatabaseUrl
  ? false
  : "set BACKEND_TS_CONTRACT_DATABASE_URL to run backend-ts contract tests";

test("contract: auth login and me match Python shape", { skip: skipReason }, async (t) => {
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
