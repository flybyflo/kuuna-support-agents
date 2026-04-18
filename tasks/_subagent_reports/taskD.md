# Task D Report — 10.x Tests + Checklist Updates

**Date:** 2026-04-18  
**Scope:** `backend/tests/contract/**`, `backend/tests/unit/**`, `services/gateway/tests/**`, `tasks/tasks-backend-mvp.md`

---

## Summary

Added **78 new regression tests** (67 backend + 11 gateway) covering trigger evaluation,  
outbound service lifecycle, auth guards, audit/trace endpoint, and gateway outbound handler.  
All **111 backend** and **21 gateway** tests pass (previously 14 backend / 7 gateway).  
Note: `services/gateway/tests/test_ops_api.py` (3 tests) was present from a prior task agent.

---

## Test Results

| Suite | Before | After | Status |
|-------|--------|-------|--------|
| `backend/tests/unit` | 7 | 55 | ✅ all pass |
| `backend/tests/contract` | 7 | 56 | ✅ all pass |
| `services/gateway/tests` | 7 | 21 | ✅ all pass |
| **Total** | **21** | **132** | ✅ 0 failures |

> Prior agents added `test_auth_service.py` (24 tests), `test_trace_contract.py` (6 tests), `test_ops_api.py` (3 tests) before this task ran.

---

## New Files Created

### `backend/tests/unit/test_trigger.py` (12 tests)
Regression tests for `domain/messages/trigger.py::evaluate_trigger`:
- mention_present → `trigger_type=mention`
- reply_present → `trigger_type=reply`
- all three prefixes (`kuuna:`, `/kuuna`, `!kuuna`) → `trigger_type=prefix`
- leading whitespace before prefix is stripped (lstrip behavior)
- no match (plain text, None, empty string) → `should_execute=False`
- precedence: mention > reply > prefix (verified explicitly)
- `TRIGGER_PREFIXES` constant coverage

### `backend/tests/unit/test_auth_password.py` (11 tests)
Regression tests for `domain/auth/service.py` password primitives:
- `hash_password` + `verify_password` roundtrip
- wrong password returns False
- malformed hash returns False (does not raise)
- each call generates a unique salt (hashes differ)
- `password_policy_violations` for all five policy rules (length, uppercase, lowercase, digit, symbol)
- multiple violations returned for trivial passwords

### `backend/tests/unit/test_outbound_service.py` (16 tests)
Unit tests for `domain/outbound/service.py` using SQLite in-memory:
- `create_outbound_intent` → PENDING status, attempt_count=0, `_dispatch.last_status="pending"`
- auto-generates UUID when none provided
- `mark_outbound_intent_sending` → SENDING, increments attempt_count; twice → count=2
- `mark_outbound_intent_sent` → SENT, sets provider_message_id + clears error fields
- `mark_outbound_intent_failed` → FAILED, stores error_code and error_message
- `mark_outbound_intent_retrying` → SENDING (non-terminal), stores error metadata
- `get_outbound_intent` + all mark_* functions return None for unknown UUID (no crash)

### `backend/tests/contract/test_audit_trace_contract.py` (6 tests)
Contract tests for `GET /audit/events`:
- returns `[]` for empty DB
- returns seeded event with correct field values (event_type, entity_type, actor_user_id)
- returns multiple events
- `limit` parameter restricts to N results
- `limit > 200` → 422 (Pydantic validation)
- `limit < 1` → 422 (Pydantic validation)

### `backend/tests/contract/test_auth_guards_contract.py` (11 tests)
Contract tests for auth guard behavior:
- `GET /auth/me` without token → 401
- `GET /auth/me` with invalid token → 401
- `GET /auth/me` with empty bearer → 401
- `GET /auth/me` with valid token → 200, returns email
- `POST /auth/login` wrong password → 401
- `POST /auth/login` unknown email → 401
- `POST /auth/login` inactive user → 403
- `POST /auth/change-password` wrong current → 401
- `POST /auth/change-password` weak new password (≥8 chars but violates policy) → 400 with `violations`
- `POST /auth/change-password` success → 200, `must_change_password=False`
- `POST /auth/change-password` no token → 401

> **Note on 422 vs 400:** Pydantic enforces `min_length=8` on `PasswordField` before domain logic runs.  
> The 400 path is only reachable when the new password satisfies schema but violates domain policy (e.g. no uppercase/digit/symbol).

### `backend/tests/contract/test_gateway_trigger_outbound_contract.py` (11 tests)
Contract tests for gateway inbound trigger variants and outbound status variants:
- Inbound accepted (202) for mention / reply / all three prefixes / no trigger
- Edited event for same `provider_message_id` is **not** deduped (new version created)
- Deleted event is accepted
- Outbound status `failed` → DB status becomes `FAILED`, error_code stored
- Outbound status `retrying` → DB status stays `SENDING` (non-terminal), `_dispatch.last_status="retrying"`
- Outbound status for **unknown intent_id** → 202 (graceful, no crash)

### `services/gateway/tests/test_outbound_handler.py` (11 tests)
Unit tests for `services/gateway/src/outbound_handler.py::BackendOutboundDispatcher.build_status_payload`:
- `sent` payload: correct fields, UUIDs serialized to strings, `occurred_at` present
- `failed` payload: error_code and error_message stored, `provider_message_id=None`
- `retrying` payload: error fields stored
- Invalid status string → `ValueError("unsupported...")`
- Missing `trace_id` → `ValueError`
- Missing `outbound_intent_id` → `ValueError`
- Uses provided `occurred_at` when given; auto-generates ISO timestamp when None
- `VALID_DELIVERY_STATUSES` contains `sent/failed/retrying`, excludes `pending/sending`

---

## Task Checklist Updates (`tasks/tasks-backend-mvp.md`)

**10.1** — Added sub-bullets for what's done (trigger, outbound service, password policy unit tests);  
left the parent checkbox **unchecked** because Templates/Bindings/Knowledge domain unit tests are still missing.

**10.2** — Marked **checked** (`[x]`): all contract-test sub-requirements are now covered  
(inbound trigger variants, outbound status variants, auth guards, audit events, gateway handler, existing dedupe/persistence/mapping tests).

No other checkboxes changed (conservative — only reflects confirmed implemented+tested behavior).

---

## No Implementation Changes

Zero changes to core implementation files. The `test_change_password_weak_new_password_returns_400` test  
required one correction during development: Pydantic's `PasswordField(min_length=8)` rejects  
trivially short passwords (422) before domain logic runs; the test was updated to use an 8-char  
all-lowercase password that passes schema but fails domain policy.
