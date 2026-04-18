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

## Sentry

- Sentry project: `kuuna-backend`
- Default CLI config in `backend/.sentryclirc`
- DSN env var in `infra/env/backend.env.example` (`SENTRY_DSN`)

## Media processing worker notes

- Inbound media assets are enqueued automatically via RQ (`default` queue).
- Worker entrypoint: `kuuna_backend.jobs.media_processing.process_media_asset_job`.

Backfill commands:

```bash
# enqueue all pending media assets

docker compose -f infra/compose/docker-compose.dev.yml exec backend \
  uv run python - <<'PY'
from kuuna_backend.jobs.media_processing import enqueue_pending_media_assets
print(enqueue_pending_media_assets(limit=1000))
PY

# retry failed media assets (after parser fixes)

docker compose -f infra/compose/docker-compose.dev.yml exec backend \
  uv run python - <<'PY'
from kuuna_backend.jobs.media_processing import enqueue_failed_media_assets_for_retry
print(enqueue_failed_media_assets_for_retry(limit=1000))
PY
```
