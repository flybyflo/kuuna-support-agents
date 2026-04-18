# Task C — trace_id Propagation & Structured Logging

## Status
**Completed**

---

## What Changed

### `backend/src/kuuna_backend/jobs/queue.py`
- Added `trace_id: str | None = None` to `enqueue_inbound_execution`, `enqueue_media_processing`, and `enqueue_knowledge_indexing`.
- `trace_id` is forwarded as a positional argument to the enqueued job functions so it survives the RQ serialisation boundary.

### `backend/src/kuuna_backend/domain/messages/ingest.py`
- Extracts `trace_id = str(event.trace_id)` once at the top of `persist_inbound_event`.
- Adds `"trace_id": trace_id` to all `extra={}` log calls (`inbound_event_deduped`, `inbound_event_persisted`, `media_processing_enqueue_failed`, `inbound_execution_enqueue_failed`).
- Passes `trace_id` to both `enqueue_media_processing(…, trace_id)` and `enqueue_inbound_execution(…, trace_id=trace_id)`.

### `backend/src/kuuna_backend/jobs/ingest.py`
- Added `trace_id: str | None = None` param to `process_inbound_message_job`.
- All seven log calls include `"trace_id": trace_id`.
- When building the outbound_intent payload uses `trace_id or str(uuid4())` instead of always generating a fresh UUID, so the original trace propagates into the outbound leg.

### `backend/src/kuuna_backend/jobs/outbound_dispatch.py`
- After fetching `outbound_intent` from the DB, extracts `trace_id` from `outbound_intent.payload.get("trace_id")`.
- All seven log calls (`outbound_intent_already_sent`, `outbound_intent_not_found_after_mark_sending`, `outbound_intent_dispatched`, `outbound_dispatch_retrying`, `outbound_dispatch_rejected`, `outbound_dispatch_transport_retrying`, `outbound_dispatch_transport_failed`, `outbound_dispatch_failed`) now include `"trace_id": trace_id`.
- No schema changes needed — trace_id was already stored in the payload column.

### `backend/src/kuuna_backend/jobs/indexing.py`
- Added `trace_id: str | None = None` to `process_knowledge_version_job`.
- All log calls include `"trace_id": trace_id`.

### `backend/src/kuuna_backend/jobs/media_processing.py`
- Added `trace_id: str | None = None` to `process_media_asset_job`.
- Key log calls (`media_processing_disabled`, `media_asset_not_found`, `media_asset_already_processed`, `media_asset_ready_thumbnail_only`, `media_asset_failed_missing_download_url`, `media_asset_processed`, `media_asset_processing_failed`) now include `"trace_id": trace_id`.

### `services/gateway/src/app.py`
- Replaced `logging.basicConfig(format=…)` with a `_StructuredFormatter` (custom `logging.Formatter` subclass) that emits one JSON object per line.
- Output schema: `{ timestamp, level, logger, message, …extra_fields }`.
- Any `extra={}` kwargs passed in log calls (e.g. `trace_id`, `provider_group_id`, `status_code`) appear as top-level JSON keys, compatible with any JSON-log aggregator.
- Import of `neonize_bridge` moved inside `main()` so loggers created at module import time already inherit the configured handler.

---

## Propagation Chain

```
Gateway mapping (trace_id generated)
  → GatewayInboundEvent.trace_id
  → persist_inbound_event (all logs carry trace_id)
  → enqueue_inbound_execution(trace_id=…) → process_inbound_message_job(trace_id) [all logs]
  → outbound_intent.payload["trace_id"] = trace_id
  → dispatch_outbound_intent_job → extracts trace_id from payload [all logs]
  
  → enqueue_media_processing(trace_id=…) → process_media_asset_job(trace_id) [key logs]
  
Indexing (triggered separately):
  → enqueue_knowledge_indexing(trace_id=…) → process_knowledge_version_job(trace_id) [all logs]
```

---

## Test Results

| Suite | Result |
|---|---|
| `backend/tests/contract/test_gateway_contract.py` | ✅ 5/5 passed |
| `backend/tests/unit/` (all) | ✅ 70/70 passed |
| `services/gateway/tests/` | ✅ 7/7 passed |
| `ruff` (backend scope) | ✅ all checks passed |
| `ruff` (gateway scope) | ✅ all checks passed |

**Pre-existing failure** (unrelated to this task):
- `tests/contract/test_auth_guards_contract.py::test_change_password_weak_new_password_returns_400` — fails before and after this change due to a missing `users` table fixture issue in that test file.

---

## Design Decisions

1. **Positional arg over RQ job meta** — passing `trace_id` as a plain function argument (rather than RQ's `job.meta`) keeps the pattern identical to existing args and avoids RQ internals. Job functions remain plain callables with no RQ coupling.

2. **`trace_id or str(uuid4())` in ingest job** — if (for any reason) a job is enqueued without a trace_id (e.g. replayed manually), a fresh UUID is used rather than propagating `None` into the stored payload.

3. **outbound_dispatch reads from payload** — the trace_id is already persisted in `OutboundIntent.payload` by the ingest job; reading it back avoids adding a new DB column and keeps the outbound leg fully self-contained.

4. **Structured JSON logging in gateway** — no new dependencies required; the custom formatter is ~50 lines and already handled by the stdlib `logging.Formatter` contract. Extra fields from all `logger.info(…, extra={…})` calls in `neonize_bridge.py` appear automatically.
