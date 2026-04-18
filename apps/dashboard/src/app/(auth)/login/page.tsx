import Link from "next/link";
import { redirect } from "next/navigation";
import { loginAction } from "@/lib/auth/actions";
import { getSession } from "@/lib/auth/session";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function getMessage(error: string | undefined): string | null {
  switch (error) {
    case "missing":
      return "Enter both email and password.";
    case "invalid":
      return "Invalid email or password.";
    case "db":
      return "Database connection failed. Check dashboard DB configuration.";
    case "schema-missing":
      return "Database is reachable, but required tables are missing. Run backend migrations first.";
    case "reauth":
      return "Session format changed. Please sign in again.";
    default:
      return null;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getSession();

  if (session && !session.mustChangePassword) {
    redirect("/overview");
  }

  if (session?.mustChangePassword) {
    redirect("/first-password-change");
  }

  const resolvedSearchParams = await searchParams;

  const error = Array.isArray(resolvedSearchParams.error)
    ? resolvedSearchParams.error[0]
    : resolvedSearchParams.error;
  const loggedOut = resolvedSearchParams.loggedOut === "1";

  return (
    <main className="auth-wrap">
      <section className="auth-card">
        <h1>Staff Login</h1>
        <p>Use your staff account. New users must change password at first sign-in.</p>

        {loggedOut ? (
          <p className="success-text">You have been signed out.</p>
        ) : null}
        {getMessage(error) ? <p className="error-text">{getMessage(error)}</p> : null}

        <form action={loginAction} className="form-grid">
          <label>
            Email
            <input
              type="email"
              name="email"
              placeholder="operator@kuuna.ai"
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              name="password"
              placeholder="Minimum 8 characters"
              required
              minLength={8}
            />
          </label>

          <button type="submit" className="button">
            Sign in
          </button>
        </form>

        <p className="muted-text" style={{ marginTop: 14 }}>
          Credentials are validated against the PostgreSQL <span className="inline-code">users</span> table.
          Required bootstrap admin: <span className="inline-code">admin@kuuna.ai</span>.
        </p>

        <p className="muted-text" style={{ marginTop: 10 }}>
          Account locked? <Link href="/locked">See lockout guidance</Link>
        </p>
      </section>
    </main>
  );
}
