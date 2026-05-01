# Docker Compose (Development)

Use Docker for frontend, backend API, gateway, and infra dependencies. AI runtime
execution is handled by the host-level backend worker through Gondolin VMs.

## Start
```bash
just up
```

This starts the normal control-plane stack. Runtime agents are not long-running
Compose services; they are created on demand as per-chat Gondolin VMs by a
backend worker running on a host with QEMU and Gondolin guest assets.
Set `RUNTIME_GONDOLIN_ASSET_REF` for the host worker after building the default
runtime asset.

## Stop
```bash
just down
```

## Hot Reload
- Dashboard: Next.js dev server runs with bind mount (`apps/dashboard:/app`).
- Backend API: `tsx watch` runs the TypeScript backend with bind-mounted source.
- Worker: `tsx watch` runs the TypeScript BullMQ worker with bind-mounted source.
- Gateway: `tsx watch` runs the Baileys TypeScript gateway with bind-mounted source.

## WhatsApp Session Persistence (Gateway)
The gateway stores Baileys auth/session state in the named Docker volume `gateway_session` at `/data`.
`BAILEYS_AUTH_DIR` defaults to `/data/baileys-auth`, so login/session state survives container restarts.

Reset session state intentionally:

```bash
docker volume rm kuuna-dev_gateway_session
```

## Smoke Gates

Run Docker smoke checks (services + migrations):

```bash
just smoke-docker
```

Run backup/restore DR baseline smoke:

```bash
just smoke-dr-restore
```

Run both:

```bash
just smoke-all
```

Scripts:
- `infra/compose/smoke/docker-smoke.sh`
- `infra/compose/smoke/dr-backup-restore.sh`

Restore runbook:
- `infra/compose/DR_RUNBOOK.md`

## Database Migrations

Compose runs migrations through the TypeScript backend service:

```bash
just migrate
```

This invokes `pnpm --filter @kuuna/backend-ts db:migrate` in the `migrate`
container. The runner uses `drizzle-orm`, reads `.sql` files from
`services/backend-ts/drizzle/`, and records applied files in
`__kuuna_drizzle_migrations`.
