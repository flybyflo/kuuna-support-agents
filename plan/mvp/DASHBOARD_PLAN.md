# Dashboard Plan (MVP)

Base references:
- `plan/mvp/PRD.md`
- `plan/mvp/PROJECT_STRUCTURE_PLAN.md`
- `plan/mvp/DATABASE_PLAN.md`

Scope: implementation plan for the staff dashboard in `apps/dashboard` (Next.js 15 + TypeScript), covering auth, RBAC-scoped operations, domain views, and MVP acceptance criteria support.

---

## 1) Dashboard Objectives

1. Provide a secure staff-only UI for operating WhatsApp group agents.
2. Expose all required MVP operator workflows:
   - template versioning,
   - group binding lifecycle,
   - prompt/USER.md/knowledge draft-publish-rollback,
   - message/media visibility,
   - audit and traceability.
3. Enforce role-based permissions (Owner/Admin/Operator/Viewer) and group scoping in all UI routes.
4. Consume generated typed API client only (OpenAPI source of truth).
5. Keep UX operationally clear for support staff (status-first, action-first, failure-friendly).

---

## 2) In-Scope Dashboard Domains

From PRD sections 6, 7, 10, 11, 12:

- Authentication and session management
- User administration (admin-created users, role assignment, password reset init flow)
- Template management and template versioning
- Group binding/provisioning lifecycle visibility and actions
- Prompt + USER.md draft/publish/rollback controls
- Knowledge (common + group) draft/publish/rollback controls
- Messages/media/transcript browsing and search
- Audit and trace view per operation
- Operational status surfaces (pipeline states, publish/indexing readiness)

Out of scope (MVP dashboard):
- Customer-facing UI
- DM channel controls
- Self-service registration and 2FA setup UI

---

## 3) Information Architecture & Route Map

Target protected routes under `apps/dashboard/src/app/(protected)`:

```txt
(protected)/
├─ overview/                    # global ops summary
├─ templates/
│  ├─ page.tsx                  # list templates
│  ├─ [templateId]/page.tsx     # template details (versions, config)
│  └─ [templateId]/versions/[versionId]/page.tsx
├─ bindings/
│  ├─ page.tsx                  # list bindings/group status
│  ├─ create/page.tsx           # bind flow
│  └─ [bindingId]/page.tsx      # binding detail + lifecycle timeline
├─ prompts/
│  ├─ page.tsx                  # queue of draft/published prompt assets
│  └─ [instanceId]/page.tsx     # system prompt + USER.md controls
├─ knowledge/
│  ├─ common/page.tsx
│  ├─ groups/page.tsx
│  └─ groups/[groupId]/page.tsx
├─ messages/
│  ├─ page.tsx                  # message explorer
│  └─ [groupId]/page.tsx        # group conversation + media/transcripts
├─ audit/
│  ├─ page.tsx                  # append-only audit feed
│  └─ traces/[traceId]/page.tsx # trace drill-down
└─ admin/
   ├─ users/page.tsx            # create/manage users
   └─ assignments/page.tsx      # group assignments
```

Auth routes under `(auth)`:
- login
- first-password-change
- locked-account / too-many-attempts

---

## 4) RBAC + Action Matrix (UI-Level)

### Owner/Admin
- Can bind/unbind groups, publish/rollback, hard-delete, manage users.

### Operator
- Can create and edit drafts; can monitor assigned groups; cannot publish/rollback.

### Viewer
- Read-only in assigned groups; no mutations.

### Guardrail Implementation Plan
1. Route-level protection (server-side session + role gate).
2. Group-scope filtering in list/detail queries.
3. Component-level action guards (buttons/forms hidden/disabled + server enforcement).
4. Explicit permission error UI (`403` empty state with “request access” guidance).

---

## 5) Domain-by-Domain Delivery Plan

## 5.1 Auth + Session Foundation

Deliverables:
- Login form with lockout/rate-limit feedback states.
- First-login forced password-change flow.
- Protected layout with session refresh and logout.

Frontend files:
- `src/app/(auth)/login/page.tsx`
- `src/app/(auth)/first-password-change/page.tsx`
- `src/lib/auth/session.ts`
- `src/lib/auth/guards.ts`

Dependencies:
- Auth API endpoints + token/session strategy from backend.

Done when:
- Unauthenticated users cannot access protected routes.
- Must-change-password users are redirected to change page.

---

## 5.2 App Shell + Shared Infrastructure

Deliverables:
- Protected shell (sidebar, top status bar, breadcrumbs).
- Shared table/filter/pagination primitives.
- Shared status badges for draft/published/ready/failed/active/provisioning.
- Unified API error handling and retry UX.

