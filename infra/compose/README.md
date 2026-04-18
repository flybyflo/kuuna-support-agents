# Docker Compose (Development)

Use Docker for all local runs (frontend + backend + gateway + infra dependencies).

## Start
```bash
docker compose -f infra/compose/docker-compose.dev.yml up --build
```

## Stop
```bash
docker compose -f infra/compose/docker-compose.dev.yml down
```

## Hot Reload
- Dashboard: Next.js dev server runs with bind mount (`apps/dashboard:/app`).
- Backend: `uvicorn --reload` runs with bind mount (`backend:/app`).
- Gateway: source is bind-mounted (`services/gateway:/app`); restart service to pick up code changes.

## WhatsApp Session Persistence (Gateway)
The gateway stores Neonize session state in the named Docker volume `gateway_session` at `/data`.
`NEONIZE_DATABASE_PATH` defaults to `/data/neonize.db`, so login/session state survives container restarts.

Reset session state intentionally:

```bash
docker volume rm kuuna-dev_gateway_session
```
