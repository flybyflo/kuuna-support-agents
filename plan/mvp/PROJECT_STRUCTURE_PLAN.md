# Project Structure Plan (MVP)

Base document: `plan/mvp/PRD.md`  
Scope of this document: **project structure only** (scaffold, module boundaries, ownership, artifact layout)

---

## 1) Goal of this structure phase

Define an MVP-ready monorepo that cleanly supports the PRD invariants:

1. Deterministic 1:1 binding (WhatsApp Group ↔ Agent Instance)
2. Clear separation of Dashboard, Control Plane, Gateway, Worker, Runtime
3. Versioned templates/prompts/knowledge as core domain model
4. Full traceability (audit, trace IDs, idempotent outbound intents)
5. Future scalability without rewrite (strict module boundaries)

---

## 2) Target top-level layout

```txt
kuuna-support-agents/
├─ apps/
│  └─ dashboard/                      # Next.js 15 staff UI
├─ backend/                           # Python 3.12 (uv), FastAPI, domain, worker logic
├─ services/
│  ├─ gateway/                        # WhatsApp gateway adapter (neonize)
│  └─ runtime-agent/                  # Agent runner base image (PydanticAI)
├─ packages/
│  ├─ api-client-ts/                  # OpenAPI-generated TS client
│  └─ contracts/                      # event/schema constants (cross-service)
├─ infra/
│  ├─ compose/                        # docker-compose for dev
│  ├─ docker/                         # shared Dockerfiles/snippets
│  ├─ env/                            # .env.example, service env templates
│  └─ scripts/                        # bootstrap/smoke/DR helper scripts
├─ docs/
│  ├─ architecture/
│  ├─ runbooks/
│  └─ adr/
├─ plan/
│  └─ mvp/
│     ├─ PRD.md
│     └─ PROJECT_STRUCTURE_PLAN.md
└─ tasks/
```

---

## 3) Detailed module structure

### 3.1 `backend/` (control plane + domain)

```txt
backend/
├─ pyproject.toml
├─ uv.lock
├─ alembic.ini
├─ alembic/
│  ├─ env.py
│  └─ versions/
├─ src/kuuna_backend/
│  ├─ main.py                         # FastAPI app entry
│  ├─ config/
│  │  ├─ settings.py
│  │  └─ logging.py
│  ├─ api/
│  │  ├─ deps.py
│  │  ├─ routers/
│  │  │  ├─ auth.py
│  │  │  ├─ users.py
│  │  │  ├─ templates.py
│  │  │  ├─ bindings.py
│  │  │  ├─ messages.py
│  │  │  ├─ knowledge.py
│  │  │  └─ audit.py
│  │  └─ openapi.py
│  ├─ auth/                           # password policy, lockout, session/token
│  ├─ rbac/                           # roles + group assignments
│  ├─ domain/
│  │  ├─ templates/                   # group_templates + template_versions
│  │  ├─ bindings/                    # group_bindings + activation lifecycle
│  │  ├─ messages/                    # messages + versions + dedupe
│  │  ├─ media/                       # media assets/transcripts
│  │  ├─ knowledge/                   # common/group docs + versioning
│  │  ├─ retrieval/                   # hybrid retrieval + ranking
│  │  ├─ outbound/                    # outbound_intents + idempotency
│  │  └─ audit/                       # append-only audit events
│  ├─ jobs/
│  │  ├─ queue.py                     # Redis/RQ setup
│  │  ├─ ingest.py
│  │  ├─ media_processing.py
│  │  ├─ indexing.py
│  │  └─ outbound_dispatch.py
│  ├─ integrations/
│  │  ├─ postgres.py
│  │  ├─ redis.py
│  │  ├─ s3.py
│  │  ├─ openai.py
│  │  ├─ sentry.py
│  │  └─ secrets.py
│  └─ observability/
│     ├─ trace.py
│     └─ events.py
└─ tests/
   ├─ unit/
   ├─ integration/
   └─ contract/
```

**Rule:** API routers call domain services, not direct DB query logic (except very simple read-model endpoints).

---

### 3.2 `services/gateway/` (WhatsApp ingest/dispatch)

```txt
services/gateway/
├─ src/
│  ├─ app.py                          # gateway process entry
│  ├─ ingest_handler.py               # inbound events -> backend ingest endpoint/queue
│  ├─ outbound_handler.py             # outbound send with intent idempotency key
│  ├─ mapping.py                      # provider payload -> internal event schema
│  └─ health.py
└─ tests/
```

