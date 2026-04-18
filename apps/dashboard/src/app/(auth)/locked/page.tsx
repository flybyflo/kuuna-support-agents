import Link from "next/link";

export default function LockedPage() {
  return (
    <main className="auth-wrap">
      <section className="auth-card">
        <h1>Account Temporarily Locked</h1>
        <p>
          Too many failed attempts were detected. In production, this state is
          released by policy or admin reset.
        </p>

        <ul className="inline-list" style={{ marginTop: 12 }}>
          <li>Wait for cooldown window.</li>
          <li>Contact an administrator if urgent.</li>
          <li>Review audit trail from admin dashboard.</li>
        </ul>

        <Link href="/login" className="button" style={{ marginTop: 16, display: "inline-block" }}>
          Back to login
        </Link>
      </section>
    </main>
  );
}
