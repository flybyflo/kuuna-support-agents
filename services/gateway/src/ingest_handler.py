from __future__ import annotations

from typing import Any

import httpx

try:
    from .mapping import map_neonize_message_event
except ImportError:  # pragma: no cover - supports direct script imports
    from mapping import map_neonize_message_event


class BackendIngestClient:
    def __init__(self, *, backend_base_url: str, service_token: str | None = None) -> None:
        self.backend_base_url = backend_base_url.rstrip("/")
        self.service_token = service_token

    def _headers(self) -> dict[str, str]:
        headers = {"content-type": "application/json"}
        if self.service_token:
            headers["authorization"] = f"Bearer {self.service_token}"
        return headers

    def build_inbound_payload(self, neonize_event: Any) -> dict[str, Any]:
        return map_neonize_message_event(neonize_event)

    def send_inbound_payload(self, payload: dict[str, Any]) -> httpx.Response:
        return httpx.post(
            f"{self.backend_base_url}/gateway/inbound",
            json=payload,
            headers=self._headers(),
            timeout=10,
        )

    def send_inbound_event(self, neonize_event: Any) -> tuple[dict[str, Any], httpx.Response]:
        payload = self.build_inbound_payload(neonize_event)
        response = self.send_inbound_payload(payload)
        return payload, response
