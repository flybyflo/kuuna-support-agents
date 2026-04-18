from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from kuuna_backend.db.models import OutboundIntent, OutboundStatus


def _inbound_payload(
    *,
    message_id: str,
    text: str | None = "hello",
    mentions: list[str] | None = None,
    reply_to: str | None = None,
    event_type: str = "message_created",
) -> dict:
    return {
        "trace_id": str(uuid4()),
        "provider": "whatsapp-neonize",
        "provider_group_id": "group-trigger-test@g.us",
        "provider_message_id": message_id,
        "sender_provider_user_id": "user-trigger@s.whatsapp.net",
        "event_type": event_type,
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "message": {
            "text": text,
            "reply_to_provider_message_id": reply_to,
            "mentions": mentions or [],
            "media": [],
        },
        "raw_event": {
            "provider_payload": {"kind": "MessageEv", "message_id": message_id},
            "raw_flags": {"from_me": False},
        },
    }


def _outbound_status_payload(
    *,
    outbound_intent_id: object,
    status: str,
    error_code: str | None = None,
) -> dict:
    return {
        "trace_id": str(uuid4()),
        "outbound_intent_id": str(outbound_intent_id),
        "status": status,
        "provider_message_id": "msg-out-1" if status == "sent" else None,
        "error_code": error_code,
        "error_message": "something went wrong" if error_code else None,
        "occurred_at": datetime.now(timezone.utc).isoformat(),
    }


# --- Trigger variant acceptance tests ---

def test_gateway_inbound_with_mention_is_accepted(client: TestClient) -> None:
    payload = _inbound_payload(message_id="msg-trig-mention-1", mentions=["bot@s.whatsapp.net"])
    response = client.post("/gateway/inbound", json=payload)
    assert response.status_code == 202
    assert response.json()["accepted"] is True
    assert response.json()["deduped"] is False


def test_gateway_inbound_with_reply_is_accepted(client: TestClient) -> None:
    payload = _inbound_payload(message_id="msg-trig-reply-1", reply_to="msg-prev-1")
    response = client.post("/gateway/inbound", json=payload)
    assert response.status_code == 202
    assert response.json()["accepted"] is True


def test_gateway_inbound_with_prefix_kuuna_colon_is_accepted(client: TestClient) -> None:
    payload = _inbound_payload(message_id="msg-trig-prefix-1", text="kuuna: help me")
    response = client.post("/gateway/inbound", json=payload)
    assert response.status_code == 202
    assert response.json()["accepted"] is True


def test_gateway_inbound_with_prefix_slash_kuuna_is_accepted(client: TestClient) -> None:
    payload = _inbound_payload(message_id="msg-trig-prefix-2", text="/kuuna translate this")
    response = client.post("/gateway/inbound", json=payload)
    assert response.status_code == 202
    assert response.json()["accepted"] is True


def test_gateway_inbound_with_prefix_bang_kuuna_is_accepted(client: TestClient) -> None:
    payload = _inbound_payload(message_id="msg-trig-prefix-3", text="!kuuna summarize")
    response = client.post("/gateway/inbound", json=payload)
    assert response.status_code == 202
    assert response.json()["accepted"] is True


def test_gateway_inbound_without_trigger_is_still_accepted(client: TestClient) -> None:
    payload = _inbound_payload(message_id="msg-trig-none-1", text="just a normal message")
    response = client.post("/gateway/inbound", json=payload)
    assert response.status_code == 202
    assert response.json()["accepted"] is True


def test_gateway_inbound_edited_event_is_accepted_not_deduped(client: TestClient) -> None:
    """An edited event for an existing message_id should NOT be deduped."""
    msg_id = "msg-edit-contract-1"
    created_payload = _inbound_payload(message_id=msg_id, text="original text")
    edited_payload = _inbound_payload(
        message_id=msg_id, text="edited text", event_type="message_edited"
    )

    r1 = client.post("/gateway/inbound", json=created_payload)
    r2 = client.post("/gateway/inbound", json=edited_payload)

    assert r1.status_code == 202
    assert r1.json()["deduped"] is False
    assert r2.status_code == 202
    assert r2.json()["deduped"] is False


def test_gateway_inbound_deleted_event_is_accepted(client: TestClient) -> None:
    msg_id = "msg-delete-contract-1"
    created_payload = _inbound_payload(message_id=msg_id, text="will be deleted")
    deleted_payload = _inbound_payload(
        message_id=msg_id, text=None, event_type="message_deleted"
    )

    r1 = client.post("/gateway/inbound", json=created_payload)
    r2 = client.post("/gateway/inbound", json=deleted_payload)

    assert r1.status_code == 202
    assert r2.status_code == 202
    assert r2.json()["deduped"] is False


# --- Outbound status variant tests ---

def test_gateway_outbound_status_failed_persists_failed_status(
    client: TestClient,
    test_session_factory: sessionmaker[Session],
) -> None:
    outbound_intent_id = uuid4()
    with test_session_factory() as db:
        db.add(
            OutboundIntent(
                outbound_intent_id=outbound_intent_id,
                provider_group_id="group-123",
                status=OutboundStatus.SENDING,
                attempt_count=1,
                payload={"kind": "reply", "_dispatch": {"last_status": "sending"}},
            )
        )
        db.commit()

    payload = _outbound_status_payload(
        outbound_intent_id=outbound_intent_id,
        status="failed",
        error_code="E_TIMEOUT",
    )
    response = client.post("/gateway/outbound/status", json=payload)
    assert response.status_code == 202
    assert response.json()["accepted"] is True

    with test_session_factory() as db:
        intent = db.execute(
            select(OutboundIntent).where(OutboundIntent.outbound_intent_id == outbound_intent_id)
        ).scalar_one()
    assert intent.status == OutboundStatus.FAILED
    assert intent.payload["_dispatch"]["last_error_code"] == "E_TIMEOUT"
    assert intent.payload["_dispatch"]["last_status"] == "failed"


def test_gateway_outbound_status_retrying_keeps_sending_status(
    client: TestClient,
    test_session_factory: sessionmaker[Session],
) -> None:
    outbound_intent_id = uuid4()
    with test_session_factory() as db:
        db.add(
            OutboundIntent(
                outbound_intent_id=outbound_intent_id,
                provider_group_id="group-123",
                status=OutboundStatus.SENDING,
                attempt_count=1,
                payload={"kind": "reply", "_dispatch": {"last_status": "sending"}},
            )
        )
        db.commit()

    payload = _outbound_status_payload(
        outbound_intent_id=outbound_intent_id,
        status="retrying",
        error_code="E_RATE_LIMIT",
    )
    response = client.post("/gateway/outbound/status", json=payload)
    assert response.status_code == 202

    with test_session_factory() as db:
        intent = db.execute(
            select(OutboundIntent).where(OutboundIntent.outbound_intent_id == outbound_intent_id)
        ).scalar_one()
    # retrying maps to SENDING domain status (not a terminal state)
    assert intent.status == OutboundStatus.SENDING
    assert intent.payload["_dispatch"]["last_status"] == "retrying"


def test_gateway_outbound_status_unknown_intent_id_returns_202(client: TestClient) -> None:
    """Gateway gracefully accepts status updates for unknown intent IDs (no crash)."""
    payload = _outbound_status_payload(outbound_intent_id=uuid4(), status="sent")
    response = client.post("/gateway/outbound/status", json=payload)
    assert response.status_code == 202
    assert response.json()["accepted"] is True
