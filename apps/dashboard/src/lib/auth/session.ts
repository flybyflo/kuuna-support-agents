import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import {
  canRole,
  isAdminRole,
  type PermissionAction,
  type PermissionResource,
  type StaffRole,
} from "@/lib/permissions/matrix";

export type StaffSession = {
  userId: string;
  email: string;
  displayName: string;
  role: StaffRole;
  assignedGroupIds: string[];
  mustChangePassword: boolean;
  backendAccessToken: string;
  backendTokenExpiresAt: string;
  sessionExpiresAt: string;
};

export const SESSION_COOKIE_NAME = "kuuna_dashboard_session";
const SESSION_VERSION = "v1";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;
const ALGORITHM = "aes-256-gcm";

function encodeSession(session: StaffSession): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, sessionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(session), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    SESSION_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function decodeSession(raw: string): StaffSession | null {
  try {
    const [version, ivRaw, tagRaw, ciphertextRaw] = raw.split(".");
    if (version !== SESSION_VERSION || !ivRaw || !tagRaw || !ciphertextRaw) {
      return null;
    }

    const decipher = createDecipheriv(ALGORITHM, sessionKey(), Buffer.from(ivRaw, "base64url"));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(ciphertextRaw, "base64url")),
      decipher.final(),
    ]);
    const parsed = JSON.parse(decrypted.toString("utf8"));
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const email = typeof parsed.email === "string" ? parsed.email : "";
    const role = typeof parsed.role === "string" ? parsed.role : "viewer";

    if (!email) {
      return null;
    }

    const backendAccessToken =
      typeof parsed.backendAccessToken === "string" && parsed.backendAccessToken.length > 0
        ? parsed.backendAccessToken
        : "";
    const backendTokenExpiresAt =
      typeof parsed.backendTokenExpiresAt === "string" ? parsed.backendTokenExpiresAt : "";
    const sessionExpiresAt =
      typeof parsed.sessionExpiresAt === "string" ? parsed.sessionExpiresAt : "";

    if (!backendAccessToken || !isFutureIsoDate(backendTokenExpiresAt) || !isFutureIsoDate(sessionExpiresAt)) {
      return null;
    }

    return {
      userId:
        typeof parsed.userId === "string" && parsed.userId.length > 0
          ? parsed.userId
          : `legacy:${email}`,
      email,
      displayName:
        typeof parsed.displayName === "string" && parsed.displayName.length > 0
          ? parsed.displayName
          : email,
      role: role as StaffRole,
      assignedGroupIds: Array.isArray(parsed.assignedGroupIds)
        ? parsed.assignedGroupIds.filter(
            (value: unknown): value is string => typeof value === "string",
          )
        : [],
      mustChangePassword: Boolean(parsed.mustChangePassword),
      backendAccessToken,
      backendTokenExpiresAt,
      sessionExpiresAt,
    };
  } catch {
    return null;
  }
}

export async function setSessionCookie(session: StaffSession): Promise<void> {
  const cookieStore = await cookies();
  const maxAge = secondsUntil(session.sessionExpiresAt);
  cookieStore.set(SESSION_COOKIE_NAME, encodeSession(session), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: Math.max(1, Math.min(SESSION_MAX_AGE_SECONDS, maxAge)),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function getSession(): Promise<StaffSession | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!raw) {
    return null;
  }

  return decodeSession(raw);
}

export async function requireSession(options?: {
  allowMustChangePassword?: boolean;
}): Promise<StaffSession> {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  if (session.mustChangePassword && !options?.allowMustChangePassword) {
    redirect("/first-password-change");
  }

  return session;
}

function sessionKey(): Buffer {
  const secret = process.env.DASHBOARD_SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("DASHBOARD_SESSION_SECRET is required in production");
  }
  return createHash("sha256")
    .update(secret || "dev-insecure-dashboard-session-secret")
    .digest();
}

function isFutureIsoDate(value: string): boolean {
  return secondsUntil(value) > 0;
}

function secondsUntil(value: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return 0;
  }
  return Math.floor((timestamp - Date.now()) / 1000);
}

export function createSessionExpiry(expiresInSeconds: number): {
  backendTokenExpiresAt: string;
  sessionExpiresAt: string;
} {
  const bounded = Math.max(60, Math.min(SESSION_MAX_AGE_SECONDS, expiresInSeconds));
  const expiresAt = new Date(Date.now() + bounded * 1000).toISOString();
  return {
    backendTokenExpiresAt: expiresAt,
    sessionExpiresAt: expiresAt,
  };
}

export function hasPermission(
  session: StaffSession,
  resource: PermissionResource,
  action: PermissionAction,
): boolean {
  return canRole(session.role, resource, action);
}

export function canAccessGroup(session: StaffSession, groupId: string): boolean {
  if (isAdminRole(session.role)) {
    return true;
  }

  return session.assignedGroupIds.includes(groupId);
}

export function requirePermission(
  session: StaffSession,
  resource: PermissionResource,
  action: PermissionAction,
): void {
  if (!hasPermission(session, resource, action)) {
    redirect("/overview?error=forbidden");
  }
}
