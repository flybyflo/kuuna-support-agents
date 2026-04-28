# Dashboard (MVP Work-In-Progress)

Staff dashboard built with Next.js 15 + TypeScript.

## Current implementation (phase 1)

- Auth routes: `/login`, `/first-password-change`, `/locked`
- Protected shell with role-aware sidebar and sign-out
- Domain routes scaffolded and functional with mocked API data:
  - `/overview`
  - `/templates`, `/templates/[templateId]`
  - `/bindings`, `/bindings/create`, `/bindings/[bindingId]`
  - `/prompts`, `/prompts/[instanceId]`
  - `/knowledge/common`, `/knowledge/groups`, `/knowledge/groups/[groupId]`
  - `/messages`, `/messages/[groupId]`
  - `/audit`, `/audit/traces/[traceId]`
  - `/admin/users`, `/admin/assignments`

## Development

### Database-backed auth/data (new)

The dashboard now attempts to read from PostgreSQL directly on server-side pages/actions.
It tries these connection strings in order:

1. `DATABASE_URL`
2. `DASHBOARD_DATABASE_URL`
3. `postgresql://postgres:postgres@postgres:5432/kuuna`
4. `postgresql://postgres:postgres@localhost:5432/kuuna`

Auth is validated against `users` + `roles` + `user_roles` + `group_assignments`.

A required admin account invariant is enforced:
- email: `admin@kuuna.ai`
- password bootstrap env: `DASHBOARD_REQUIRED_ADMIN_PASSWORD` (default `admin123456!`)

On login/admin-user-page access, the app ensures this account + admin role assignment exist.


Run through Docker Compose from repo root:

```bash
pnpm dev
```

Execute frontend commands inside container:

```bash
docker compose -f infra/compose/docker-compose.dev.yml exec dashboard <command>
```

## Sentry

The dashboard uses `@sentry/nextjs` with runtime initialization files:

- `instrumentation.ts`
- `instrumentation-client.ts`
- `sentry.server.config.ts`
- `sentry.edge.config.ts`

Sentry project: `kuuna-dashboard`

Required env vars (already set in `infra/env/dashboard.env.example`):

- `SENTRY_DSN`
- `NEXT_PUBLIC_SENTRY_DSN`
- `SENTRY_ENVIRONMENT`
- `NEXT_PUBLIC_SENTRY_ENVIRONMENT`

## Quality checks

```bash
pnpm typecheck
pnpm lint
pnpm build
```
