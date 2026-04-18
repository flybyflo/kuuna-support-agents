import { requireSession, requirePermission, type StaffSession } from "@/lib/auth/session";
import type {
  PermissionAction,
  PermissionResource,
} from "@/lib/permissions/matrix";

export async function requireProtectedSession(): Promise<StaffSession> {
  return requireSession();
}

export async function requireAuthorized(
  resource: PermissionResource,
  action: PermissionAction,
): Promise<StaffSession> {
  const session = await requireSession();
  requirePermission(session, resource, action);
  return session;
}
