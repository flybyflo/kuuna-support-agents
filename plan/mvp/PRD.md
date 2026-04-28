# PRD — WhatsApp Group Agents MVP

## 1. Document Info
- **Version:** 1.0
- **Date:** 2026-04-18
- **Status:** Approved for MVP build
- **Scope:** Single-environment MVP (dev only)

---

## 2. Product Summary
Build a staff-operated platform that runs **one sandboxed AI agent per WhatsApp group**, managed through a Next.js dashboard. Each agent is configured through a **group template**, connected to a WhatsApp group via a shared gateway, and responds in-group only when explicitly triggered.

The system ingests and stores all incoming group messages/media, transcribes audio/video, parses supported files, and indexes data for retrieval-augmented responses.

---

## 3. Goals
1. Create and manage WhatsApp-bound group agents from a dashboard.
2. Enforce deterministic routing: **1 WhatsApp group → 1 active agent instance**.
3. Provide robust context retrieval from:
   - group chat history,
   - group-specific knowledge,
   - common knowledge.
4. Support tool execution in isolated runtimes with template-based permissions.
5. Ensure full operational traceability (audit + structured logs + Sentry).

---

## 4. Non-Goals (MVP)
- No customer-facing dashboard.
- No direct messages (DM) support.
- No self-registration flow for staff users.
- No formal PR test gate required before merge (only deploy smoke gate).
- No hard usage quotas, no ingest size/duration limits, no backpressure controls in MVP.

---

## 5. Core Product Invariants
1. **Exactly one active agent binding per WhatsApp group** (`provider_group_id`).
2. Agents are **group-only** (no DM).
3. Unbound groups are never routed to an agent.
4. Ingestion is always-on at gateway level (all groups/messages/media are persisted and processed).
5. Runtime filesystem is ephemeral; persistent state lives only in DB/S3.
6. Group template is the source of truth for tools/model profile/egress policy.

---

## 6. User Roles (Staff Dashboard)
- **Owner/Admin**
  - Bind/unbind groups
  - Publish/rollback prompts and knowledge
  - Create users
  - Perform hard delete
- **Operator**
  - Create/edit drafts (system prompt, USER.md, knowledge)
  - Operational monitoring within assigned groups
- **Viewer (optional role in model)**
  - Read-only access for assigned groups

### Access Policy
- Dashboard is staff-only.
- Staff visibility is scoped by RBAC + group assignments.
- Customers have no dashboard access.

---

## 7. Functional Requirements

### 7.1 Group Binding and Provisioning
- Binding flow is atomic with rollback:
  1. Create binding + instance records (DB transaction)
  2. Provision runtime
  3. Health check
  4. Send welcome/disclosure message
  5. Mark active
- Template selection at binding is **manual and explicit**.
- Binding identity key is `provider_group_id` (not group title).

### 7.2 Agent Trigger Behavior
Agent responds only when one of the following is true:
1. User sends real WhatsApp @mention,
2. User replies to an agent message,
3. User sends prefix trigger (agent-name prefix style).

Additional constraints:
- In unbound groups, agent never responds (no route exists).
- Multiple responses per mention are allowed.
- If media context is still processing, send immediate status response and follow-up automatically when ready.

### 7.3 Ingestion and Processing
- Persist all inbound events by default.
- Process all media for all groups in MVP.
- Parse/transcribe in MVP:
  - all image types,
  - all audio types,
  - all video types,
  - `pdf`, `md`, `txt`.
- Security gate exists but runs in **observe-only / allow-all** mode for MVP.

### 7.4 Message Lifecycle Handling
- Message dedupe with unique `(provider_message_id, group_id)` semantics.
- Event-sourced updates: edits/deletes retained historically.
- RAG uses latest visible state (deleted content excluded from retrieval context).

### 7.5 Prompt Management
- **System Prompt:** per group template.
- **USER.md:** per agent instance (per WhatsApp group).
- Both follow governance:
  - Draft → Publish
  - Versioning
  - Rollback
- Permission split:
  - Operator edits drafts
  - Owner/Admin publishes/rolls back

### 7.6 Knowledge Management
Knowledge sources:
1. Chat history (group)
2. Group special knowledge
3. Common knowledge

Rules:
- Group special knowledge has precedence over common knowledge.
- Group and common knowledge are stored in separate indices.
- Knowledge follows versioned Draft → Publish → Rollback flow.
- Publish triggers async indexing; retriever reads only `ready` versions.
- Single global embedding model in MVP.

### 7.7 RAG and Context Assembly
- Retrieval strategy: hybrid recent + semantic.
- Global token/context budget.
- Ranking includes explicit source boost: `group_knowledge > common_knowledge`.
- Prompt injection model: retrieved/user content is always untrusted and cannot override policies.

