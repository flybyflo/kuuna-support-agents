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
- **Control Plane:** TypeScript Fastify + tRPC + Drizzle, with Alembic still owning current migrations
- **Agent runtime framework:** TypeScript Pi runtime
- **WhatsApp gateway:** Baileys
- **DB:** PostgreSQL 16 + pgvector + RLS
- **Queue:** Redis + BullMQ
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

## Sentry Setup (Current)
- Sentry org default is configured in repo root `.sentryclirc`:
  - org: `calumba`
- Service-specific Sentry projects are configured:
  - Backend → `kuuna-backend`
  - Dashboard → `kuuna-dashboard`
  - Gateway → `kuuna-gateway`
- Service-local `.sentryclirc` defaults:
  - `backend/.sentryclirc`
  - `apps/dashboard/.sentryclirc`
  - `services/gateway/.sentryclirc`
- DSNs are pre-wired in dev env templates:
  - `infra/env/backend.env.example` (backend project DSN)
  - `infra/env/dashboard.env.example` (dashboard project DSN)
  - `infra/env/gateway.env.example` (gateway project DSN)
- Backend and gateway send scrubbed events (metadata-only intent).
- Dashboard initializes Sentry for client/server/edge via `@sentry/nextjs`.

## Repository Layout (Scaffold)
- `apps/dashboard` - Next.js 15 + TypeScript dashboard scaffold
- `backend` - Python Alembic migrations and legacy backend reference
- `services/backend-ts` - TypeScript control plane API and worker
- `services/gateway` - TypeScript WhatsApp gateway using Baileys
- `services/runtime-agent-ts` - TypeScript Pi runtime agent used by Compose and per-group containers
- `packages/api-client-ts` - shared typed backend API client and dashboard read models
- `packages/contracts` - shared gateway/event contracts
- `packages/agent-contracts` - shared runtime request/result contracts
- `infra` - compose/env/scripts placeholders
- `docs` - architecture/runbooks/ADR placeholders

## Local Setup (Docker-only via Just)
Run everything through the dev stack:

```bash
just up
```

(or via npm wrapper: `npm run dev`)

## TypeScript Monorepo Commands

The TypeScript packages are wired as npm workspaces and orchestrated with Turborepo:

```bash
npm run typecheck
npm run test
npm run build
npm run lint
```

These commands cover `apps/dashboard`, `services/runtime-agent-ts`, and shared packages under `packages/*`.

Services:
- Dashboard: http://localhost:3000
- Backend API: http://localhost:8000
- Worker: background service (BullMQ)
- Gateway: background service (Baileys)
- MinIO: http://localhost:9001

For WhatsApp mentions, set `AGENT_MENTION_IDS` in `infra/env/backend.env.local` to the actual bot JID(s), comma-separated. Text aliases such as `@agent` and `@kuuna` are controlled by `AGENT_MENTION_ALIASES`.

Stop all services:

```bash
just down
```

## Docker Smoke + DR Baseline

Run migration/service smoke:

```bash
just smoke-docker
```

Run backup/restore smoke:

```bash
just smoke-dr-restore
```

Run both:

```bash
just smoke-all
```

See also: `infra/compose/DR_RUNBOOK.md`.

## Hot Reload
- Frontend: Next.js HMR (`next dev`) in container.
- Backend API: `tsx watch` in container.
- Worker: `tsx watch` in container.
- Gateway: `tsx watch` runs the Baileys gateway in container.
- Source code is bind-mounted into containers.

## WhatsApp Session Persistence
- Gateway stores Baileys auth/session state in Docker volume `gateway_session`.
- Auth state path is `BAILEYS_AUTH_DIR=/data/baileys-auth`.
- Restarting containers keeps the WhatsApp session; removing the volume resets it.
- Existing Neonize sessions in `/data/neonize.db` cannot be reused by Baileys.
  On first Baileys start, scan the QR printed in the gateway logs or read it from
  `GET /ops/qr`.

## Next Step
1. Replace the remaining dashboard direct-DB fallback paths with generated OpenAPI calls.
2. Harden production runtime provisioning defaults for the Hetzner host network and secret store.
3. Add end-to-end smoke coverage against Docker Compose with a live WhatsApp test account.
