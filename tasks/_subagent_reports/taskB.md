# Task B – §9.3 Traceability Endpoints

## Status
✅ Completed

## What was implemented

### Endpoint
```
GET /audit/trace/message/{provider_group_id}/{provider_message_id}
```

Returns a structured JSON trace spanning all three pipeline stages for a single
provider message, using **only persisted database data** (no new migrations).

### Response shape
| Field | Stage | Source |
|---|---|---|
| `ingest` | ingest | `messages` table |
| `versions[]` | ingest | `message_versions` table (ordered by `version_no`) |
| `media[]` | processing | `media_assets` table (linked via `message_id` FK) |
| `outbound[]` | outbound | `outbound_intents` table (filtered by `payload.reply_to_provider_message_id`) |

The outbound link relies on the field `reply_to_provider_message_id` that
`jobs/ingest.py` already writes into every `OutboundIntent` payload when an
active binding triggers execution.  No schema changes needed.

Returns **200 with null/empty fields** when the message is unknown — never 404.

---

## Files changed

| File | Change |
|---|---|
| `backend/src/kuuna_backend/api/routers/audit.py` | Added `GET /audit/trace/message/{…}/{…}` endpoint |
| `backend/src/kuuna_backend/api/schemas/read_models.py` | Added `TraceMediaAssetRead`, `TraceOutboundRead`, `MessageTraceRead` |
| `backend/tests/conftest.py` | Added `Transcript` table creation (FK dependency of `media_assets`) |
| `backend/tests/contract/test_trace_contract.py` | **New** — 6 contract tests |

---

## Tests

```
tests/contract/test_trace_contract.py::test_trace_returns_200_for_unknown_message     PASSED
tests/contract/test_trace_contract.py::test_trace_ingest_stage_after_gateway_event    PASSED
tests/contract/test_trace_contract.py::test_trace_media_stage_shows_attached_asset    PASSED
tests/contract/test_trace_contract.py::test_trace_outbound_stage_shows_linked_intent  PASSED
tests/contract/test_trace_contract.py::test_trace_outbound_excludes_unrelated_intents PASSED
tests/contract/test_trace_contract.py::test_trace_full_pipeline_shape                 PASSED
```

**Full suite: 57 passed, 0 failed.**

## Lint / format

- `ruff check` — ✅ all checks passed (no lint violations)
- `ruff format` applied to the two new source files (`audit.py`,
  `test_trace_contract.py`).  The remaining 24 files flagged by
  `ruff format --check` are pre-existing throughout the codebase and were
  not modified as part of this task.

## Design notes

- **No migrations** — the endpoint reads from existing columns only.  The
  outbound↔message link is extracted from `OutboundIntent.payload` in Python
  (avoids JSON-column dialect differences between PostgreSQL and the SQLite
  used in tests).
- **Graceful degradation** — if a message has not yet been ingested, all stages
  return empty/null so callers can poll incrementally.
- **Scope** — endpoint lives on the existing `/audit` router; no new router or
  app registration needed.
