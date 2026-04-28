# Backend TS

Parallel TypeScript/tRPC backend migration target for the Kuuna control plane.

This service is intentionally additive during migration:

- Python FastAPI remains the production-compatible backend on port `8000`.
- TypeScript backend runs on port `8010` for parity work.
- Alembic remains the schema migration source until cutover.
- Drizzle models the existing PostgreSQL schema without generating migrations.

Run locally through Compose from the repository root:

```bash
npm run dev
```

Direct development commands:

```bash
npm run dev --workspace @kuuna/backend-ts
npm run typecheck --workspace @kuuna/backend-ts
npm run test --workspace @kuuna/backend-ts
```

The TypeScript worker is intentionally not part of the default Compose profile yet, because the
Python RQ worker remains the behavioral owner during parity work. To start the TS worker during
cutover experiments:

```bash
docker compose -f infra/compose/docker-compose.dev.yml --profile backend-ts-cutover up worker-ts
```
