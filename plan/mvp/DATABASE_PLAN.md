# Database Plan (MVP)

Base references:
- `plan/mvp/PRD.md`
- `plan/mvp/PROJECT_STRUCTURE_PLAN.md`

Scope: relational schema, constraints, and migration order for MVP backend on PostgreSQL 16 + pgvector.

---

## 1) Database Objectives

1. Enforce deterministic group binding invariants at DB level.
2. Guarantee idempotency for inbound and outbound messaging.
3. Support versioned prompts/knowledge with safe publish/rollback.
4. Preserve auditability with append-only event history.

---

## 2) Extensions and Baseline

Required extensions:
- `pgcrypto` (UUID generation)
- `vector` (pgvector embeddings)

Timezone policy:
- Store all timestamps as `timestamptz` in UTC.

ID policy:
- Internal primary keys as UUID (`gen_random_uuid()`).

---

## 3) Core Tables (MVP)

## 3.1 Identity and Access
- `users`
  - `id`, `email` (unique), `password_hash`, `must_change_password`, `is_active`, timestamps
- `roles`
  - `id`, `name` (`owner|admin|operator|viewer`), unique
- `user_roles`
  - composite unique (`user_id`, `role_id`)
- `group_assignments`
  - unique (`user_id`, `provider_group_id`)

## 3.2 Template and Binding Domain
- `group_templates`
  - `id`, `key` (unique), `display_name`, timestamps
- `template_versions`
  - `id`, `template_id`, `version_no`, `status` (`draft|ready|published|archived`)
  - config JSON fields for model/tool/egress policies
  - unique (`template_id`, `version_no`)
- `group_bindings`
  - `id`, `provider_group_id`, `template_version_id`, `status`, timestamps
  - partial unique index: one active binding per `provider_group_id`
- `agent_instances`
  - `id`, `group_binding_id` (unique), `runtime_mode`, `status`, timestamps

## 3.3 Messaging and Media
- `messages`
  - `id`, `provider_group_id`, `provider_message_id`, `sender_provider_user_id`, `latest_version_no`, timestamps
  - unique (`provider_group_id`, `provider_message_id`)
- `message_versions`
  - `id`, `message_id`, `version_no`, `event_type`, `is_deleted`, `text`, `raw_event` (JSONB), timestamps
  - `raw_event` stores the full normalized inbound event payload for audit/debug/replay
  - unique (`message_id`, `version_no`)
- `media_assets`
  - `id`, `message_id`, `provider_media_id`, `mime_type`, `s3_key`, `status`, metadata
- `transcripts`
  - `id`, `media_asset_id` (unique), `text`, `language`, `status`, timestamps

## 3.4 Knowledge and Retrieval
- `knowledge_common_docs`
  - `id`, `doc_key`, `title`, timestamps
- `knowledge_group_docs`
  - `id`, `provider_group_id`, `doc_key`, `title`, timestamps
- `knowledge_versions`
  - `id`, `scope` (`common|group`), `doc_ref_id`, `version_no`, `status`, `content_markdown`, timestamps
- `embeddings`
  - `id`, `scope`, `source_version_id`, `chunk_no`, `embedding vector`, `token_count`, `content`, timestamps

## 3.5 Execution and Audit
- `outbound_intents`
  - `id`, `outbound_intent_id` (unique), `provider_group_id`, `status`, `attempt_count`, payload, timestamps
- `audit_events`
  - `id`, `actor_user_id` nullable, `event_type`, `entity_type`, `entity_id`, `payload`, `created_at`
  - append-only enforcement via trigger/policy

---

## 4) Critical Constraints

1. **One active binding per group**
   - Partial unique index on `group_bindings(provider_group_id)` where `status='active'`.

2. **Inbound idempotency**
   - Unique (`provider_group_id`, `provider_message_id`) on `messages`.

3. **Outbound idempotency**
   - Unique `outbound_intent_id` on `outbound_intents`.

4. **Append-only audit**
   - Block `UPDATE/DELETE` on `audit_events`.

5. **Version monotonicity**
   - Unique (`template_id`, `version_no`) and (`message_id`, `version_no`).

---

## 5) Indexing Strategy (MVP)

1. `messages(provider_group_id, created_at desc)` for recent retrieval.
2. `message_versions(message_id, version_no desc)` for latest state resolution.
3. `knowledge_versions(status, scope, updated_at desc)` for publish/read path.
4. `embeddings` vector index (HNSW or IVFFLAT) with model-specific dimension.
5. `outbound_intents(provider_group_id, created_at desc)` for ops tracing.

---

## 6) RLS Baseline Plan

MVP introduces RLS for staff-scoped reads:

- Enable RLS on group-scoped tables (`group_bindings`, `messages`, `knowledge_group_docs`, etc.).
- Session context carries staff user ID + role claims.
- Policy logic:
  - owner/admin: broad access
  - operator/viewer: limited to assigned groups

If RLS rollout risks schedule, ship with ownership-ready schema + policies in disabled state and enable in hardening milestone.

---

## 7) Migration Order

1. `0001_extensions` (`pgcrypto`, `vector`)
2. `0002_auth_rbac` (`users`, `roles`, `user_roles`, `group_assignments`)
3. `0003_templates_bindings_instances`
4. `0004_messages_media_transcripts`
5. `0005_knowledge_versions_embeddings`
6. `0006_outbound_and_audit`
7. `0007_indexes_and_constraints_hardening`
8. `0008_rls_baseline`

---

## 8) Seed Data Plan

- Seed roles (`owner`, `admin`, `operator`, `viewer`).
- Seed one bootstrap admin user (env-provided credentials in dev only).
- Seed one `group_template` + initial `template_version` draft for smoke flow.

---

## 9) Task Breakdown

- [ ] 1.0 Finalize ERD and table contracts in docs
- [x] 2.0 Create Drizzle migration chain
- [x] 3.0 Implement Drizzle schema aligned to constraints
- [ ] 4.0 Add repository-level idempotency checks for messages/intents
- [x] 5.0 Add append-only audit enforcement
- [ ] 6.0 Add migration smoke tests in Docker dev

---

## 10) Done Criteria

1. All core tables and constraints exist in migration chain.
2. Duplicate inbound/outbound events are safely deduped.
3. Active binding uniqueness is guaranteed at DB level.
4. Audit events are append-only by enforcement, not convention.
5. DB bootstrap + migration succeeds in Docker dev stack.
