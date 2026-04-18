from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from kuuna_backend.api.deps import CurrentAuthContext, get_current_auth_context, get_current_user, get_db
from kuuna_backend.api.schemas.auth import (
    AuthChangePasswordRequest,
    AuthLoginRequest,
    AuthLoginResponse,
    AuthMeResponse,
)
from kuuna_backend.config.settings import get_settings
from kuuna_backend.db.models import User
from kuuna_backend.domain.auth import (
    AuthenticationFailedError,
    LoginRateLimitedError,
    PasswordPolicyError,
    UserInactiveError,
    UserLockedError,
    change_password,
    login_user,
    record_login_attempt,
)

router = APIRouter(prefix="/auth", tags=["auth"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_client_ip(request: Request) -> str:
    """Extract the real client IP from proxy headers, falling back to TCP peer.

    Checks (in order):
    1. ``X-Forwarded-For`` — leftmost entry is the original client.
    2. ``X-Real-IP`` — single-value header set by nginx.
    3. ``request.client.host`` — direct TCP peer address.
    """
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()

    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip.strip()

    if request.client:
        return request.client.host

    return "unknown"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("/login", response_model=AuthLoginResponse)
def login(
    request: Request,
    payload: AuthLoginRequest,
    db: Session = Depends(get_db),
) -> AuthLoginResponse:
    client_ip = _get_client_ip(request)

    try:
        record_login_attempt(client_ip)
    except LoginRateLimitedError as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="too many login attempts, please try again later",
            headers={"Retry-After": str(get_settings().auth_rate_limit_window_seconds)},
        ) from exc

    try:
        result = login_user(db, email=payload.email, password=payload.password)
    except UserLockedError as exc:
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail={"message": "account locked", "locked_until": exc.locked_until.isoformat()},
        ) from exc
    except UserInactiveError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="user inactive") from exc
    except AuthenticationFailedError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials") from exc

    return AuthLoginResponse(
        access_token=result.access_token,
        expires_at=result.expires_at,
        user_id=result.user.id,
        role=result.role.value,
        group_scope=result.group_scope,
        must_change_password=result.user.must_change_password,
    )


@router.get("/me", response_model=AuthMeResponse)
def me(
    context: CurrentAuthContext = Depends(get_current_auth_context),
    user: User = Depends(get_current_user),
) -> AuthMeResponse:
    return AuthMeResponse(
        id=user.id,
        email=user.email,
        is_active=user.is_active,
        must_change_password=user.must_change_password,
        role=context.role.value,
        group_scope=context.group_scope,
        failed_login_attempts=user.failed_login_attempts,
        locked_until=user.locked_until,
    )


@router.post("/change-password", response_model=AuthMeResponse)
def change_password_current_user(
    payload: AuthChangePasswordRequest,
    context: CurrentAuthContext = Depends(get_current_auth_context),
    db: Session = Depends(get_db),
) -> AuthMeResponse:
    try:
        user = change_password(
            db,
            user_id=context.user_id,
            current_password=payload.current_password,
            new_password=payload.new_password,
        )
    except AuthenticationFailedError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    except PasswordPolicyError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"message": "password policy violation", "violations": exc.violations},
        ) from exc

    return AuthMeResponse(
        id=user.id,
        email=user.email,
        is_active=user.is_active,
        must_change_password=user.must_change_password,
        role=context.role.value,
        group_scope=context.group_scope,
        failed_login_attempts=user.failed_login_attempts,
        locked_until=user.locked_until,
    )