### 7.8 Tooling and Sandbox
- Global tool catalog, versioned tools (template pins versions).
- Tool access controlled by group template only (no per-instance override).
- Tool risk classes required (`read`, `write`, `admin`).
- Egress policy is configured per group template.
- Tool execution must enforce hard timeouts with explicit user-facing failure messages.

### 7.9 Runtime Model
- One runtime container/VM per group instance.
- Base image is shared globally; templates define config.
- Runtime modes:
  - default on-demand
  - VIP `hot` mode
  - auto-downgrade from hot to on-demand after inactivity
- On-demand cold-start sends short status message.

### 7.10 Reliability and Failover
- OpenAI-only provider for MVP.
- Template-defined failover chain across OpenAI models.
- Maximum 2 failover hops per run.
- Outbound messaging is idempotent via `outbound_intent_id`.
- Per-group serial processing enforced with queue partition + DB advisory lock.
- Graceful deploy required (drain/requeue).

### 7.11 Security and Auth
- Local login (email/password), no registration page.
- Admin creates users and sets initial password.
- First login must force password change.
- Strong password policy required.
- No 2FA in MVP.
- Brute-force protection: rate limit + lockout.
- Secrets delivered via central secret manager + short-lived credentials.
- Encryption-at-rest: provider defaults in MVP.

### 7.12 Retention, Deletion, and DR
- Infinite retention by default.
- Admin-only hard delete available.
- Unbind behavior: deactivate routing, keep data.
- DR baseline:
  - Postgres PITR
  - S3 versioning enabled
  - restore runbook + periodic restore tests.

### 7.13 Observability
- Structured JSON logs only.
- No raw content in logs/Sentry (metadata only).
- Sentry for errors.
- Alerts in MVP: Ops WhatsApp group + Sentry (no email).
- Mandatory end-to-end trace/correlation ID across pipeline.

---

## 8. Technical Stack (MVP)
- **Dashboard:** Next.js 15, TypeScript
- **Control Plane:** TypeScript, Fastify, tRPC, Drizzle
- **Agent Framework:** TypeScript runtime agent
- **Gateway:** Baileys (WhatsApp)
- **Database:** PostgreSQL 16 + pgvector + RLS
- **Queue:** Redis 7 + BullMQ
- **File Storage:** S3-compatible object storage (env bucket + group prefixes)
- **Runtime:** Docker Compose, single host
- **Monitoring:** Sentry + structured logs

---

## 9. Data Model Requirements (High-Level)
Key entities:
- `group_templates`
- `template_versions` (prompt/model/tool/egress config)
- `agent_instances`
- `group_bindings`
- `messages`
- `message_versions` (edits/deletes)
- `media_assets`
- `transcripts`
- `knowledge_common_docs`, `knowledge_group_docs`
- `knowledge_versions`
- `embeddings`
- `outbound_intents`
- `audit_events`
- `users`, `roles`, `group_assignments`

Critical constraints:
- Unique active binding per `provider_group_id`
- Message idempotency uniqueness
- Audit table append-only

---

## 10. API Contract Requirements
- Control Plane exposes REST API with OpenAPI as source contract.
- Dashboard consumes generated typed client from OpenAPI spec.
- Service-to-service auth uses short-lived scoped tokens.

---

## 11. MVP Milestones
1. **Foundation**
   - Compose stack (DB, Redis, S3, API, worker, gateway, dashboard)
   - Auth + RBAC + user admin
2. **Core Routing & Lifecycle**
   - Group templates, bindings, runtime provisioning
   - Deterministic routing + trigger logic
3. **Ingestion & Processing**
   - Message/media persist + transcription + indexing pipeline
4. **Agent Execution**
   - Prompt assembly, tool execution, failover chain, policy checks
5. **Dashboard Operations**
   - Prompt/USER.md/knowledge drafts + publish + rollback
   - Audit + trace views
6. **Hardening**
   - Idempotency, retries, disclosure retry policy, DR checks, smoke deploy gate

---

## 12. Acceptance Criteria (MVP)
1. Admin can create template, bind a WhatsApp group, and activate one agent instance.
2. Agent only responds to allowed triggers in bound groups.
3. Inbound messages/media are persisted and searchable in staff dashboard.
4. Audio/video transcription and supported file extraction are stored and retrievable.
5. Agent responses use hybrid RAG including common + group knowledge with correct precedence.
6. Prompt and knowledge changes are versioned and publishable with rollback.
7. Every response is traceable (config versions, retrieval refs, model path, outbound intent).
8. Outbound dedupe prevents duplicate sends on retries.
9. Hard delete works for admins and is fully audited.
10. Pre-deploy smoke test validates ingest→route→reply pipeline.

---

## 13. Known MVP Risks
- Non-official WhatsApp integration risk (stability/compliance).
- No quotas/backpressure/limits may cause cost and queue spikes.
- No 2FA increases account takeover risk.
- OpenAI-only dependency risk despite model failover chain.

Mitigation is operational (alerts, audit, rate/lockout, DR, controlled rollout) and should be revisited post-MVP.
