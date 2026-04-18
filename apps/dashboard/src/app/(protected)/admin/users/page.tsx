import { SimpleTable } from "@/components/data-table/simple-table";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { listUsers } from "@/lib/api-client";
import {
  REQUIRED_ADMIN_EMAIL,
  activePrivilegedUserCount,
  canDeactivateUser,
  canDeleteUser,
  hasActiveRequiredAdminAccount,
  isRequiredAdminAccount,
} from "@/lib/auth/admin-account-invariant";
import { requireAuthorized } from "@/lib/auth/guards";
import { runMediaReconcileAction } from "@/lib/admin/media-reconcile-action";
import { ensureRequiredAdminAccount } from "@/lib/db/auth-repository";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function getSingleParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireAuthorized("users", "read");

  try {
    await ensureRequiredAdminAccount();
  } catch (error) {
    console.warn("[dashboard-admin] required admin check failed", error);
  }

  const users = await listUsers();
  const params = await searchParams;

  const reconcileStatus = getSingleParam(params.reconcile);
  const reconcileMessage = getSingleParam(params.message);
  const reconcileReason = getSingleParam(params.reason);

  const requiredAdminHealthy = hasActiveRequiredAdminAccount(users);
  const privilegedUsers = activePrivilegedUserCount(users);

  return (
    <div className="grid">
      <PageHeader
        title="User Administration"
        description="Create and manage staff users, roles, and active state."
        actions={<button className="button">Create user</button>}
      />

      {reconcileStatus === "ok" ? (
        <Notice title="Media reconcile finished" tone="success">
          <p className="muted-text">{reconcileMessage ?? "done"}</p>
          <p className="muted-text" style={{ marginTop: 6 }}>
            cleaned={getSingleParam(params.cleaned) ?? "0"} · enqueued={getSingleParam(params.enqueued) ?? "0"} ·
            retried={getSingleParam(params.retried) ?? "0"} · pending_after={getSingleParam(params.pendingAfter) ?? "0"} ·
            failed_after={getSingleParam(params.failedAfter) ?? "0"}
          </p>
          {getSingleParam(params.group) ? (
            <p className="muted-text" style={{ marginTop: 6 }}>
              Group scope: <span className="inline-code">{getSingleParam(params.group)}</span>
            </p>
          ) : null}
        </Notice>
      ) : null}

      {reconcileStatus === "error" ? (
        <Notice title="Media reconcile failed" tone="warning">
          <p className="muted-text">{reconcileReason ?? "unknown error"}</p>
        </Notice>
      ) : null}

      <Notice
        title="Admin account invariant"
        tone={requiredAdminHealthy ? "success" : "warning"}
      >
        <p className="muted-text">
          Required account: <span className="inline-code">{REQUIRED_ADMIN_EMAIL}</span>
        </p>
        <p className="muted-text" style={{ marginTop: 6 }}>
          Active privileged users (owner/admin): {privilegedUsers}
        </p>
        {!requiredAdminHealthy ? (
          <p className="error-text">
            Critical: the required admin account is missing, inactive, or no longer
            has admin role.
          </p>
        ) : null}
      </Notice>

      <section className="panel stack">
        <h2>Media reconcile</h2>
        <p className="muted-text">
          Runs backend maintenance for media assets (cleanup + requeue worker jobs).
        </p>

        <form action={runMediaReconcileAction} className="form-grid" style={{ marginTop: 0 }}>
          <label>
            Optional provider group scope
            <input name="providerGroupId" placeholder="151655379144747@lid" />
          </label>

          <label>
            Limit
            <input name="limit" type="number" min={1} max={10000} defaultValue={500} />
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input name="cleanupBogus" type="checkbox" defaultChecked style={{ width: "auto" }} />
            Cleanup bogus failed rows
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input name="enqueuePending" type="checkbox" defaultChecked style={{ width: "auto" }} />
            Enqueue pending assets
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input name="retryFailed" type="checkbox" defaultChecked style={{ width: "auto" }} />
            Retry failed assets
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input name="dryRun" type="checkbox" style={{ width: "auto" }} />
            Dry run only
          </label>

          <button className="button" type="submit">
            Run reconcile
          </button>
        </form>
      </section>

      <section className="panel">
        <SimpleTable
          data={users}
          columns={[
            {
              header: "User",
              cell: (user) => (
                <div>
                  <strong>{user.displayName}</strong>
                  <p className="muted-text">{user.email}</p>
                </div>
              ),
            },
            {
              header: "Role",
              cell: (user) => (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="badge">{user.role}</span>
                  {isRequiredAdminAccount(user) ? (
                    <span className="status status-active">required</span>
                  ) : null}
                </div>
              ),
            },
            {
              header: "Status",
              cell: (user) => (user.active ? "Active" : "Inactive"),
            },
            {
              header: "Actions",
              cell: (user) => {
                const deactivateAllowed = canDeactivateUser(users, user);
                const deleteAllowed = canDeleteUser(users, user);

                return (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={!deactivateAllowed}
                      title={
                        deactivateAllowed
                          ? "Deactivate user"
                          : "Blocked by admin-account invariant"
                      }
                    >
                      {user.active ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      type="button"
                      className="button button-danger"
                      disabled={!deleteAllowed}
                      title={
                        deleteAllowed
                          ? "Delete user"
                          : "Blocked by admin-account invariant"
                      }
                    >
                      Delete
                    </button>
                  </div>
                );
              },
            },
          ]}
        />
      </section>
    </div>
  );
}