**Rule:** Gateway owns transport + normalization only. No business logic for trigger/RAG decisions.

---

### 3.3 `services/runtime-agent/` (base agent image)

```txt
services/runtime-agent/
├─ Dockerfile
├─ src/
│  ├─ runner.py                       # request -> model/tool execution
│  ├─ prompt_builder.py               # system + user + retrieved context assembly
│  ├─ tool_executor.py                # timeout + risk class enforcement
│  ├─ failover.py                     # max 2 hops per PRD
│  └─ result_schema.py
└─ tests/
```

**Rule:** Runtime is stateless/ephemeral. Persistence happens via backend APIs only.

---

### 3.4 `apps/dashboard/`

```txt
apps/dashboard/
├─ src/
│  ├─ app/
│  │  ├─ (auth)/
│  │  ├─ (protected)/
│  │  │  ├─ templates/
│  │  │  ├─ bindings/
│  │  │  ├─ knowledge/
│  │  │  ├─ messages/
│  │  │  └─ audit/
│  ├─ lib/
│  │  ├─ api-client/                  # imported from packages/api-client-ts
│  │  ├─ auth/
│  │  └─ permissions/
│  └─ components/
└─ tests/
```

**Rule:** Dashboard consumes the generated OpenAPI client only (no ad-hoc contracts).

---

### 3.5 `packages/`

- `packages/api-client-ts`: generated from backend OpenAPI.
- `packages/contracts`: event names, queue payload schemas, trace/correlation ID header constants.

---

## 4) Binding architecture decisions (structure-level)

1. **Polyglot monorepo**: Next.js + Python + small service adapters.
2. **OpenAPI as source of truth** for dashboard API consumption.
3. **DB-first domain modules** with strict entity boundaries.
4. **Queue workloads in backend context**, not in gateway.
5. **Template is data model**, not image.
6. **Shared base agent image**, template version defines runtime behavior.

---

## 5) Task breakdown — project structure

### 5.1 Parent tasks

- [ ] 1.0 Scaffold repository structure
- [x] 2.0 Define backend structure + domain boundaries
- [x] 3.0 Scaffold gateway and runtime service structure
- [ ] 4.0 Structure shared packages (OpenAPI client + contracts)
- [ ] 5.0 Set up infra and runbook structure
- [ ] 6.0 Validate structure (health-only smoke on empty scaffold)

### 5.2 Subtasks

- [x] 1.1 Create top-level folders (`apps/backend/services/packages/infra/docs/tasks`)
- [x] 1.2 Document root conventions (`README` section: repository layout)
- [ ] 1.3 Define naming rules (snake_case for Python, kebab-case for TS paths)

- [x] 2.1 Create `backend/src/kuuna_backend` module tree
- [x] 2.2 Add `domain/*` modules by PRD entity boundaries
- [x] 2.3 Add `api/routers/*` by role + domain responsibilities
- [x] 2.4 Split `jobs/*` by pipeline stage
- [x] 2.5 Create base test layout (`unit|integration|contract`)

- [x] 3.1 Create `services/gateway` adapter skeleton
- [x] 3.2 Create `services/runtime-agent` runner skeleton + Dockerfile
- [x] 3.3 Document interface boundaries (input/output payloads)

- [x] 4.1 Create `packages/contracts` skeleton (shared constants/schemas)
- [x] 4.2 Create `packages/api-client-ts` structure for codegen output
- [ ] 4.3 Document codegen flow (backend spec -> TS client)

- [x] 5.1 Create `infra/compose` structure for dev stack
- [x] 5.2 Create `infra/env/.env.example` with service sections
- [x] 5.3 Add runbook placeholders in `docs/runbooks` (smoke/deploy/DR)
- [ ] 5.4 Add first ADR in `docs/adr` (“Monorepo + Service Boundaries”)

- [x] 6.1 Bring up minimal compose smoke (no business logic)
- [ ] 6.2 Add health endpoints per service for structure testing
- [ ] 6.3 Complete and document “Definition of Done – structure phase”

---

## 6) Definition of Done (structure only)

This phase is done when:

1. All target folders + service entry points exist.
2. Team can clearly see where each feature belongs.
3. OpenAPI -> TS client path is prepared (even with empty endpoints).
4. Gateway/runtime/backend responsibilities are documented.
5. A health-only end-to-end compose smoke is possible.

---

## 7) Next planning step

After structure planning:

- Data model planning (tables, constraints, indexes, RLS baseline)
- API contract planning (first endpoint groups)
- Queue pipeline planning (ingest -> process -> retrieve -> reply)
