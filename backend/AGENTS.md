# Backend Agent Guide

## Project Snapshot
- Backend path: `backend`
- Purpose: control plane API + domain logic + worker pipeline for WhatsApp group agents.
- Stack target: Python 3.12, FastAPI, SQLAlchemy, Alembic, RQ (scaffold phase).

## Setup & Commands
- Run backend via Docker Compose from repo root:
  - `npm run dev`
- Use container execution for backend commands when needed:
  - `docker compose -f infra/compose/docker-compose.dev.yml exec backend uv run <command>`
- Keep `uv` as the package/runtime tool inside backend containers.

## Coding Rules
- Keep API routers in `src/kuuna_backend/api/routers` thin; call domain services.
- Keep domain modules separated by PRD entity boundaries (`templates`, `bindings`, `messages`, etc.).
- Keep queue jobs under `src/kuuna_backend/jobs` by pipeline stage.
- Keep integrations (`postgres`, `redis`, `s3`, `openai`, `sentry`) isolated in `src/kuuna_backend/integrations`.

## Testing Expectations
- Place tests under `backend/tests/{unit,integration,contract}`.
- Run focused tests for touched modules first, then broader checks before handoff.
- Add regression tests for each behavior change.

## Git & PR Workflow
- Keep commits scoped to one domain boundary when possible.
- Include migration notes when schema files are touched.
- Request review for auth, RBAC, retention/delete, and outbound-idempotency logic changes.

## Safety / Guardrails
- Request confirmation before destructive git/file operations.
- Do not log raw user content in app logs or Sentry payloads.
- Keep secrets in environment/secret manager only; never hardcode credentials.
