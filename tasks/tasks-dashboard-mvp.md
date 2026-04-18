## Relevant Files

- `apps/dashboard/src/app/(auth)/login/page.tsx` - Staff login screen with lockout/rate-limit messaging.
- `apps/dashboard/src/app/(auth)/first-password-change/page.tsx` - Forced password-change flow for first login.
- `apps/dashboard/src/app/(protected)/layout.tsx` - Protected app shell and route guard wrapper.
- `apps/dashboard/src/app/(protected)/overview/page.tsx` - Operational dashboard landing page.
- `apps/dashboard/src/app/(protected)/templates/page.tsx` - Template list with filtering/status.
- `apps/dashboard/src/app/(protected)/templates/[templateId]/page.tsx` - Template detail and version management.
- `apps/dashboard/src/app/(protected)/bindings/page.tsx` - Group bindings list and status.
- `apps/dashboard/src/app/(protected)/bindings/create/page.tsx` - Binding wizard flow.
- `apps/dashboard/src/app/(protected)/bindings/[bindingId]/page.tsx` - Binding lifecycle timeline and unbind action.
- `apps/dashboard/src/app/(protected)/prompts/[instanceId]/page.tsx` - System prompt + USER.md draft/publish/rollback UI.
- `apps/dashboard/src/app/(protected)/knowledge/common/page.tsx` - Common knowledge management.
- `apps/dashboard/src/app/(protected)/knowledge/groups/[groupId]/page.tsx` - Group-specific knowledge management.
- `apps/dashboard/src/app/(protected)/messages/page.tsx` - Message explorer with filters.
- `apps/dashboard/src/app/(protected)/messages/[groupId]/page.tsx` - Message detail timeline + media/transcripts.
- `apps/dashboard/src/app/(protected)/audit/page.tsx` - Audit event feed.
- `apps/dashboard/src/app/(protected)/audit/traces/[traceId]/page.tsx` - End-to-end trace inspection.
- `apps/dashboard/src/app/(protected)/admin/users/page.tsx` - Staff user management.
- `apps/dashboard/src/app/(protected)/admin/assignments/page.tsx` - Role/group assignment management.
- `apps/dashboard/src/lib/api-client/index.ts` - Generated API client adapter wiring.
- `apps/dashboard/src/lib/auth/session.ts` - Session/token helpers.
- `apps/dashboard/src/lib/auth/guards.ts` - Route and action guard helpers.
- `apps/dashboard/src/lib/permissions/matrix.ts` - Central RBAC matrix and checks.
- `apps/dashboard/src/components/layout/*` - Shared app shell and navigation.
- `apps/dashboard/src/components/status/*` - Status pills/badges for lifecycle states.
- `apps/dashboard/src/components/data-table/*` - Reusable table/filter/pagination primitives.
- `apps/dashboard/tests/unit/permissions/*.test.ts` - Unit tests for RBAC and guards.
- `apps/dashboard/tests/integration/bindings/*.test.tsx` - Integration tests for binding wizard/lifecycle.
- `apps/dashboard/tests/integration/knowledge/*.test.tsx` - Integration tests for knowledge workflows.
- `apps/dashboard/tests/e2e/mvp-smoke.spec.ts` - End-to-end MVP smoke flow.

### Notes

- Use generated OpenAPI client only; avoid ad-hoc API contracts.
- Keep domain ownership in `src/app/(protected)/*` routes.
- Add/adjust tests with every behavior change.
- Prefer container execution for frontend commands when needed:
  - `docker compose -f infra/compose/docker-compose.dev.yml exec dashboard <command>`

## Tasks

- [ ] 1.0 Build auth/session foundation and protected shell
  - [ ] 1.1 Implement login page with lockout and invalid-credential states
  - [ ] 1.2 Implement first-login forced password-change page
  - [ ] 1.3 Add session bootstrap + protected layout redirects
  - [ ] 1.4 Add logout and session-expired UX
  - [ ] 1.5 Implement role-aware navigation in the app shell

- [ ] 2.0 Implement shared frontend infrastructure
  - [ ] 2.1 Wire generated API client into `src/lib/api-client`
  - [ ] 2.2 Add query/mutation layer with consistent error handling
  - [ ] 2.3 Build reusable status badges for draft/published/ready/active/failed
  - [ ] 2.4 Build shared table/filter/pagination components
  - [ ] 2.5 Create common empty/loading/error state components

- [ ] 3.0 Deliver template and version lifecycle management
  - [ ] 3.1 Build template list page with status filters
  - [ ] 3.2 Build template detail page with version timeline
  - [ ] 3.3 Add create/edit draft version flow
  - [ ] 3.4 Add publish and rollback actions with owner/admin guard
  - [ ] 3.5 Show model failover/tool/egress config in readable sections

- [ ] 4.0 Deliver group binding and provisioning workflows
  - [ ] 4.1 Build bindings list page with group + active state overview
  - [ ] 4.2 Build bind wizard (group selection by `provider_group_id`, template version selection, review)
  - [ ] 4.3 Implement lifecycle progress states (provision, health check, disclosure, active)
  - [ ] 4.4 Build binding detail timeline with failure reason visibility
  - [ ] 4.5 Implement unbind confirmation flow with data-retention warning

- [ ] 5.0 Deliver prompt and USER.md governance UI
  - [ ] 5.1 Build prompt editor for template system prompt drafts
  - [ ] 5.2 Build USER.md editor for instance-level drafts
  - [ ] 5.3 Add version history/timeline view for prompt assets
  - [ ] 5.4 Add publish/rollback controls gated to owner/admin
  - [ ] 5.5 Add draft-save validation and conflict messaging

- [ ] 6.0 Deliver knowledge management (common + group)
  - [ ] 6.1 Build common knowledge list/detail/edit flow
  - [ ] 6.2 Build group knowledge list/detail/edit flow
  - [ ] 6.3 Implement draft/publish/rollback actions by role
  - [ ] 6.4 Surface indexing states (`queued/processing/ready/failed`) in UI
  - [ ] 6.5 Show retrieval precedence hint (`group > common`) in relevant views

- [ ] 7.0 Deliver messages/media explorer and observability views
  - [ ] 7.1 Build message explorer with filters (date/sender/media/deleted/edited)
  - [ ] 7.2 Build group detail view showing event-sourced message versions
  - [ ] 7.3 Add media metadata and transcript panes
  - [ ] 7.4 Build audit events feed with actor/action/entity/time filters
  - [ ] 7.5 Build trace detail page showing correlation path and outbound intent

- [ ] 8.0 Deliver admin operations and hardening
  - [ ] 8.1 Build user management (create, activate/deactivate, role changes)
  - [ ] 8.2 Build group assignment management UI
  - [ ] 8.3 Add hard-delete action panel with strict admin-only confirmation flow
  - [ ] 8.4 Implement centralized permission matrix checks across all routes/actions
  - [ ] 8.5 Add telemetry-safe error presentation (metadata-only) in operations views

- [ ] 9.0 Add test coverage and MVP smoke validation
  - [ ] 9.1 Add unit tests for permission matrix and guard helpers
  - [ ] 9.2 Add integration tests for templates, bindings, prompt/knowledge workflows
  - [ ] 9.3 Add integration tests for messages/media/audit rendering
  - [ ] 9.4 Add e2e smoke: login → template version → bind group → verify message visibility → publish change → trace/audit visibility
  - [ ] 9.5 Document dashboard MVP release checklist and test commands
