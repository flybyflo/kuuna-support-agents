import { completePasswordChangeAction } from "@/lib/auth/actions";
import { requireSession } from "@/lib/auth/session";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function getMessage(error: string | undefined): string | null {
  switch (error) {
    case "weak-password":
      return "Password must be at least 12 characters.";
    case "mismatch":
      return "Passwords do not match.";
    case "db":
      return "Could not update password in database. Please retry.";
    default:
      return null;
  }
}

export default async function FirstPasswordChangePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireSession({ allowMustChangePassword: true });
  const resolvedSearchParams = await searchParams;

  const error = Array.isArray(resolvedSearchParams.error)
    ? resolvedSearchParams.error[0]
    : resolvedSearchParams.error;

  return (
    <main className="auth-wrap">
      <section className="auth-card">
        <h1>Change Your Password</h1>
        <p>
          Hi {session.displayName}, your first sign-in requires setting a new
          password before dashboard access is granted.
        </p>

        {getMessage(error) ? <p className="error-text">{getMessage(error)}</p> : null}

        <form action={completePasswordChangeAction} className="form-grid">
          <label>
            New password
            <input
              type="password"
              name="password"
              minLength={12}
              required
              placeholder="At least 12 characters"
            />
          </label>

          <label>
            Confirm new password
            <input
              type="password"
              name="confirmPassword"
              minLength={12}
              required
              placeholder="Repeat password"
            />
          </label>

          <button type="submit" className="button">
            Save password
          </button>
        </form>
      </section>
    </main>
  );
}
