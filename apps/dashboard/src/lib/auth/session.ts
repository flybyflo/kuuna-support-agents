import { cookies } from "next/headers";
import { redirect } from "next/navigation";
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
};

export const SESSION_COOKIE_NAME = "kuuna_dashboard_session";

function encodeSession(session: StaffSession): string {
  return Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
}

function decodeSession(raw: string): StaffSession | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const email = typeof parsed.email === "string" ? parsed.email : "";
    const role = typeof parsed.role === "string" ? parsed.role : "viewer";

    if (!email) {
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
    };
  } catch {
    return null;
  }
}

export async function setSessionCookie(session: StaffSession): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, encodeSession(session), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 8,
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
