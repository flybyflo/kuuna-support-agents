"""Unit tests for auth domain: lockout, rate limiter, and password policy."""
from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest

from kuuna_backend.domain.auth.service import (
    LoginRateLimitedError,
    _IpRateLimiter,
    password_policy_violations,
    record_login_attempt,
    get_login_rate_limiter,
    _register_failed_login,
    hash_password,
    verify_password,
)


# ---------------------------------------------------------------------------
# Password policy
# ---------------------------------------------------------------------------


class TestPasswordPolicyViolations:
    def test_strong_password_has_no_violations(self) -> None:
        assert password_policy_violations("StrongPass1!") == []

    def test_too_short(self) -> None:
        violations = password_policy_violations("Sh0rt!")
        assert any("minimum length" in v for v in violations)

    def test_missing_uppercase(self) -> None:
        violations = password_policy_violations("weakpassword1!")
        assert any("uppercase" in v for v in violations)

    def test_missing_lowercase(self) -> None:
        violations = password_policy_violations("STRONGPASSWORD1!")
        assert any("lowercase" in v for v in violations)

    def test_missing_digit(self) -> None:
        violations = password_policy_violations("StrongPassword!")
        assert any("digit" in v for v in violations)

    def test_missing_symbol(self) -> None:
        violations = password_policy_violations("StrongPassword1")
        assert any("symbol" in v for v in violations)

    def test_consecutive_identical_chars_rejected(self) -> None:
        # "aaaa" in the middle — run of 4 exceeds default max of 3
        violations = password_policy_violations("Passaaaard1!")
        assert any("consecutive" in v for v in violations)

    def test_exactly_max_consecutive_allowed(self) -> None:
        # Run of exactly 3 identical chars should be OK (default max_consecutive=3)
        violations = password_policy_violations("PaaasWord1!")
        assert not any("consecutive" in v for v in violations)

    def test_multiple_violations_reported(self) -> None:
        # Too short + no symbol + no digit
        violations = password_policy_violations("Abc")
        assert len(violations) >= 2


# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------


class TestPasswordHashing:
    def test_hash_and_verify_roundtrip(self) -> None:
        pw = "SuperSecure1!"
        h = hash_password(pw)
        assert verify_password(pw, h)

    def test_wrong_password_does_not_verify(self) -> None:
        h = hash_password("SuperSecure1!")
        assert not verify_password("WrongPassword1!", h)

    def test_each_hash_is_unique(self) -> None:
        h1 = hash_password("SuperSecure1!")
        h2 = hash_password("SuperSecure1!")
        assert h1 != h2  # different salts

    def test_malformed_hash_returns_false(self) -> None:
        assert not verify_password("anything", "not-a-valid-hash")


# ---------------------------------------------------------------------------
# In-memory IP rate limiter
# ---------------------------------------------------------------------------


class TestIpRateLimiter:
    def test_allows_up_to_max_attempts(self) -> None:
        limiter = _IpRateLimiter(max_attempts=3, window_seconds=60)
        assert limiter.is_allowed("1.2.3.4") is True
        assert limiter.is_allowed("1.2.3.4") is True
        assert limiter.is_allowed("1.2.3.4") is True

    def test_blocks_on_exceeding_max(self) -> None:
        limiter = _IpRateLimiter(max_attempts=3, window_seconds=60)
        for _ in range(3):
            limiter.is_allowed("1.2.3.4")
        assert limiter.is_allowed("1.2.3.4") is False

    def test_different_ips_are_independent(self) -> None:
        limiter = _IpRateLimiter(max_attempts=1, window_seconds=60)
        assert limiter.is_allowed("10.0.0.1") is True
        assert limiter.is_allowed("10.0.0.1") is False
        # A different IP is unaffected
        assert limiter.is_allowed("10.0.0.2") is True

    def test_entries_expire_after_window(self) -> None:
        limiter = _IpRateLimiter(max_attempts=1, window_seconds=1)
        limiter.is_allowed("9.9.9.9")
        assert limiter.is_allowed("9.9.9.9") is False
        # Wait out the window
        time.sleep(1.1)
        assert limiter.is_allowed("9.9.9.9") is True

    def test_reset_clears_specific_key(self) -> None:
        limiter = _IpRateLimiter(max_attempts=1, window_seconds=60)
        limiter.is_allowed("5.5.5.5")
        assert limiter.is_allowed("5.5.5.5") is False
        limiter.reset("5.5.5.5")
        assert limiter.is_allowed("5.5.5.5") is True

    def test_reset_all_clears_everything(self) -> None:
        limiter = _IpRateLimiter(max_attempts=1, window_seconds=60)
        limiter.is_allowed("a.b.c.d")
        limiter.is_allowed("e.f.g.h")
        limiter.reset()
        assert limiter.is_allowed("a.b.c.d") is True
        assert limiter.is_allowed("e.f.g.h") is True


