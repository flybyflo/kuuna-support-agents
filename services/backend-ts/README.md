# Backend TS

TypeScript/tRPC backend for the Kuuna control plane.

This service owns the active TypeScript backend path:

- TypeScript backend runs as the default backend service.
- Drizzle models the PostgreSQL schema.
- Drizzle SQL migrations in `services/backend-ts/drizzle/` are the only supported schema migration path.
- New TypeScript-backend schema changes are applied through `pnpm --filter @kuuna/backend-ts db:migrate`.
- Applied migrations are tracked in the `__kuuna_drizzle_migrations` table.

Run locally through Compose from the repository root:

```bash
pnpm dev
```

Direct development commands:

```bash
pnpm --filter @kuuna/backend-ts dev
pnpm --filter @kuuna/backend-ts db:migrate
pnpm --filter @kuuna/backend-ts typecheck
pnpm --filter @kuuna/backend-ts test
```

Migration files must use the `0000_name.sql` filename format. The migration
runner validates file names, applies pending files in lexical order, and skips
already recorded files.

Contract tests that need a disposable Postgres target are gated by
`BACKEND_TS_CONTRACT_DATABASE_URL`. They create and drop an isolated schema per test case:

```bash
BACKEND_TS_CONTRACT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/kuuna \
  pnpm --filter @kuuna/backend-ts test
```

The TypeScript worker is part of the default Compose stack and uses the same Drizzle schema.
