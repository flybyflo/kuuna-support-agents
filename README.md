# Kuuna Support Agents

Staff-operated WhatsApp group agents with sandboxed runtimes, deterministic routing, and dashboard-based governance.

## Status
This repository currently contains the **MVP product specification** and initial project definition.

- PRD: `plan/mvp/PRD.md`

Implementation is planned around a single dev environment first.

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

## Next Step
Use the PRD to bootstrap implementation:
1. Compose stack and service skeletons
2. Core data model + migrations
3. OpenAPI contract and typed dashboard client
4. Ingestion/queue/agent execution pipeline
