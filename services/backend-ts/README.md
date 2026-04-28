# Backend TS

Parallel TypeScript/tRPC backend migration target for the Kuuna control plane.

This service owns the active TypeScript backend path:

- TypeScript backend runs as the default backend service.
- Drizzle models the PostgreSQL schema.
- New TypeScript-backend schema changes are applied through `npm run db:migrate --workspace @kuuna/backend-ts`.

Run locally through Compose from the repository root:

```bash
npm run dev
```

Direct development commands:

```bash
npm run dev --workspace @kuuna/backend-ts
npm run db:migrate --workspace @kuuna/backend-ts
npm run typecheck --workspace @kuuna/backend-ts
npm run test --workspace @kuuna/backend-ts
```

Contract tests that need a disposable Postgres target are gated by
`BACKEND_TS_CONTRACT_DATABASE_URL`. They create and drop an isolated schema per test case:

```bash
BACKEND_TS_CONTRACT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/kuuna \
  npm run test --workspace @kuuna/backend-ts
```

The TypeScript worker is intentionally not part of the default Compose profile yet, because the
Python RQ worker remains the behavioral owner during parity work. To start the TS worker during
cutover experiments:

```bash
docker compose -f infra/compose/docker-compose.dev.yml --profile backend-ts-cutover up worker-ts
```
