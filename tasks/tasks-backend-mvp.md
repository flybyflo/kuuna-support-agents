## Relevant Files

- `plan/mvp/PRD.md`
- `plan/mvp/DATABASE_PLAN.md`
- `plan/mvp/WHATSAPP_GATEWAY_INTEGRATION_PLAN.md`
- `plan/mvp/PROJECT_STRUCTURE_PLAN.md`
- `backend/src/kuuna_backend/api/routers/*.py`
- `backend/src/kuuna_backend/domain/**`
- `backend/src/kuuna_backend/jobs/**`
- `backend/src/kuuna_backend/db/models.py`
- `backend/alembic/versions/*.py`
- `services/gateway/src/*.py`
- `services/runtime-agent-ts/src/*.ts`
- `packages/contracts/src/gateway.ts`
- `packages/agent-contracts/src/index.ts`

## Bereits erledigt (Kontext)

- [x] Alembic-/Schema-Basis ist vorhanden (inkl. `0001..0009`).
- [x] Basales Gateway-Ingest (`/gateway/inbound`) + Persistenz (`messages`, `message_versions`, `raw_event`) ist vorhanden.
- [x] Grundstruktur für Backend/Gateway/Runtime/Jobs/Contracts steht.

## Tasks

- [ ] 1.0 Templates API und Domain vollständig umsetzen
  - [x] 1.1 Endpunkte für `group_templates` + `template_versions` (list/detail/create/update)
  - [x] 1.2 Draft/Ready/Publish/Archive Zustandsübergänge fachlich absichern
  - [x] 1.3 Publish/Rollback inkl. Versionshistorie implementieren
  - [ ] 1.4 Audit-Events für Template-Änderungen ergänzen

- [ ] 2.0 Agent-Konfiguration (System Prompt + USER.md) produktiv machen
  - [ ] 2.1 Persistenz + Versionierung für instanzspezifisches `USER.md`
  - [ ] 2.2 Draft/Publish/Rollback-Flows mit Rollenprüfung
  - [ ] 2.3 Runtime-Kontext aus aktiver Template-Version + veröffentlichtem USER.md zusammensetzen
  - [ ] 2.4 Read-Model für Dashboard (aktive Version vs. Draft)

- [ ] 3.0 Binding-/Provisioning-Lifecycle fertigstellen
  - [x] 3.1 Bind/Unbind-Endpunkte für `provider_group_id`
  - [x] 3.2 Atomaren Aktivierungsflow umsetzen (create -> provision -> health -> disclosure -> active)
  - [x] 3.3 Fehlerpfade + Rollback + Statusmodell (`draft|provisioning|active|inactive|failed`)
  - [x] 3.4 1:1 aktive Bindung pro Gruppe serverseitig erzwingen

- [x] 4.0 TypeScript-Pi Runtime-Agent ausführbar machen
  - [x] 4.1 `runner.ts` + `@kuuna/agent-contracts` von Scaffold auf Pi-Ausführung heben
  - [x] 4.2 `prompt.ts` für System Prompt + Retrieval-Kontext implementieren
  - [x] 4.3 `tools.ts` mit Kuuna-only Tools und deaktivierten Pi-Builtin-Tools umsetzen
  - [x] 4.4 Model-Failover gemäß PRD/OpenAI-only, max. 2 Hops

- [x] 5.0 Gateway-Mapping und Ingest-Followups vervollständigen
  - [x] 5.1 Mapping für `message_edited` und `message_deleted` ergänzen
  - [x] 5.2 Trigger-Entscheidung im Backend umsetzen (mention/reply/prefix)
  - [x] 5.3 Unbound Groups: persistieren ja, ausführen nein
  - [x] 5.4 Folgejobs nach Persistenz deterministisch enqueuen

- [x] 6.0 Media/Transkript/Knowledge/Retrieval-Pipeline schließen
  - [x] 6.1 Media-Download + S3-Ablage + Statusführung (`pending|ready|failed`)
  - [x] 6.2 Parsing/Transkription für Bild/Audio/Video + `pdf/md/txt`
  - [x] 6.3 Knowledge Draft/Publish/Rollback für common + group
  - [x] 6.4 Retrieval mit Priorität `group > common` + nur `ready`-Versionen

