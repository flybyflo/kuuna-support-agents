from __future__ import annotations

import logging
from typing import Any

try:
    from .ingest_handler import BackendIngestClient
except ImportError:  # pragma: no cover - supports direct script imports
    from ingest_handler import BackendIngestClient

logger = logging.getLogger(__name__)


class NeonizeUnavailableError(RuntimeError):
    """Raised when Neonize is not installed in the gateway runtime."""


def _load_neonize_runtime() -> tuple[Any, Any, Any, Any]:
    try:
        from neonize.client import NewClient
        from neonize.events import ConnectedEv, MessageEv, event as neonize_wait
    except Exception as exc:  # pragma: no cover - depends on runtime image
        raise NeonizeUnavailableError(
            "Failed to load Neonize runtime. Ensure `neonize` is installed and system libs "
            f"(e.g. libmagic) are available. Original error: {exc}"
        ) from exc

    return NewClient, ConnectedEv, MessageEv, neonize_wait


class NeonizeEventBridge:
    def __init__(self, *, backend_client: BackendIngestClient) -> None:
        self.backend_client = backend_client

    def on_connected(self) -> None:
        logger.info("gateway_connected")

    def on_message(self, neonize_event: Any) -> None:
        try:
            payload, response = self.backend_client.send_inbound_event(neonize_event)
        except Exception:
            logger.exception("gateway_inbound_forward_failed")
            return

        logger.info(
            "gateway_inbound_forwarded",
            extra={
                "trace_id": payload.get("trace_id"),
                "provider_group_id": payload.get("provider_group_id"),
                "provider_message_id": payload.get("provider_message_id"),
                "status_code": response.status_code,
            },
        )

    def register(self, *, client: Any, connected_event_type: Any, message_event_type: Any) -> None:
        @client.event(connected_event_type)
        def _connected(_: Any, __: Any) -> None:
            self.on_connected()

        @client.event(message_event_type)
        def _message(_: Any, event: Any) -> None:
            self.on_message(event)


def run_neonize_gateway(
    *,
    session_name: str,
    backend_base_url: str,
    service_token: str | None = None,
    database_path: str | None = None,
) -> None:
    NewClient, ConnectedEv, MessageEv, neonize_wait = _load_neonize_runtime()

    client_kwargs: dict[str, Any] = {"name": session_name}
    if database_path:
        client_kwargs["database"] = database_path

    client = NewClient(**client_kwargs)
    backend_client = BackendIngestClient(
        backend_base_url=backend_base_url,
        service_token=service_token,
    )

    bridge = NeonizeEventBridge(backend_client=backend_client)
    bridge.register(client=client, connected_event_type=ConnectedEv, message_event_type=MessageEv)

    logger.info("gateway_starting", extra={"session_name": session_name})
    client.connect()
    neonize_wait.wait()