Frontend files:
- `src/components/layout/*`
- `src/components/data-table/*`
- `src/components/status/*`
- `src/lib/api-client/index.ts`
- `src/lib/query/*`

Technical choices:
- Use generated OpenAPI TS client in `packages/api-client-ts`.
- Use React Query (or equivalent) for cache + mutation invalidation.
- Use Zod at form boundaries for frontend validation parity.

Done when:
- All domain pages can consume shared shell + primitives without duplication.

---

## 5.3 Templates + Version Management

PRD alignment: 7.1, 7.5, 7.8, 7.10.

Deliverables:
- Template list + detail pages.
- Version timeline with status transitions (draft/ready/published/archived).
- Readable config sections (model failover chain, tool permissions, egress policy).
- Clone-from-version capability for safe iterative drafting.

Key UX rules:
- Manual explicit template selection in bind flow.
- Published version clearly pinned and immutable in UI.

Done when:
- Admin can create template and prepare a publishable version.
- Operator can edit draft config but cannot publish.

---

## 5.4 Binding + Provisioning Lifecycle

PRD alignment: 7.1, 7.2, invariant #1.

Deliverables:
- Binding list with current active state per `provider_group_id`.
- Guided bind wizard:
  1) select group,
  2) select template version,
  3) review,
  4) submit,
  5) lifecycle progress (provision → health check → disclosure → active).
- Binding detail timeline with rollback/failure reason visibility.
- Unbind action with explicit “routing disabled, data retained” confirmation.

Guardrails:
- UI warns if group already has active binding.
- UI prohibits ambiguous group title selection; uses provider group ID as identity.

Done when:
- Admin can bind one group to one active instance with lifecycle visibility.

---

## 5.5 Prompt + USER.md Governance

PRD alignment: 7.5.

Deliverables:
- Editor screens for:
  - template system prompt draft,
  - instance USER.md draft.
- Version history panel.
- Publish/rollback actions with required confirmation and changelog note.

Role behavior:
- Operator: edit/save draft.
- Owner/Admin: publish/rollback.

Done when:
- Prompt updates are versioned and reversible from dashboard.

---

## 5.6 Knowledge Management (Common + Group)

PRD alignment: 7.6, 7.7.

Deliverables:
- Separate sections for common vs group knowledge.
- Draft/publish/rollback workflow for both scopes.
- Indexing state indicators (`queued`, `processing`, `ready`, `failed`).
- Retrieval precedence explanation in UI copy (`group > common`).

Operational UX:
- Block “mark as live” UI until backend reports index version `ready`.
- Show indexing jobs and retry action (if backend supports retry endpoint).

Done when:
- Staff can update knowledge with clear readiness state for retrieval usage.

---

## 5.7 Messages, Media, and Transcripts Explorer

PRD alignment: 7.3, 7.4, acceptance #3/#4.

Deliverables:
- Group-scoped message list with filters (date, sender, has media, deleted/edited).
- Message detail with event-sourced versions (original/edit/delete timeline).
- Media preview metadata + transcript display.
- Parse/transcription pipeline status per asset.

Constraints surfaced:
- Deleted content should appear as historical event but marked excluded from current retrieval context.
- Dedupe/idempotency metadata visible for ops debugging.

Done when:
- Operators can inspect persisted content and processing outcomes for assigned groups.

---

## 5.8 Audit + Traceability Views

PRD alignment: 7.13, acceptance #7.

Deliverables:
- Append-only audit event feed with filters by actor/action/entity/time.
- Trace drill-down page showing correlation ID across:
  - inbound event,
  - retrieval refs,
  - model selection/failover path,
  - outbound intent.
- Metadata-only display (no raw sensitive content in logs view).

Done when:
- Staff can trace “why did this response happen” from UI.

---

## 5.9 Admin Operations

PRD alignment: 6, 7.11, 7.12.

Deliverables:
- User create/edit/deactivate screens.
- Initial password set/reset initiation.
- Role assignment and group assignment management.
- Hard-delete action panel (admin-only), strongly gated and audited.

Done when:
- Admin can fully manage staff access and critical destructive actions.

---

## 6) API & Contract Integration Plan

1. Backend publishes OpenAPI spec in CI artifact.
2. Generate `packages/api-client-ts` from spec.
3. Dashboard imports only generated client + shared contracts.
4. Add compile-time CI check that no ad-hoc `fetch` to control-plane routes exists.

Contract checkpoints (must exist before each domain can start):
- Auth: session/login/password-change
- Templates/versions endpoints
- Bindings lifecycle endpoints
- Prompt/USER.md version endpoints
- Knowledge + indexing-status endpoints
- Messages/media/transcripts endpoints
- Audit/traces endpoints
- User/role/assignment endpoints

