from __future__ import annotations

from dataclasses import dataclass
import pathlib
import sys
from typing import Any

sys.path.append(str(pathlib.Path(__file__).resolve().parents[1] / "src"))

from neonize_bridge import NeonizeEventBridge  # noqa: E402


class ConnectedEv: ...


class MessageEv: ...


class QREv: ...


class DisconnectedEv: ...


class ConnectFailureEv: ...


class LoggedOutEv: ...


class KeepAliveTimeoutEv: ...


class KeepAliveRestoredEv: ...


@dataclass
class FakeResponse:
    status_code: int


class FakeBackendClient:
    def __init__(self) -> None:
        self.calls: list[Any] = []
        self.sent_payloads: list[dict[str, Any]] = []
        self.next_payload: dict[str, Any] | None = None

    def build_inbound_payload(self, event: Any) -> dict[str, Any]:
        self.calls.append(event)
        if self.next_payload is not None:
            return self.next_payload
        return {
            "trace_id": "trace-1",
            "provider_group_id": "1203@g.us",
            "provider_message_id": "msg-1",
            "message": {"text": "hello", "media": []},
            "raw_event": {"Message": {"conversation": "hello"}},
        }

    def send_inbound_payload(self, payload: dict[str, Any]) -> FakeResponse:
        self.sent_payloads.append(payload)
        return FakeResponse(status_code=202)


class FakeClient:
    def __init__(self) -> None:
        self.handlers: dict[type[Any], Any] = {}

    def download_any(self, message: Any):
        return None

    def event(self, event_type: type[Any]):
        def _decorator(func):
            self.handlers[event_type] = func
            return func

        return _decorator


def test_neonize_event_bridge_registers_and_forwards() -> None:
    backend = FakeBackendClient()
    bridge = NeonizeEventBridge(backend_client=backend)
    client = FakeClient()

    bridge.register(
        client=client,
        connected_event_type=ConnectedEv,
        qr_event_type=QREv,
        message_event_type=MessageEv,
        disconnected_event_type=DisconnectedEv,
        connect_failure_event_type=ConnectFailureEv,
        logged_out_event_type=LoggedOutEv,
        keepalive_timeout_event_type=KeepAliveTimeoutEv,
        keepalive_restored_event_type=KeepAliveRestoredEv,
    )

    assert ConnectedEv in client.handlers
    assert QREv in client.handlers
    assert MessageEv in client.handlers
    assert DisconnectedEv in client.handlers
    assert ConnectFailureEv in client.handlers
    assert LoggedOutEv in client.handlers
    assert KeepAliveTimeoutEv in client.handlers
    assert KeepAliveRestoredEv in client.handlers

    client.handlers[ConnectedEv](client, object())
    msg_event = {"some": "event"}
    client.handlers[MessageEv](client, msg_event)

    assert backend.calls == [msg_event]
    assert len(backend.sent_payloads) == 1


def test_neonize_event_bridge_skips_sender_key_distribution_shells() -> None:
    backend = FakeBackendClient()
    backend.next_payload = {
        "trace_id": "trace-1",
        "provider_group_id": "1203@g.us",
        "provider_message_id": "msg-shell",
        "message": {"text": None, "media": []},
        "raw_event": {
            "Message": {
                "senderKeyDistributionMessage": {
                    "groupID": "1203@g.us",
                    "axolotlSenderKeyDistributionMessage": "abc",
                },
            },
        },
    }
    bridge = NeonizeEventBridge(backend_client=backend)
    client = FakeClient()

    bridge.on_message(client=client, neonize_event={"some": "event"})

    assert backend.calls == [{"some": "event"}]
    assert backend.sent_payloads == []
