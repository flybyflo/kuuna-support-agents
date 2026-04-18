from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta
from typing import Any, TypedDict
from uuid import UUID

from kuuna_backend.config.settings import get_settings


class AccessTokenPayload(TypedDict):
    sub: str
    role: str
    group_scope: list[str]
    iat: int
    exp: int


class AccessTokenError(ValueError):
    """Raised when an access token is invalid or expired."""


def issue_access_token(*, user_id: UUID, role: str, group_scope: list[str]) -> str:
    settings = get_settings()
    now = datetime.now(UTC)
    expires_at = now + timedelta(seconds=max(60, settings.auth_token_ttl_seconds))

    payload: AccessTokenPayload = {
        "sub": str(user_id),
        "role": role,
        "group_scope": sorted(set(group_scope)),
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }

    payload_json = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_b64 = _b64url_encode(payload_json)
    signature = _sign(payload_b64)
    signature_b64 = _b64url_encode(signature)
    return f"{payload_b64}.{signature_b64}"


def decode_access_token(token: str) -> AccessTokenPayload:
    parts = token.strip().split(".")
    if len(parts) != 2:
        raise AccessTokenError("invalid token format")

    payload_b64, signature_b64 = parts
    expected_signature = _sign(payload_b64)
    actual_signature = _b64url_decode(signature_b64)
    if not hmac.compare_digest(expected_signature, actual_signature):
        raise AccessTokenError("invalid token signature")

    try:
        payload_raw = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise AccessTokenError("invalid token payload") from exc

    payload = _validate_payload(payload_raw)

    now_ts = int(datetime.now(UTC).timestamp())
    if payload["exp"] <= now_ts:
        raise AccessTokenError("token expired")

    return payload


def _validate_payload(value: Any) -> AccessTokenPayload:
    if not isinstance(value, dict):
        raise AccessTokenError("invalid payload type")

    sub = value.get("sub")
    role = value.get("role")
    group_scope = value.get("group_scope")
    iat = value.get("iat")
    exp = value.get("exp")

    if not isinstance(sub, str) or not sub:
        raise AccessTokenError("invalid token subject")
    if not isinstance(role, str) or not role:
        raise AccessTokenError("invalid token role")
    if not isinstance(group_scope, list) or any(not isinstance(item, str) for item in group_scope):
        raise AccessTokenError("invalid token group scope")
    if not isinstance(iat, int) or not isinstance(exp, int):
        raise AccessTokenError("invalid token timestamps")

    return {
        "sub": sub,
        "role": role,
        "group_scope": [item for item in group_scope if item],
        "iat": iat,
        "exp": exp,
    }


def _sign(payload_b64: str) -> bytes:
    secret = get_settings().auth_token_secret.encode("utf-8")
    return hmac.new(secret, payload_b64.encode("utf-8"), hashlib.sha256).digest()


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * ((4 - len(value) % 4) % 4)
    try:
        return base64.urlsafe_b64decode(value + padding)
    except Exception as exc:  # pragma: no cover - defensive decoding
        raise AccessTokenError("invalid base64 token segment") from exc