# ---------------------------------------------------------------------------
# record_login_attempt (uses the module singleton)
# ---------------------------------------------------------------------------


class TestRecordLoginAttempt:
    def setup_method(self) -> None:
        # Reset the singleton before each test to avoid cross-test bleed
        get_login_rate_limiter().reset()

    def test_does_not_raise_within_limit(self) -> None:
        record_login_attempt("127.0.0.1")  # should not raise

    def test_raises_when_limit_exceeded(self) -> None:
        from kuuna_backend.config.settings import get_settings

        settings = get_settings()
        # Exhaust the limit
        for _ in range(settings.auth_rate_limit_max_attempts):
            record_login_attempt("192.168.1.1")
        with pytest.raises(LoginRateLimitedError):
            record_login_attempt("192.168.1.1")


# ---------------------------------------------------------------------------
# _register_failed_login (lockout determinism)
# ---------------------------------------------------------------------------


class TestRegisterFailedLogin:
    def _make_user(self) -> MagicMock:
        user = MagicMock()
        user.id = "test-user-id"
        user.failed_login_attempts = 0
        user.locked_until = None
        return user

    def _make_db(self) -> MagicMock:
        db = MagicMock()
        db.add = MagicMock()
        db.commit = MagicMock()
        return db

    def test_increments_counter_below_threshold(self) -> None:
        user = self._make_user()
        db = self._make_db()
        now = datetime.now(UTC)

        _register_failed_login(db, user=user, now=now)

        assert user.failed_login_attempts == 1
        assert user.locked_until is None

    def test_locks_account_at_threshold(self) -> None:
        from kuuna_backend.config.settings import get_settings

        settings = get_settings()
        user = self._make_user()
        user.failed_login_attempts = settings.auth_lockout_threshold - 1
        db = self._make_db()
        now = datetime.now(UTC)

        _register_failed_login(db, user=user, now=now)

        # Counter resets on lockout
        assert user.failed_login_attempts == 0
        assert user.locked_until is not None
        expected_locked_until = now + timedelta(seconds=settings.auth_lockout_seconds)
        delta = abs((user.locked_until - expected_locked_until).total_seconds())
        assert delta < 1.0

    def test_lockout_emits_audit_event(self) -> None:
        from kuuna_backend.config.settings import get_settings

        settings = get_settings()
        user = self._make_user()
        user.failed_login_attempts = settings.auth_lockout_threshold - 1
        db = self._make_db()
        now = datetime.now(UTC)

        with patch(
            "kuuna_backend.domain.auth.service.append_audit_event"
        ) as mock_audit:
            _register_failed_login(db, user=user, now=now)

        mock_audit.assert_called_once()
        call_kwargs = mock_audit.call_args.kwargs
        assert call_kwargs["event_type"] == "auth.account_locked"

    def test_no_audit_event_below_threshold(self) -> None:
        user = self._make_user()
        db = self._make_db()
        now = datetime.now(UTC)

        with patch(
            "kuuna_backend.domain.auth.service.append_audit_event"
        ) as mock_audit:
            _register_failed_login(db, user=user, now=now)

        mock_audit.assert_not_called()
