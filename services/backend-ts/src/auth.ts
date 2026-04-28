import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { getSettings } from "./config.js";
import type { DbLike } from "./db/client.js";
import { groupAssignments, roles, userRoles, users } from "./db/schema.js";

export type RoleName = "owner" | "admin" | "operator" | "viewer";

export type AccessTokenPayload = {
  sub: string;
  role: RoleName;
  group_scope: string[];
  iat: number;
  exp: number;
};

export type AuthContext = {
  userId: string;
  role: RoleName;
  groupScope: string[];
};

export class AccessTokenError extends Error {}

const roleRank: Record<RoleName, number> = {
  viewer: 0,
  operator: 1,
  admin: 2,
  owner: 3,
};

export function highestRole(roleNames: RoleName[]): RoleName {
  if (roleNames.length === 0) {
    return "viewer";
  }
  return roleNames.reduce((best, role) => (roleRank[role] > roleRank[best] ? role : best), "viewer");
}

export function issueAccessToken(input: {
  userId: string;
  role: RoleName;
  groupScope: string[];
}): string {
  const settings = getSettings();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + Math.max(60, settings.AUTH_TOKEN_TTL_SECONDS);
  const payload: AccessTokenPayload = {
    sub: input.userId,
    role: input.role,
    group_scope: Array.from(new Set(input.groupScope)).sort(),
    iat: now,
    exp: expiresAt,
  };
  const payloadJson = JSON.stringify(payload, Object.keys(payload).sort());
  const payloadB64 = base64UrlEncode(Buffer.from(payloadJson, "utf8"));
  const signatureB64 = base64UrlEncode(sign(payloadB64));
  return `${payloadB64}.${signatureB64}`;
}

export function decodeAccessToken(token: string): AccessTokenPayload {
  const parts = token.trim().split(".");
  if (parts.length !== 2) {
    throw new AccessTokenError("invalid token format");
  }

  const [payloadB64, signatureB64] = parts;
  const expected = sign(payloadB64);
  const actual = base64UrlDecode(signatureB64);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new AccessTokenError("invalid token signature");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(base64UrlDecode(payloadB64).toString("utf8"));
  } catch (error) {
    throw new AccessTokenError("invalid token payload", { cause: error });
  }

  const payload = validatePayload(raw);
  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new AccessTokenError("token expired");
  }
  return payload;
}

export function extractBearerToken(headers: Headers): string | null {
  const header = headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

export function authContextFromHeaders(headers: Headers): AuthContext | null {
  const token = extractBearerToken(headers);
  if (!token) {
    return null;
  }
  try {
    const payload = decodeAccessToken(token);
    return {
      userId: payload.sub,
      role: payload.role,
      groupScope: payload.group_scope,
    };
  } catch {
    return null;
  }
}

export function requireAuth(headers: Headers): AuthContext {
  const token = extractBearerToken(headers);
  if (!token) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "missing bearer token" });
  }
  try {
    const payload = decodeAccessToken(token);
    return {
      userId: payload.sub,
      role: payload.role,
      groupScope: payload.group_scope,
    };
  } catch (error) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: error instanceof Error ? error.message : "invalid token",
    });
  }
}

