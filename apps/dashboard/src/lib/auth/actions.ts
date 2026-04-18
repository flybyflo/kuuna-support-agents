"use server";

import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import {
  authenticateUser,
  ensureRequiredAdminAccount,
  updateUserPassword,
} from "@/lib/db/auth-repository";
import { clearSessionCookie, getSession, setSessionCookie } from "@/lib/auth/session";
import { isMissingRelationError } from "@/lib/db/postgres";

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
    await ensureRequiredAdminAccount();

    const user = await authenticateUser(email, password);
    if (!user) {
      redirect("/login?error=invalid");
    }

    if (!user.isActive) {
      redirect("/locked?reason=inactive");
    }

    await setSessionCookie({
      userId: user.userId,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      assignedGroupIds: user.assignedGroupIds,
      mustChangePassword: user.mustChangePassword,
    });

    if (user.mustChangePassword) {
      redirect("/first-password-change");
    }

    redirect("/overview");
  } catch (error) {
    rethrowRedirectError(error);
    console.error("[dashboard-auth] login failed", error);
    if (isMissingRelationError(error)) {
      redirect("/login?error=schema-missing");
    }
    redirect("/login?error=db");
  }
}

export async function completePasswordChangeAction(
  formData: FormData,
): Promise<void> {
  const nextPassword = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

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

  if (session.userId.startsWith("legacy:")) {
    redirect("/login?error=reauth");
  }

  try {
    await updateUserPassword(session.userId, nextPassword);

    await setSessionCookie({
      ...session,
      mustChangePassword: false,
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
