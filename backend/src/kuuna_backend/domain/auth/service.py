from __future__ import annotations

import hashlib
import hmac
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta
from typing import NamedTuple
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from kuuna_backend.api.security import issue_access_token
from kuuna_backend.config.settings import get_settings
from kuuna_backend.db.models import GroupAssignment, Role, RoleName, User, UserRole
from kuuna_backend.domain.audit.service import append_audit_event


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class AuthError(RuntimeError):
    """Base auth error."""


class AuthenticationFailedError(AuthError):
    pass


class UserLockedError(AuthError):
    def __init__(self, *, locked_until: datetime) -> None:
        super().__init__("user account is locked")
        self.locked_until = locked_until


class PasswordPolicyError(AuthError):
    def __init__(self, violations: list[str]) -> None:
        super().__init__("password policy violation")
        self.violations = violations


class UserInactiveError(AuthError):
    pass


class LoginRateLimitedError(AuthError):
    """Raised when an IP address exceeds the login attempt rate limit."""


# ---------------------------------------------------------------------------
# IP-based rate limiter (in-memory sliding window)
# ---------------------------------------------------------------------------


class _IpRateLimiter:
    """Thread-safe sliding-window rate limiter backed by in-process memory.

    Each call to ``is_allowed`` records a timestamp for *key* and returns
    ``True`` when the caller is within the configured budget.  Old entries
    are pruned lazily on each access so memory stays bounded.
    """

    def __init__(self, max_attempts: int, window_seconds: int) -> None:
        self._max = max_attempts
        self._window = float(window_seconds)
        self._lock = threading.Lock()
        self._buckets: dict[str, deque[float]] = defaultdict(deque)

    def is_allowed(self, key: str) -> bool:
        """Record an attempt for *key* and return ``True`` if within limit."""
        now = time.monotonic()
        cutoff = now - self._window
        with self._lock:
            bucket = self._buckets[key]
            # Prune expired timestamps
            while bucket and bucket[0] < cutoff:
                bucket.popleft()
            if len(bucket) >= self._max:
                return False
            bucket.append(now)
            return True

    # ------------------------------------------------------------------
    # Test / admin helpers
    # ------------------------------------------------------------------

    def reset(self, key: str | None = None) -> None:
        """Clear state for *key* (or all keys when None). Used in tests."""
        with self._lock:
            if key is None:
                self._buckets.clear()
            else:
                self._buckets.pop(key, None)


# Module-level singleton — created once on first use so settings are already
# loaded (avoids import-time circular dependency on get_settings()).
_rate_limiter: _IpRateLimiter | None = None
_rate_limiter_lock = threading.Lock()


def get_login_rate_limiter() -> _IpRateLimiter:
    """Return (or create) the singleton IP rate limiter."""
    global _rate_limiter  # noqa: PLW0603
    if _rate_limiter is None:
        with _rate_limiter_lock:
            if _rate_limiter is None:
                s = get_settings()
                _rate_limiter = _IpRateLimiter(
                    max_attempts=s.auth_rate_limit_max_attempts,
                    window_seconds=s.auth_rate_limit_window_seconds,
                )
    return _rate_limiter


def record_login_attempt(ip: str) -> None:
    """Raise :exc:`LoginRateLimitedError` when *ip* exceeds the rate limit."""
    if not get_login_rate_limiter().is_allowed(ip):
        raise LoginRateLimitedError(f"too many login attempts from {ip}")


# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------


class AuthLoginResult(NamedTuple):
    access_token: str
    expires_at: datetime
    user: User
    role: RoleName
    group_scope: list[str]


# ---------------------------------------------------------------------------
# Public domain functions
# ---------------------------------------------------------------------------


def login_user(db: Session, *, email: str, password: str) -> AuthLoginResult:
    normalized_email = email.strip().lower()
    user = db.scalar(select(User).where(User.email == normalized_email))
    if user is None:
        raise AuthenticationFailedError("invalid credentials")

    if not user.is_active:
        raise UserInactiveError("user inactive")

    now = datetime.now(UTC)
    if user.locked_until is not None and user.locked_until > now:
        raise UserLockedError(locked_until=user.locked_until)

    if not verify_password(password, user.password_hash):
        _register_failed_login(db, user=user, now=now)
        raise AuthenticationFailedError("invalid credentials")

    # Successful login — clear failure counters
    user.failed_login_attempts = 0
    user.locked_until = None

    role, group_scope = _resolve_scope_for_user(db, user_id=user.id)

    access_token = issue_access_token(user_id=user.id, role=role.value, group_scope=group_scope)
    expires_at = now + timedelta(seconds=max(60, get_settings().auth_token_ttl_seconds))

    append_audit_event(
        db,
        actor_user_id=user.id,
        event_type="auth.login",
        entity_type="user",
        entity_id=str(user.id),
        payload={"email": user.email, "role": role.value},
    )

    db.commit()
    db.refresh(user)

    return AuthLoginResult(
        access_token=access_token,
        expires_at=expires_at,
        user=user,
        role=role,
        group_scope=group_scope,
    )


