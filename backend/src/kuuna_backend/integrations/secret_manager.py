from __future__ import annotations

import json
import os
import re
from typing import Any


class SecretManagerError(Exception):
    """Raised when an environment-backed secret cannot be decoded."""


def load_secret_mapping(secret_ref: str | None) -> dict[str, str]:
    """Load a JSON object for a logical secret reference.

    Production can replace this small env-backed adapter with Vault, Infisical, or
    Hetzner secret storage without changing the runtime provisioner.
    """

    if not secret_ref:
        return {}

    raw_value = os.getenv(_secret_env_name(secret_ref))
    if not raw_value:
        return {}

    try:
        decoded = json.loads(raw_value)
    except json.JSONDecodeError as exc:
        raise SecretManagerError("secret mapping must be valid JSON") from exc

    if not isinstance(decoded, dict):
        raise SecretManagerError("secret mapping must be a JSON object")

    return _coerce_secret_mapping(decoded)


def _secret_env_name(secret_ref: str) -> str:
    normalized = re.sub(r"[^A-Z0-9]+", "_", secret_ref.upper()).strip("_")
    return f"KUUNA_SECRET_{normalized}"


def _coerce_secret_mapping(decoded: dict[str, Any]) -> dict[str, str]:
    secrets: dict[str, str] = {}
    for key, value in decoded.items():
        if not isinstance(key, str) or not key or "=" in key:
            raise SecretManagerError("secret mapping contains an invalid environment key")
        if value is None:
            continue
        if isinstance(value, str):
            secrets[key] = value
        elif isinstance(value, bool | int | float):
            secrets[key] = str(value)
        else:
            raise SecretManagerError("secret mapping values must be scalar")
    return secrets
