import { AlertCircle } from "lucide-react";

import { AuthShell } from "@/components/layout/auth-shell";
import { Button } from "@/components/ui/button";
import { FormActions, FormRow } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { requireSession } from "@/lib/auth/session";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const passwordRequirements = [
  "At least 12 characters",
  "At least one uppercase letter",
  "At least one lowercase letter",
  "At least one number",
  "At least one symbol",
  "No character repeated more than 3 times in a row",
] as const;

function getMessage(error: string | undefined, reason: string | undefined): string | null {
  switch (error) {
    case "weak-password":
      return reason ? `Password does not meet policy: ${reason}` : "Password must be at least 12 characters.";
    case "mismatch":
      return "Passwords do not match.";
    case "current-password":
      return "Enter the current password for this account.";
    case "backend":
      return "Could not reach the backend authentication service. Check the backend logs and configuration.";
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
  const reason = Array.isArray(resolvedSearchParams.reason)
    ? resolvedSearchParams.reason[0]
    : resolvedSearchParams.reason;
  const errorMessage = getMessage(error, reason);

  return (
    <AuthShell
      title="Change your password"
      description={`Hi ${session.displayName}, your first sign-in requires a new password before dashboard access is granted.`}
    >
      {errorMessage ? (
        <div className="mb-5 flex items-start gap-2.5 rounded-md border border-[color:color-mix(in_oklab,var(--danger-500)_30%,transparent)] bg-[color:var(--danger-50)] px-3 py-2.5 text-sm text-[color:var(--danger-700)]">
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      ) : null}

      <form
        action="/first-password-change/action"
        method="post"
        className="flex flex-col gap-4"
      >
        <FormRow label="Current password" htmlFor="currentPassword">
          <Input
            id="currentPassword"
            type="password"
            name="currentPassword"
            required
            placeholder="Current password"
            autoComplete="current-password"
          />
        </FormRow>

        <FormRow label="New password" htmlFor="password">
          <Input
            id="password"
            type="password"
            name="password"
            minLength={12}
            required
            placeholder="At least 12 characters"
            autoComplete="new-password"
          />
          <ul className="mt-2 grid gap-1 text-xs leading-5 text-muted-foreground">
            {passwordRequirements.map((requirement) => (
              <li key={requirement} className="flex items-start gap-2">
                <span aria-hidden className="mt-2 size-1 rounded-full bg-muted-foreground" />
                <span>{requirement}</span>
              </li>
            ))}
          </ul>
        </FormRow>

        <FormRow label="Confirm new password" htmlFor="confirmPassword">
          <Input
            id="confirmPassword"
            type="password"
            name="confirmPassword"
            minLength={12}
            required
            placeholder="Repeat password"
            autoComplete="new-password"
          />
        </FormRow>

        <FormActions className="flex-col items-stretch gap-2">
          <Button type="submit" className="w-full">
            Save password
          </Button>
        </FormActions>
      </form>
    </AuthShell>
  );
}
