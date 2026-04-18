# Backend Scaffold

Control plane/API/domain scaffold.

Run through Docker Compose from repo root:

```bash
npm run dev
```

Execute backend commands inside container:

```bash
docker compose -f infra/compose/docker-compose.dev.yml exec backend uv run <command>
```
