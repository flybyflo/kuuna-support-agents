import { setSessionCookie } from "@/lib/auth/session";
import { bootstrapRequiredAdmin, loginWithBackend } from "@/lib/backend/client";

/**
 * After a form POST, redirect must be **303 See Other** so the browser follows with **GET** (PRG).
 * NextResponse.redirect() defaults to **307**, which preserves POST and can yield POST /overview (405/odd behavior).
 */
function redirect303(path: string, request: Request) {
  const location = new URL(path, request.url);
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${location.pathname}${location.search}`,
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return redirect303("/login?error=missing", request);
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
      return redirect303("/first-password-change", request);
    }

    return redirect303("/overview", request);
  } catch (error) {
    console.error("[dashboard-auth] login failed", error);
    return redirect303("/login?error=invalid", request);
  }
}
