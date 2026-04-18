from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Mapping
from uuid import UUID

import httpx


VALID_DELIVERY_STATUSES = {"sent", "failed", "retrying"}


def _json_safe(value: Any) -> Any:
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Mapping):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [_json_safe(item) for item in value]
    return value


class BackendOutboundDispatcher:
    def __init__(
        self,
        *,
        backend_base_url: str,
        provider_base_url: str,
        service_token: str | None = None,
        provider_token: str | None = None,
        timeout_seconds: float = 10.0,
    ) -> None:
        self.backend_base_url = backend_base_url.rstrip("/")
        self.provider_base_url = provider_base_url.rstrip("/")
        self.service_token = service_token
        self.provider_token = provider_token
        self.timeout_seconds = timeout_seconds

    def _backend_headers(self) -> dict[str, str]:
        headers = {"content-type": "application/json"}
        if self.service_token:
            headers["authorization"] = f"Bearer {self.service_token}"
        return headers

    def _provider_headers(self) -> dict[str, str]:
        headers = {"content-type": "application/json"}
        if self.provider_token:
            headers["authorization"] = f"Bearer {self.provider_token}"
        return headers

    def build_status_payload(
        self,
        payload: Mapping[str, Any],
        *,
        status: str,
        provider_message_id: str | None = None,
        error_code: str | None = None,
        error_message: str | None = None,
        occurred_at: datetime | None = None,
    ) -> dict[str, Any]:
        trace_id = payload.get("trace_id")
        outbound_intent_id = payload.get("outbound_intent_id")
        if trace_id is None or outbound_intent_id is None:
            raise ValueError("payload must include trace_id and outbound_intent_id")
        if status not in VALID_DELIVERY_STATUSES:
            raise ValueError(f"unsupported outbound delivery status: {status}")

        return {
            "trace_id": str(trace_id),
            "outbound_intent_id": str(outbound_intent_id),
            "status": status,
            "provider_message_id": provider_message_id,
            "error_code": error_code,
            "error_message": error_message,
            "occurred_at": (occurred_at or datetime.now(UTC)).isoformat(),
        }

    def send_outbound_intent(self, payload: dict[str, Any]) -> httpx.Response:
        return httpx.post(
            f"{self.provider_base_url}/messages",
            json=_json_safe(payload),
            headers=self._provider_headers(),
            timeout=self.timeout_seconds,
        )

    def send_status_payload(self, payload: dict[str, Any]) -> httpx.Response:
        return httpx.post(
            f"{self.backend_base_url}/gateway/outbound/status",
            json=_json_safe(payload),
            headers=self._backend_headers(),
            timeout=self.timeout_seconds,
        )