export function requireRole(auth: AuthContext, allowedRoles: RoleName[]): void {
  if (!allowedRoles.includes(auth.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "insufficient role" });
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64, { N: 2 ** 14, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function verifyPassword(password: string, encodedHash: string): boolean {
  const [algorithm, nRaw, rRaw, pRaw, saltHex, digestHex] = encodedHash.split("$");
  if (algorithm !== "scrypt" || !nRaw || !rRaw || !pRaw || !saltHex || !digestHex) {
    return false;
  }

  try {
    const expected = Buffer.from(digestHex, "hex");
    const derived = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, {
      N: Number(nRaw),
      r: Number(rRaw),
      p: Number(pRaw),
    });
    return expected.length === derived.length && timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

export function passwordPolicyViolations(password: string): string[] {
  const settings = getSettings();
  const violations: string[] = [];

  if (password.length < settings.AUTH_PASSWORD_MIN_LENGTH) {
    violations.push(`minimum length is ${settings.AUTH_PASSWORD_MIN_LENGTH}`);
  }
  if (password.toLowerCase() === password) {
    violations.push("must include an uppercase letter");
  }
  if (password.toUpperCase() === password) {
    violations.push("must include a lowercase letter");
  }
  if (![...password].some((char) => /\d/.test(char))) {
    violations.push("must include a digit");
  }
  if (![...password].some((char) => !/[A-Za-z0-9]/.test(char))) {
    violations.push("must include a symbol");
  }

  const maxConsecutive = settings.AUTH_PASSWORD_MAX_CONSECUTIVE;
  let runLength = 1;
  for (let index = 1; index < password.length; index += 1) {
    if (password[index] === password[index - 1]) {
      runLength += 1;
      if (runLength > maxConsecutive) {
        violations.push(`must not repeat the same character more than ${maxConsecutive} times`);
        break;
      }
    } else {
      runLength = 1;
    }
  }

  return violations;
}

export async function resolveScopeForUser(
  database: DbLike,
  userId: string,
): Promise<{ role: RoleName; groupScope: string[] }> {
  const assignments = await database
    .select({ providerGroupId: groupAssignments.providerGroupId })
    .from(groupAssignments)
    .where(eq(groupAssignments.userId, userId));

  const roleRows = await database
    .select({ name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));

  return {
    role: highestRole(roleRows.map((row) => row.name as RoleName)),
    groupScope: assignments.map((row) => row.providerGroupId),
  };
}

export async function getCurrentUser(database: DbLike, auth: AuthContext) {
  const [user] = await database
    .select()
    .from(users)
    .where(and(eq(users.id, auth.userId), eq(users.isActive, true)))
    .limit(1);
  return user ?? null;
}

export async function listUserRoles(database: DbLike, userId: string): Promise<RoleName[]> {
  const rows = await database
    .select({ name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));
  return rows.map((row) => row.name as RoleName);
}

export async function filterAuthorizedGroups(
  auth: AuthContext,
  providerGroupIds: string[],
): Promise<string[]> {
  if (auth.role === "owner" || auth.role === "admin") {
    return providerGroupIds;
  }
  const allowed = new Set(auth.groupScope);
  return providerGroupIds.filter((providerGroupId) => allowed.has(providerGroupId));
}

export function groupScopeWhere(auth: AuthContext, column: unknown) {
  if (auth.role === "owner" || auth.role === "admin") {
    return undefined;
  }
  if (auth.groupScope.length === 0) {
    return inArray(column as never, ["__kuuna_no_authorized_group__"] as never[]);
  }
  return inArray(column as never, auth.groupScope as never[]);
}

function validatePayload(value: unknown): AccessTokenPayload {
  if (!value || typeof value !== "object") {
    throw new AccessTokenError("invalid payload type");
  }
  const payload = value as Record<string, unknown>;
  const sub = payload.sub;
  const role = payload.role;
  const groupScope = payload.group_scope;
  const iat = payload.iat;
  const exp = payload.exp;

  if (typeof sub !== "string" || !sub) {
    throw new AccessTokenError("invalid token subject");
  }
  if (!isRoleName(role)) {
    throw new AccessTokenError("invalid token role");
  }
  if (!Array.isArray(groupScope) || groupScope.some((item) => typeof item !== "string")) {
    throw new AccessTokenError("invalid token group scope");
  }
  if (typeof iat !== "number" || typeof exp !== "number") {
    throw new AccessTokenError("invalid token timestamps");
  }

  return {
    sub,
    role,
    group_scope: groupScope.filter((item): item is string => typeof item === "string" && Boolean(item)),
    iat,
    exp,
  };
}

function isRoleName(value: unknown): value is RoleName {
  return value === "owner" || value === "admin" || value === "operator" || value === "viewer";
}

function sign(payloadB64: string): Buffer {
  return createHmac("sha256", getSettings().AUTH_TOKEN_SECRET).update(payloadB64).digest();
}

function base64UrlEncode(value: Buffer): string {
  return value.toString("base64url");
}

function base64UrlDecode(value: string): Buffer {
  try {
    return Buffer.from(value, "base64url");
  } catch (error) {
    throw new AccessTokenError("invalid base64 token segment", { cause: error });
  }
}
