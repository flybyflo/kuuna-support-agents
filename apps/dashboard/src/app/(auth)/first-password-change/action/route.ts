import { getSession, setSessionCookie } from "@/lib/auth/session";
import { createBackendTrpcClient } from "@/lib/backend/client";

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
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const nextPassword = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!currentPassword) {
    return redirect303("/first-password-change?error=current-password", request);
  }

  if (nextPassword.length < 12) {
    return redirect303("/first-password-change?error=weak-password", request);
  }

  if (nextPassword !== confirmPassword) {
    return redirect303("/first-password-change?error=mismatch", request);
  }

  const session = await getSession();
  if (!session) {
    return redirect303("/login", request);
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

    return redirect303("/overview?passwordChanged=1", request);
  } catch (error) {
    console.error("[dashboard-auth] password change failed", error);
    return redirect303("/first-password-change?error=db", request);
  }
}
