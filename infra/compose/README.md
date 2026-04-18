# Docker Compose (Development)

Use Docker for all local runs (frontend + backend + infra dependencies).

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

Code changes on host are reflected in containers automatically.
