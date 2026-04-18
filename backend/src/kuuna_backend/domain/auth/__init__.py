"""Domain module: auth."""

from kuuna_backend.domain.auth.service import (
    AuthLoginResult,
    AuthenticationFailedError,
    LoginRateLimitedError,
    PasswordPolicyError,
    UserInactiveError,
    UserLockedError,
    change_password,
    get_login_rate_limiter,
    login_user,
    record_login_attempt,
)

__all__ = [
    "AuthLoginResult",
    "AuthenticationFailedError",
    "LoginRateLimitedError",
    "PasswordPolicyError",
    "UserInactiveError",
    "UserLockedError",
    "change_password",
    "get_login_rate_limiter",
    "login_user",
    "record_login_attempt",
]
