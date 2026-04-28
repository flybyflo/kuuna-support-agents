import { clearSessionCookie } from "@/lib/auth/session";

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
  await clearSessionCookie();
  return redirect303("/login?loggedOut=1", request);
}

export async function GET(request: Request): Promise<Response> {
  await clearSessionCookie();
  return redirect303("/login?loggedOut=1", request);
}
