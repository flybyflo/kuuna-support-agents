from __future__ import annotations

from dataclasses import dataclass
import pathlib
import sys
from typing import Any

sys.path.append(str(pathlib.Path(__file__).resolve().parents[1] / "src"))

from neonize_bridge import NeonizeEventBridge  # noqa: E402


class ConnectedEv: ...


class MessageEv: ...


@dataclass
class FakeResponse:
    status_code: int


class FakeBackendClient:
    def __init__(self) -> None:
        self.calls: list[Any] = []

    def send_inbound_event(self, event: Any) -> tuple[dict[str, Any], FakeResponse]:
        self.calls.append(event)
        return (
            {
                "trace_id": "trace-1",
                "provider_group_id": "1203@g.us",
                "provider_message_id": "msg-1",
            },
            FakeResponse(status_code=202),
        )


class FakeClient:
    def __init__(self) -> None:
        self.handlers: dict[type[Any], Any] = {}

    def event(self, event_type: type[Any]):
        def _decorator(func):
            self.handlers[event_type] = func
            return func

        return _decorator


def test_neonize_event_bridge_registers_and_forwards() -> None:
    backend = FakeBackendClient()
    bridge = NeonizeEventBridge(backend_client=backend)
    client = FakeClient()

    bridge.register(client=client, connected_event_type=ConnectedEv, message_event_type=MessageEv)

    assert ConnectedEv in client.handlers
    assert MessageEv in client.handlers

    client.handlers[ConnectedEv](client, object())
    msg_event = {"some": "event"}
    client.handlers[MessageEv](client, msg_event)

    assert backend.calls == [msg_event]
