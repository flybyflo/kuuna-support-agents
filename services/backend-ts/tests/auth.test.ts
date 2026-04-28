import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeAccessToken,
  hashPassword,
  issueAccessToken,
  passwordPolicyViolations,
  verifyPassword,
} from "../src/auth.js";

test("scrypt password hashes remain verifiable", () => {
  const hash = hashPassword("SecurePass123!");
  assert.equal(verifyPassword("SecurePass123!", hash), true);
  assert.equal(verifyPassword("wrong", hash), false);
});

test("access token roundtrip uses compatible payload fields", () => {
  const token = issueAccessToken({
    userId: "00000000-0000-0000-0000-000000000001",
    role: "admin",
    groupScope: ["group-b", "group-a", "group-a"],
  });
  const payload = decodeAccessToken(token);
  assert.equal(payload.sub, "00000000-0000-0000-0000-000000000001");
  assert.equal(payload.role, "admin");
  assert.deepEqual(payload.group_scope, ["group-a", "group-b"]);
});

test("password policy reports domain violations", () => {
  const violations = passwordPolicyViolations("aaaaaaaa");
  assert.ok(violations.includes("must include an uppercase letter"));
  assert.ok(violations.includes("must include a digit"));
  assert.ok(violations.includes("must include a symbol"));
});
