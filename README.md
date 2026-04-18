# Kuuna Support Agents

Staff-operated WhatsApp group agents with sandboxed runtimes, deterministic routing, and dashboard-based governance.

## Status
This repository now contains the **MVP planning docs plus an initial implementation scaffold**.

- PRD: `plan/mvp/PRD.md`
- Project structure plan: `plan/mvp/PROJECT_STRUCTURE_PLAN.md`
- Agent guides: `AGENTS.md`, `apps/dashboard/AGENTS.md`, `backend/AGENTS.md`

Implementation is still targeting a single dev environment first.

## MVP Overview
- One agent instance per WhatsApp group (strict 1:1 active binding)
- WhatsApp group gateway ingestion (messages + media)
- Group-triggered responses (mention/reply/prefix trigger)
- Sandboxed per-group runtime (ephemeral FS; persistence in DB/S3)
- RAG from:
  - group chat history
  - group-specific knowledge
  - common knowledge
- Dashboard for staff to:
  - manage templates, agents, and bindings
  - manage prompts and knowledge (draft/publish/rollback)
  - manage staff users (no self-registration)

## Planned Tech Stack (MVP)
- **Dashboard:** Next.js 15 + TypeScript
- **Control Plane:** FastAPI + Pydantic v2 + SQLAlchemy + Alembic
- **Agent runtime framework:** PydanticAI
- **WhatsApp gateway:** neonize
- **DB:** PostgreSQL 16 + pgvector + RLS
- **Queue:** Redis + RQ
- **Storage:** S3-compatible object storage
- **Observability:** Sentry + structured JSON logs
- **Deployment:** Docker Compose on single host

## Product Principles
- Deterministic routing (`provider_group_id` => exactly one active agent binding)
- Full auditability (append-only audit events)
- Versioned prompts and knowledge with controlled publish/rollback
- Group template as source of truth for tools/model/egress policy
- Strong data traceability via end-to-end trace IDs

## Security and Operations (MVP)
- Staff-only dashboard
- Local login (admin-created users, forced password change on first login)
- Brute-force protections (rate limit + lockout)
- Tool execution with template policy and hard timeouts
- Error monitoring via Sentry
- Ops alerts via WhatsApp operations group

## Repository Layout (Scaffold)
- `apps/dashboard` — Next.js 15 + TypeScript dashboard scaffold
- `backend` — FastAPI + domain/worker scaffold (managed with `uv`)
- `services/gateway` — WhatsApp gateway adapter scaffold
- `services/runtime-agent` — base runtime image scaffold
- `packages/api-client-ts` — OpenAPI-generated TS client package scaffold
- `packages/contracts` — shared cross-service contracts scaffold
- `infra` — compose/env/scripts placeholders
- `docs` — architecture/runbooks/ADR placeholders

## Local Setup (Docker-only)
Run everything through Docker Compose:

```bash
npm run dev
```

Services:
- Dashboard: http://localhost:3000
- Backend API: http://localhost:8000
- MinIO: http://localhost:9001

Stop all services:

```bash
npm run dev:down
```

## Hot Reload
- Frontend hot reload is enabled via Next.js dev server in container.
- Backend hot reload is enabled via `uvicorn --reload` in container.
- Source code is mounted into containers with bind volumes.

## Next Step
1. Data model + first Alembic migrations
2. Auth + RBAC baseline
3. OpenAPI contract + TS client generation flow
4. Ingest -> process -> retrieve -> reply pipeline
