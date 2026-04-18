from __future__ import annotations

import pathlib
import sys
from types import SimpleNamespace
from typing import Any

from fastapi.testclient import TestClient

sys.path.append(str(pathlib.Path(__file__).resolve().parents[1] / "src"))

import ops_api  # noqa: E402
from ops_api import create_ops_app  # noqa: E402


class FakeJID:
    def __init__(self, **kwargs: Any) -> None:
        self.User = kwargs.get("User", "")
        self.Server = kwargs.get("Server", "")


ops_api.JID = FakeJID
ops_api.Jid2String = lambda jid: f"{jid.User}@{jid.Server}"
ops_api.build_jid = lambda phone, server="s.whatsapp.net": FakeJID(User=phone, Server=server)


class FakeClient:
    def __init__(self) -> None:
        self.created: tuple[str, list[Any]] | None = None
        self.sent: tuple[Any, str] | None = None

    def get_joined_groups(self) -> list[Any]:
        return [
            SimpleNamespace(
                JID=FakeJID(User="120363000000000", Server="g.us"),
                GroupName=SimpleNamespace(Name="Support Team"),
                Participants=[object(), object(), object()],
            )
        ]

    def create_group(self, name: str, participants: list[Any]) -> Any:
        self.created = (name, participants)
        return SimpleNamespace(
            JID=FakeJID(User="120363999999999", Server="g.us"),
            GroupName=SimpleNamespace(Name=name),
            Participants=list(participants),
        )

    def send_message(self, to: Any, message: str) -> Any:
        self.sent = (to, message)
        return SimpleNamespace(ID="provider-msg-123")


def test_list_groups_requires_token() -> None:
    app = create_ops_app(client=FakeClient(), ops_token="secret")
    response = TestClient(app).get("/ops/groups")
    assert response.status_code == 403


def test_list_groups_returns_name_and_jid() -> None:
    app = create_ops_app(client=FakeClient(), ops_token="secret")
    response = TestClient(app).get("/ops/groups", headers={"X-Internal-Token": "secret"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"][0]["jid"] == "120363000000000@g.us"
    assert payload["items"][0]["name"] == "Support Team"
    assert payload["items"][0]["participants_count"] == 3


def test_connection_status_requires_token() -> None:
    app = create_ops_app(client=FakeClient(), ops_token="secret")
    response = TestClient(app).get("/ops/connection")
    assert response.status_code == 403


def test_connection_status_returns_tracker_snapshot() -> None:
    app = create_ops_app(
        client=FakeClient(),
        ops_token="secret",
        connection_status_provider=lambda: {
            "connected": True,
            "last_event": "connected",
            "last_changed_at": "2026-04-18T14:00:00+00:00",
            "checked_at": "2026-04-18T14:00:15+00:00",
            "last_error": None,
        },
    )

    response = TestClient(app).get("/ops/connection", headers={"X-Internal-Token": "secret"})
    assert response.status_code == 200

    payload = response.json()
    assert payload["connected"] is True
    assert payload["last_event"] == "connected"
    assert payload["last_changed_at"] == "2026-04-18T14:00:00+00:00"


def test_create_group_passes_participants() -> None:
    fake_client = FakeClient()
    app = create_ops_app(client=fake_client, ops_token="secret")
    response = TestClient(app).post(
        "/ops/groups",
        headers={"X-Internal-Token": "secret"},
        json={
            "name": "Ops Escalations",
            "participants": ["+43664111222", "43664111333@s.whatsapp.net"],
        },
    )

    assert response.status_code == 200
    assert fake_client.created is not None
    created_name, created_participants = fake_client.created
    assert created_name == "Ops Escalations"
    assert len(created_participants) == 2


def test_gateway_outbound_sends_message_and_returns_provider_message_id() -> None:
    fake_client = FakeClient()
    app = create_ops_app(client=fake_client, ops_token="secret")

    response = TestClient(app).post(
        "/gateway/outbound",
        json={
            "trace_id": "trace-1",
            "outbound_intent_id": "intent-1",
            "provider_group_id": "120363000000000@g.us",
            "text": "Hello from Kuuna",
            "metadata": {},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["accepted"] is True
    assert payload["provider_message_id"] == "provider-msg-123"

    assert fake_client.sent is not None
    to_jid, text = fake_client.sent
    assert getattr(to_jid, "User", "") == "120363000000000"
    assert getattr(to_jid, "Server", "") == "g.us"
    assert text == "Hello from Kuuna"


def test_gateway_outbound_requires_service_token_when_configured() -> None:
    app = create_ops_app(client=FakeClient(), ops_token="secret", service_token="service-secret")

    response = TestClient(app).post(
        "/gateway/outbound",
        json={
            "trace_id": "trace-1",
            "outbound_intent_id": "intent-1",
            "provider_group_id": "120363000000000@g.us",
            "text": "Hello from Kuuna",
            "metadata": {},
        },
    )

    assert response.status_code == 403