---

## 7) UX States and Error Strategy

For each mutation screen:
- optimistic or pending state indicator,
- explicit success state with immutable revision ID,
- structured failure state with retry + support correlation ID.

Global patterns:
- Empty states per route (“No templates yet”, “No bound groups”).
- Skeleton loading for primary tables.
- Non-blocking toast for transient failures; inline errors for form validation.

---

## 8) Testing Plan (Frontend)

## 8.1 Unit/Component
- Permission gates and role-based rendering.
- Status badge mapping and workflow state rendering.
- Form validation for template/knowledge/prompt editors.

## 8.2 Integration (UI + mocked API client)
- Bind wizard happy path + rollback path.
- Draft → publish → rollback flows.
- Messages/transcript rendering for edited/deleted message histories.

## 8.3 E2E Smoke (MVP release gate)
- Login as admin.
- Create template version.
- Bind group.
- Confirm visible inbound message/media.
- Publish prompt/knowledge update.
- Verify audit + trace entry is visible.

Test locations:
- `apps/dashboard/tests/unit/*`
- `apps/dashboard/tests/integration/*`
- `apps/dashboard/tests/e2e/*`

---

## 9) Milestone Sequence for Dashboard

## M1 — Foundation (Week 1)
- Auth/session/guards
- Protected shell + navigation
- API client wiring + query/mutation infrastructure

## M2 — Core Ops Surfaces (Week 2)
- Templates + versions
- Binding list + bind wizard + lifecycle timeline

## M3 — Content Governance (Week 3)
- Prompt + USER.md workflow
- Knowledge common/group workflow + indexing readiness states

## M4 — Observability + Messaging (Week 4)
- Messages/media/transcripts explorer
- Audit feed + trace drill-down
- Admin user/assignment management

## M5 — Hardening (Week 5)
- Permission audits on all actions
- Error/empty/loading states polish
- E2E smoke suite stabilization and release checklist

---

## 10) Dashboard Definition of Done (MVP)

Dashboard MVP is done when:

1. Admin can complete full template→binding activation flow in UI.
2. Operator can perform draft edits but cannot publish restricted actions.
3. Group/common knowledge flows are versioned and readiness-aware.
4. Messages/media/transcripts are searchable and operationally inspectable.
5. Audit + trace views support response-level investigation.
6. All UI contracts use generated typed client.
7. Role and group scope restrictions are consistently enforced and tested.

---

## 11) Risks & Mitigations (Dashboard-Specific)

1. **Contract churn between frontend/backend**
   - Mitigation: strict OpenAPI codegen cadence + version pinning.
2. **Permission drift across many routes**
   - Mitigation: centralized permission map and guard helpers.
3. **Operational overload in dense tables/views**
   - Mitigation: filter-first UX, clear status tags, shallow default columns.
4. **Async indexing/provisioning confusion**
   - Mitigation: explicit lifecycle timelines and status explanations.

---

## 12) Task Breakdown (Execution Checklist)

- [ ] 1.0 Auth and protected shell foundation
  - [ ] 1.1 Implement login, forced password change, lockout views
  - [ ] 1.2 Implement protected layout + navigation + role-aware menu
  - [ ] 1.3 Add shared API/query infrastructure and error handling

- [ ] 2.0 Templates and version lifecycle
  - [ ] 2.1 Build template list/detail pages
  - [ ] 2.2 Implement version create/edit/read flow
  - [ ] 2.3 Add publish/rollback controls with permission checks

- [ ] 3.0 Binding and runtime lifecycle
  - [ ] 3.1 Build binding list and status indicators
  - [ ] 3.2 Implement bind wizard (group + template version selection)
  - [ ] 3.3 Add binding timeline and unbind flow

- [ ] 4.0 Prompt, USER.md, and knowledge governance
  - [ ] 4.1 Implement prompt/USER.md draft editor and version history
  - [ ] 4.2 Implement common knowledge workflow (draft/publish/rollback)
  - [ ] 4.3 Implement group knowledge workflow + indexing readiness states

- [ ] 5.0 Messages/media and observability operations
  - [ ] 5.1 Implement messages explorer with version history and filters
  - [ ] 5.2 Implement media/transcript detail views
  - [ ] 5.3 Implement audit feed + trace drill-down

- [ ] 6.0 Admin and hardening
  - [ ] 6.1 Implement user/role/group assignment management screens
  - [ ] 6.2 Gate hard-delete action to admin with explicit confirmation
  - [ ] 6.3 Add unit/integration/e2e coverage and smoke checklist
