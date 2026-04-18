# DR Runbook (Dev Baseline)

This runbook defines the MVP disaster-recovery baseline checks for the local Docker stack.

## Scope

- PostgreSQL backup + restore validation (non-destructive)
- Basic object-store durability assumptions (MinIO in dev; S3 versioning in production)

## Preconditions

- Docker daemon is running
- Compose file exists: `infra/compose/docker-compose.dev.yml`
- Postgres service can be started

## 1) Create Backup and Validate Restore

Use the smoke script:

```bash
just smoke-dr-restore
```

Equivalent direct command:

```bash
bash infra/compose/smoke/dr-backup-restore.sh
```

What it does:
1. Starts `postgres` if needed.
2. Creates a `pg_dump` of `kuuna`.
3. Creates a temporary DB (`kuuna_restore_smoke_<timestamp>`).
4. Restores the dump into the temporary DB.
5. Runs sanity checks (`public` tables > 0 and `alembic_version` present).
6. Drops the temporary DB.
7. Leaves the dump artifact under `infra/compose/smoke/artifacts/`.

## 2) Full Docker Smoke (Services + Migrations)

```bash
just smoke-docker
```

Checks:
- `postgres` healthy
- `redis` healthy
- backend `/health`
- gateway ops `/healthz`
- `alembic upgrade head`
- required core tables exist

## 3) Periodic Execution Recommendation

- Run `just smoke-all` before releases and after infra changes.
- Keep recent dump artifacts in CI or secure storage for auditability.

## 4) Production Notes

- Production should use managed Postgres PITR.
- Production S3 bucket should have versioning enabled and lifecycle rules defined.
- This dev runbook validates procedures only; it is not a substitute for production backup policy.
