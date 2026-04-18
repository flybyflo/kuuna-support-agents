from __future__ import annotations

from collections.abc import Generator
from dataclasses import dataclass
from functools import wraps
from typing import Callable, ParamSpec, TypeVar
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from kuuna_backend.api.security import AccessTokenError, AccessTokenPayload, decode_access_token
from kuuna_backend.db.models import RoleName, User
from kuuna_backend.integrations.postgres import get_db_session


@dataclass(frozen=True, slots=True)
class CurrentAuthContext:
    user_id: UUID
    role: RoleName
    group_scope: list[str]


_P = ParamSpec("_P")
_R = TypeVar("_R")


def get_db(request: Request) -> Generator[Session, None, None]:
    db = get_db_session()
    try:
        payload = _resolve_optional_token_payload(request)
        _apply_rls_session_context(db, payload=payload)
        yield db
    finally:
        db.close()


def get_current_auth_context(request: Request) -> CurrentAuthContext:
    payload = _resolve_required_token_payload(request)
    try:
        role = RoleName(payload["role"])
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token role") from exc

    try:
        user_id = UUID(payload["sub"])
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token subject") from exc

    return CurrentAuthContext(user_id=user_id, role=role, group_scope=payload["group_scope"])


def get_current_user(
    db: Session = Depends(get_db),
    context: CurrentAuthContext = Depends(get_current_auth_context),
) -> User:
    user = db.get(User, context.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="inactive or missing user")
    return user


def require_roles(*allowed_roles: RoleName) -> Callable[[CurrentAuthContext], CurrentAuthContext]:
    allowed_set = set(allowed_roles)

    def _dependency(context: CurrentAuthContext = Depends(get_current_auth_context)) -> CurrentAuthContext:
        if context.role not in allowed_set:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="insufficient role")
        return context

    return _dependency


def with_role_guard(*allowed_roles: RoleName) -> Callable[[Callable[_P, _R]], Callable[_P, _R]]:
    """Decorator helper for internal utility functions that should enforce role constraints."""

    def _decorator(func: Callable[_P, _R]) -> Callable[_P, _R]:
        @wraps(func)
        def _wrapped(*args: _P.args, **kwargs: _P.kwargs) -> _R:
            context = kwargs.get("context")
            if not isinstance(context, CurrentAuthContext):
                raise RuntimeError("with_role_guard requires a 'context' keyword argument")
            if context.role not in set(allowed_roles):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="insufficient role")
            return func(*args, **kwargs)

        return _wrapped

    return _decorator


def _resolve_optional_token_payload(request: Request) -> AccessTokenPayload | None:
    token = _extract_bearer_token(request)
    if token is None:
        return None

    try:
        return decode_access_token(token)
    except AccessTokenError:
        return None


def _resolve_required_token_payload(request: Request) -> AccessTokenPayload:
    token = _extract_bearer_token(request)
    if token is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing bearer token")

    try:
        return decode_access_token(token)
    except AccessTokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc


def _extract_bearer_token(request: Request) -> str | None:
    header = request.headers.get("Authorization")
    if not header:
        return None

    prefix = "Bearer "
    if not header.startswith(prefix):
        return None

    token = header[len(prefix) :].strip()
    return token or None


def _apply_rls_session_context(db: Session, *, payload: AccessTokenPayload | None) -> None:
    bind = db.get_bind()
    if bind.dialect.name != "postgresql":
        return

    role = payload["role"] if payload else ""
    group_scope = ",".join(payload["group_scope"]) if payload else ""

    db.execute(
        text(
            "SELECT set_config('app.role', :role, true), set_config('app.group_scope', :group_scope, true)"
        ),
        {"role": role, "group_scope": group_scope},
    )
