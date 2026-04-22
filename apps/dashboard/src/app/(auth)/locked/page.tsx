import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";

import { AuthShell } from "@/components/layout/auth-shell";
import { Button } from "@/components/ui/button";

export default function LockedPage() {
  return (
    <AuthShell
      title="Account temporarily locked"
      description="Too many failed attempts were detected. In production this state is released by policy or admin reset."
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-md border border-[color:color-mix(in_oklab,var(--warning-500)_30%,transparent)] bg-[color:var(--warning-50)] px-3.5 py-3 text-sm">
          <Lock
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-[color:var(--warning-700)]"
          />
          <div className="flex flex-col gap-1.5 text-[color:var(--warning-700)]">
            <p className="font-semibold">Next steps</p>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              <li>Wait for the cooldown window to elapse.</li>
              <li>Contact an administrator if urgent.</li>
              <li>Review the audit trail from the admin dashboard.</li>
            </ul>
          </div>
        </div>

        <Button asChild className="w-full">
          <Link href="/login">
            <ArrowLeft aria-hidden />
            <span>Back to login</span>
          </Link>
        </Button>
      </div>
    </AuthShell>
  );
}