def change_password(
    db: Session,
    *,
    user_id: UUID,
    current_password: str,
    new_password: str,
) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise AuthenticationFailedError("user not found")

    if not verify_password(current_password, user.password_hash):
        raise AuthenticationFailedError("current password is invalid")

    violations = password_policy_violations(new_password)
    if violations:
        raise PasswordPolicyError(violations)

    user.password_hash = hash_password(new_password)
    user.must_change_password = False
    user.password_changed_at = datetime.now(UTC)
    user.failed_login_attempts = 0
    user.locked_until = None

    append_audit_event(
        db,
        actor_user_id=user.id,
        event_type="auth.password_changed",
        entity_type="user",
        entity_id=str(user.id),
        payload={},
    )

    db.commit()
    db.refresh(user)
    return user


# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    derived = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=64)
    return f"scrypt$16384$8$1${salt.hex()}${derived.hex()}"


def verify_password(password: str, encoded_hash: str) -> bool:
    try:
        algorithm, n, r, p, salt_hex, digest_hex = encoded_hash.split("$")
    except ValueError:
        return False

    if algorithm != "scrypt":
        return False

    try:
        derived = hashlib.scrypt(
            password.encode("utf-8"),
            salt=bytes.fromhex(salt_hex),
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(bytes.fromhex(digest_hex)),
        )
    except Exception:
        return False

    return hmac.compare_digest(derived, bytes.fromhex(digest_hex))


# ---------------------------------------------------------------------------
# Password policy
# ---------------------------------------------------------------------------


def password_policy_violations(password: str) -> list[str]:
    """Return a list of human-readable policy violations (empty = pass)."""
    settings = get_settings()
    violations: list[str] = []

    if len(password) < settings.auth_password_min_length:
        violations.append(f"minimum length is {settings.auth_password_min_length}")
    if password.lower() == password:
        violations.append("must include an uppercase letter")
    if password.upper() == password:
        violations.append("must include a lowercase letter")
    if not any(char.isdigit() for char in password):
        violations.append("must include a digit")
    if not any(not char.isalnum() for char in password):
        violations.append("must include a symbol")

    # Reject runs of the same character (e.g. "aaaa")
    max_consec = settings.auth_password_max_consecutive
    run = 1
    for i in range(1, len(password)):
        if password[i] == password[i - 1]:
            run += 1
            if run > max_consec:
                violations.append(
                    f"must not contain more than {max_consec} consecutive identical characters"
                )
                break
        else:
            run = 1

    return violations


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _register_failed_login(db: Session, *, user: User, now: datetime) -> None:
    """Increment the failed-login counter and lock the account when the
    threshold is reached.  Emits an audit event on lockout."""
    settings = get_settings()
    user.failed_login_attempts += 1

    if user.failed_login_attempts >= settings.auth_lockout_threshold:
        locked_until = now + timedelta(seconds=settings.auth_lockout_seconds)
        user.locked_until = locked_until
        user.failed_login_attempts = 0  # reset so counter starts fresh after lockout

        append_audit_event(
            db,
            actor_user_id=user.id,
            event_type="auth.account_locked",
            entity_type="user",
            entity_id=str(user.id),
            payload={
                "locked_until": locked_until.isoformat(),
                "lockout_seconds": settings.auth_lockout_seconds,
            },
        )

    db.commit()


def _resolve_scope_for_user(db: Session, *, user_id: UUID) -> tuple[RoleName, list[str]]:
    role_names = db.scalars(
        select(Role.name)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(UserRole.user_id == user_id)
    ).all()

    if not role_names:
        role = RoleName.VIEWER
    elif RoleName.OWNER in role_names:
        role = RoleName.OWNER
    elif RoleName.ADMIN in role_names:
        role = RoleName.ADMIN
    elif RoleName.OPERATOR in role_names:
        role = RoleName.OPERATOR
    else:
        role = RoleName.VIEWER

    group_scope = db.scalars(
        select(GroupAssignment.provider_group_id)
        .where(GroupAssignment.user_id == user_id)
        .order_by(GroupAssignment.provider_group_id.asc())
    ).all()

    return role, group_scope