- [x] 7.0 Outbound-Intent Pipeline implementieren
  - [x] 7.1 `outbound_intents` Domain/Service + `jobs/outbound_dispatch.py`
  - [x] 7.2 `services/gateway/src/outbound_handler.py` mit `outbound_intent_id`-Idempotenz
  - [x] 7.3 Statusrückmeldung (`sent|failed|retrying`) persistent verarbeiten
  - [x] 7.4 Retry/Backoff + Attempt-Counter + Duplikatschutz

- [x] 8.0 Auth/RBAC/RLS Hardening
  - [x] 8.1 Auth-/Users-/Assignments-Router vollständig implementieren
  - [x] 8.2 Session-Claims (`app.role`, `app.group_scope`) in DB-Session setzen, RLS effektiv machen
  - [x] 8.3 Passwortpolicy + Rate-Limit + Lockout gemäß PRD serverseitig durchsetzen
  - [x] 8.4 Hard-Delete (admin-only) inkl. vollständigem Audittrail

- [x] 9.0 Observability und Traceability vervollständigen
  - [x] 9.1 Einheitliche JSON-Logs und durchgängige `trace_id` über Gateway/Backend/Jobs/Runtime
    - [x] `trace_id`-Propagation über ingest -> queue-jobs -> outbound dispatch ergänzt
    - [x] Gateway-Logs auf JSON-Format umgestellt
    - [x] Backend/Runtime JSON-Log-Standardisierung ergänzt
  - [x] 9.2 Sentry mit Content-Scrubbing (keine Rohinhalte)
  - [x] 9.3 Audit-/Trace-Endpunkte für ingest -> retrieval -> model_path -> outbound
    - [x] `/audit/trace/message/{provider_group_id}/{provider_message_id}` ergänzt (ingest/media/outbound)
    - [x] Model-Path/Retrieval-Refs im Trace-Read-Model ergänzt

- [x] 10.0 Test- und Smoke-Gates ergänzen
  - [x] 10.1 Unit-/Integrationstests für Templates/Bindings/Knowledge/Trigger/Outbound
    - [x] Unit-Tests für Trigger-Entscheidung (mention/reply/prefix/no-match + Präzedenz) ergänzt
    - [x] Unit-Tests für Outbound-Service (create/sending/sent/failed/retrying/unknown-id) ergänzt
    - [x] Unit-Tests für Passwort-Policy + Hash/Verify ergänzt
    - [x] Unit-Tests für Templates/Bindings/Knowledge-Domain ergänzt
  - [x] 10.2 Contract-Tests für Gateway Inbound+Outbound inkl. Auth/Retry/Dedupe
    - [x] Persistenz-Test für `/gateway/outbound/status` ergänzt
    - [x] Mapping-Tests für created/edited/deleted Klassifikation ergänzt
    - [x] Trigger-Varianten (mention/reply/prefix/kein Trigger) als Contract-Tests ergänzt
    - [x] Outbound-Status-Varianten (failed/retrying/unknown intent-id) als Contract-Tests ergänzt
    - [x] Auth-Guard-Tests (401/403 ohne Token / falsche Credentials / inaktiver User) ergänzt
    - [x] `/audit/events` Contract-Tests (leer/befüllt/limit-Validierung) ergänzt
    - [x] Gateway `BackendOutboundDispatcher.build_status_payload` Unit-Tests ergänzt
  - [x] 10.3 E2E-Smoke: `login -> bind -> ingest -> route -> reply -> audit/trace`
  - [x] 10.4 Docker-Smoke für Migrationen + Restore/DR-Basics
    - [x] `infra/compose/smoke/docker-smoke.sh` ergänzt (service+migration smoke)
    - [x] `infra/compose/smoke/dr-backup-restore.sh` ergänzt (non-destructive pg dump/restore check)
    - [x] `infra/compose/DR_RUNBOOK.md` ergänzt
