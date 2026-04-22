import { NextResponse } from "next/server";

import { authenticateUser, ensureRequiredAdminAccount } from "@/lib/db/auth-repository";
import { isMissingRelationError } from "@/lib/db/postgres";
import { setSessionCookie } from "@/lib/auth/session";

function baseUrlFromRequest(request: Request): string {
  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    "localhost:3000";
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

export async function POST(request: Request): Promise<Response> {
  const baseUrl = baseUrlFromRequest(request);
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return NextResponse.redirect(new URL("/login?error=missing", baseUrl));
  }

  try {
    await ensureRequiredAdminAccount();

    const user = await authenticateUser(email, password);
    if (!user) {
      return NextResponse.redirect(new URL("/login?error=invalid", baseUrl));
    }

    if (!user.isActive) {
      return NextResponse.redirect(new URL("/locked?reason=inactive", baseUrl));
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
      return NextResponse.redirect(new URL("/first-password-change", baseUrl));
    }

    return NextResponse.redirect(new URL("/overview", baseUrl));
  } catch (error) {
    console.error("[dashboard-auth] login failed", error);
    if (isMissingRelationError(error)) {
      return NextResponse.redirect(new URL("/login?error=schema-missing", baseUrl));
    }
    return NextResponse.redirect(new URL("/login?error=db", baseUrl));
  }
}

