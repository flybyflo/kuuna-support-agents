"use server";

import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { clearSessionCookie, getSession, setSessionCookie } from "@/lib/auth/session";
import { bootstrapRequiredAdmin, createBackendTrpcClient, loginWithBackend } from "@/lib/backend/client";

function rethrowRedirectError(error: unknown): void {
  if (isRedirectError(error)) {
    throw error;
  }
}

export async function loginAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect("/login?error=missing");
  }

  try {
    await bootstrapRequiredAdmin();
    const user = await loginWithBackend(email, password);

    await setSessionCookie({
      userId: user.userId,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      assignedGroupIds: user.assignedGroupIds,
      mustChangePassword: user.mustChangePassword,
      backendAccessToken: user.backendAccessToken,
      backendTokenExpiresAt: user.backendTokenExpiresAt,
      sessionExpiresAt: user.sessionExpiresAt,
    });

    if (user.mustChangePassword) {
      redirect("/first-password-change");
    }

    redirect("/overview");
  } catch (error) {
    rethrowRedirectError(error);
    console.error("[dashboard-auth] login failed", error);
    redirect("/login?error=invalid");
  }
}

export async function completePasswordChangeAction(
  formData: FormData,
): Promise<void> {
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const nextPassword = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!currentPassword) {
    redirect("/first-password-change?error=current-password");
  }

  if (nextPassword.length < 12) {
    redirect("/first-password-change?error=weak-password");
  }

  if (nextPassword !== confirmPassword) {
    redirect("/first-password-change?error=mismatch");
  }

  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  try {
    const client = createBackendTrpcClient(session.backendAccessToken);
    const user = await client.auth.changePassword.mutate({
      currentPassword,
      newPassword: nextPassword,
    });

    await setSessionCookie({
      ...session,
      mustChangePassword: user.must_change_password,
    });

    redirect("/overview?passwordChanged=1");
  } catch (error) {
    rethrowRedirectError(error);
    console.error("[dashboard-auth] password change failed", error);
    redirect("/first-password-change?error=db");
  }
}

export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/login?loggedOut=1");
}
