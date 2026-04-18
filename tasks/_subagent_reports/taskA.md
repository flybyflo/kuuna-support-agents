# Task A — Auth Hardening Report

**Status:** ✅ Completed  
**Tests:** 68 passed, 0 failed  
**Ruff:** All checks passed

---

## What Was Implemented

### 1. Deterministic Lockout Behavior

**File:** `backend/src/kuuna_backend/domain/auth/service.py`

`_register_failed_login` already incremented a counter and locked on threshold — the key improvements made:

- **Audit event on lockout** — `auth.account_locked` is now emitted (with `locked_until` + `lockout_seconds` in the payload) every time an account transitions into the locked state. This makes lockout events traceable in the audit log.
- **Counter resets to zero on lockout** (preserved existing behavior) so that after the lockout window expires the user gets a fresh `threshold` attempts.
- Lockout timing is deterministic: `locked_until = now + auth_lockout_seconds` (default 900 s = 15 min), triggered after exactly `auth_lockout_threshold` (default 5) consecutive failures.

Env knobs (unchanged defaults): `AUTH_LOCKOUT_THRESHOLD=5`, `AUTH_LOCKOUT_SECONDS=900`.

---

### 2. IP-Aware Login Rate Limiting

**Files:** `service.py` (limiter impl), `api/routers/auth.py` (wiring), `config/settings.py` (knobs)

#### Implementation — `_IpRateLimiter` (sliding window, in-process)

- Thread-safe `defaultdict[str, deque[float]]` keyed by IP string.
- On each `is_allowed(key)` call: prune timestamps older than `window_seconds`, reject if `len(bucket) >= max_attempts`, else append the current monotonic timestamp and return `True`.
- Memory stays bounded: entries are pruned lazily on every access per key.
- Module-level singleton `get_login_rate_limiter()` — created on first use (after settings are loaded) and shared across all requests.
- `record_login_attempt(ip)` is the public entry point; raises `LoginRateLimitedError` on excess.

#### IP Extraction — `_get_client_ip(request)`

Checks in order:
1. `X-Forwarded-For` header (leftmost entry = original client) — standard behind proxies/load-balancers.
2. `X-Real-IP` header — nginx/Caddy convention.
3. `request.client.host` — direct TCP peer fallback.
4. Fallback literal `"unknown"` (all such traffic shares one bucket, which is conservative).

#### HTTP Response

`POST /auth/login` → `429 Too Many Requests` with `Retry-After: <window_seconds>` header when the IP limit is exceeded.

New settings (with defaults):

| Env var | Default | Meaning |
|---|---|---|
| `AUTH_RATE_LIMIT_WINDOW_SECONDS` | `60` | Sliding window length |
| `AUTH_RATE_LIMIT_MAX_ATTEMPTS` | `20` | Max login attempts per IP per window |

> **Note:** This is a per-process in-memory store. In a multi-process/multi-instance deployment, each process has an independent counter. For strict cross-instance enforcement, replace `_IpRateLimiter` with a Redis-backed implementation (e.g. `INCR` + `EXPIRE`).

---

### 3. Strong Password Policy

**Files:** `service.py` (policy), `config/settings.py` (new knob)

Existing checks (unchanged):
- Minimum length (default 12, env `AUTH_PASSWORD_MIN_LENGTH`)
- At least one uppercase letter
- At least one lowercase letter
- At least one digit
- At least one non-alphanumeric symbol

**New check added:**
- No run of more than `auth_password_max_consecutive` (default 3) identical consecutive characters (e.g. `"aaaa"` or `"1111"` is rejected). Configurable via env `AUTH_PASSWORD_MAX_CONSECUTIVE`.

Policy is enforced in both paths:
- **User creation** — `domain/users/service.py → create_user()` calls `password_policy_violations()` (unchanged wiring, already correct).
- **Password change** — `domain/auth/service.py → change_password()` calls `password_policy_violations()` (unchanged wiring, already correct).

---

## API Compatibility

All existing endpoints unchanged:

| Endpoint | Change |
|---|---|
| `POST /auth/login` | Added `Request` param (invisible to client); new `429` response possible |
| `GET /auth/me` | No change |
| `POST /auth/change-password` | No change |

`POST /auth/login` now returns `429` (new) in addition to existing `401`, `403`, `423`. This is a safe additive change.

---

## Files Changed

| File | Summary |
|---|---|
| `backend/src/kuuna_backend/domain/auth/service.py` | Added `LoginRateLimitedError`, `_IpRateLimiter`, `get_login_rate_limiter`, `record_login_attempt`; lockout audit event in `_register_failed_login`; consecutive-char check in `password_policy_violations` |
| `backend/src/kuuna_backend/domain/auth/__init__.py` | Exported new public symbols |
| `backend/src/kuuna_backend/api/routers/auth.py` | Added `Request` param, `_get_client_ip` helper, rate-limit check + `429` handling in `login` endpoint |
| `backend/src/kuuna_backend/config/settings.py` | Added `auth_password_max_consecutive`, `auth_rate_limit_window_seconds`, `auth_rate_limit_max_attempts` |
| `backend/tests/unit/test_auth_service.py` | **New** — 25 unit tests covering policy, hashing, rate limiter, lockout determinism |

---

## Test Results

```
68 passed in 1.88s
ruff: All checks passed
```
