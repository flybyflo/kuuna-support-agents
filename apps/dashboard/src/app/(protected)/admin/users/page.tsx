import { UserPlus } from "lucide-react";

import { SimpleTable } from "@/components/data-table/simple-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FormActions, FormRow } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    <div className="flex flex-col gap-8">
      <PageHeader
        title="User administration"
        description="Create and manage staff users, roles, and active state."
        actions={
          <Button>
            <UserPlus aria-hidden />
            <span>Create user</span>
          </Button>
        }
      />

      {reconcileStatus === "ok" ? (
        <Notice title="Media reconcile finished" tone="success">
          <p>{reconcileMessage ?? "done"}</p>
          <p className="mt-1.5 text-xs">
            cleaned={getSingleParam(params.cleaned) ?? "0"} · enqueued=
            {getSingleParam(params.enqueued) ?? "0"} · retried=
            {getSingleParam(params.retried) ?? "0"} · pending_after=
            {getSingleParam(params.pendingAfter) ?? "0"} · failed_after=
            {getSingleParam(params.failedAfter) ?? "0"}
          </p>
          {getSingleParam(params.group) ? (
            <p className="mt-1.5 text-xs">
              Group scope:{" "}
              <code className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.7rem]">
                {getSingleParam(params.group)}
              </code>
            </p>
          ) : null}
        </Notice>
      ) : null}

      {reconcileStatus === "error" ? (
        <Notice title="Media reconcile failed" tone="warning">
          {reconcileReason ?? "unknown error"}
        </Notice>
      ) : null}

      <Notice
        title="Admin account invariant"
        tone={requiredAdminHealthy ? "success" : "warning"}
      >
        <p>
          Required account:{" "}
          <code className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
            {REQUIRED_ADMIN_EMAIL}
          </code>
        </p>
        <p className="mt-1">
          Active privileged users (owner/admin): {privilegedUsers}
        </p>
        {!requiredAdminHealthy ? (
          <p className="mt-2 font-semibold text-[color:var(--danger-700)]">
            Critical: the required admin account is missing, inactive, or no
            longer has admin role.
          </p>
        ) : null}
      </Notice>

      <Card>
        <CardHeader>
          <CardTitle>Media reconcile</CardTitle>
          <CardDescription>
            Runs backend maintenance for media assets (cleanup + requeue worker
            jobs).
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-6">
          <form
            action={runMediaReconcileAction}
            className="flex flex-col gap-4"
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormRow
                label="Provider group scope"
                htmlFor="providerGroupId"
                hint="Optional — leave blank for all groups."
              >
                <Input
                  id="providerGroupId"
                  name="providerGroupId"
                  placeholder="151655379144747@lid"
                />
              </FormRow>

              <FormRow label="Limit" htmlFor="limit">
                <Input
                  id="limit"
                  name="limit"
                  type="number"
                  min={1}
                  max={10000}
                  defaultValue={500}
                />
              </FormRow>
            </div>

            <fieldset className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <legend className="sr-only">Reconcile flags</legend>
              {[
                {
                  name: "cleanupBogus",
                  label: "Cleanup bogus failed rows",
                  defaultChecked: true,
                },
                {
                  name: "enqueuePending",
                  label: "Enqueue pending assets",
                  defaultChecked: true,
                },
                {
                  name: "retryFailed",
                  label: "Retry failed assets",
                  defaultChecked: true,
                },
                {
                  name: "dryRun",
                  label: "Dry run only",
                  defaultChecked: false,
                },
              ].map((flag) => (
                <label
                  key={flag.name}
                  className="flex items-center gap-2.5 rounded-md border border-border bg-muted/30 px-3 py-2"
                >
                  <Checkbox
                    name={flag.name}
                    defaultChecked={flag.defaultChecked}
                  />
                  <Label className="cursor-pointer">{flag.label}</Label>
                </label>
              ))}
            </fieldset>

            <FormActions>
              <Button type="submit">Run reconcile</Button>
            </FormActions>
          </form>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardContent className="p-0 pt-0">
          <SimpleTable
            data={users}
            emptyMessage="No staff users yet."
            columns={[
              {
                header: "User",
                cell: (user) => (
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-foreground">
                      {user.displayName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {user.email}
                    </span>
                  </div>
                ),
              },
              {
                header: "Role",
                cell: (user) => (
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{user.role}</Badge>
                    {isRequiredAdminAccount(user) ? (
                      <Badge variant="success">required</Badge>
                    ) : null}
                  </div>
                ),
              },
              {
                header: "Status",
                cell: (user) =>
                  user.active ? (
                    <Badge variant="success">Active</Badge>
                  ) : (
                    <Badge variant="secondary">Inactive</Badge>
                  ),
              },
              {
                header: "Actions",
                cell: (user) => {
                  const deactivateAllowed = canDeactivateUser(users, user);
                  const deleteAllowed = canDeleteUser(users, user);

                  return (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!deactivateAllowed}
                        title={
                          deactivateAllowed
                            ? user.active
                              ? "Deactivate user"
                              : "Activate user"
                            : "Blocked by admin-account invariant"
                        }
                      >
                        {user.active ? "Deactivate" : "Activate"}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={!deleteAllowed}
                        title={
                          deleteAllowed
                            ? "Delete user"
                            : "Blocked by admin-account invariant"
                        }
                      >
                        Delete
                      </Button>
                    </div>
                  );
                },
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
