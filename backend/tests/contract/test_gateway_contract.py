from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from kuuna_backend.db.models import KnowledgeCommonDoc, MessageVersion, OutboundIntent, OutboundStatus


def _inbound_payload(*, message_id: str, event_type: str = "message_created") -> dict[str, object]:
    return {
        "trace_id": str(uuid4()),
        "provider": "whatsapp-neonize",
        "provider_group_id": "group-123",
        "provider_message_id": message_id,
        "sender_provider_user_id": "user-1",
        "event_type": event_type,
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "message": {
            "text": "hello",
            "reply_to_provider_message_id": None,
            "mentions": [],
            "media": [],
        },
        "raw_event": {
            "provider_payload": {"kind": "MessageEv", "message_id": message_id},
            "raw_flags": {"from_me": False},
        },
    }


def test_knowledge_common_docs_retrieval_contract_returns_empty_list(
    client: TestClient,
    test_session_factory: sessionmaker[Session],
) -> None:
    with test_session_factory() as db:
        KnowledgeCommonDoc.__table__.create(bind=db.get_bind(), checkfirst=True)

    response = client.get("/knowledge/common-docs")

    assert response.status_code == 200
    assert response.json() == []


def test_messages_retrieval_endpoint_returns_empty_list_for_empty_db(client: TestClient) -> None:
    response = client.get("/messages/retrieval/group-123", params={"q": "hello", "limit": 5})

    assert response.status_code == 200
    assert response.json() == []



def test_gateway_inbound_contract_accepts_event(
    client: TestClient,
    test_session_factory: sessionmaker[Session],
) -> None:
    payload = _inbound_payload(message_id="msg-123")

    response = client.post("/gateway/inbound", json=payload)

    assert response.status_code == 202
    assert response.json()["accepted"] is True
    assert response.json()["trace_id"] == payload["trace_id"]
    assert response.json()["deduped"] is False

    with test_session_factory() as db:
        stored_version = db.execute(select(MessageVersion)).scalar_one()

    assert stored_version.raw_event["provider_payload"]["kind"] == "MessageEv"
    assert stored_version.raw_event["provider_payload"]["message_id"] == payload["provider_message_id"]


def test_gateway_inbound_dedupes_created_event(client: TestClient) -> None:
    first = _inbound_payload(message_id="msg-dedupe")
    second = _inbound_payload(message_id="msg-dedupe")

    first_response = client.post("/gateway/inbound", json=first)
    second_response = client.post("/gateway/inbound", json=second)

    assert first_response.status_code == 202
    assert first_response.json()["deduped"] is False
    assert second_response.status_code == 202
    assert second_response.json()["deduped"] is True


def test_gateway_outbound_status_contract_persists_status_change(
    client: TestClient,
    test_session_factory: sessionmaker[Session],
) -> None:
    outbound_intent_id = uuid4()

    with test_session_factory() as db:
        db.add(
            OutboundIntent(
                outbound_intent_id=outbound_intent_id,
                provider_group_id="group-123",
                status=OutboundStatus.PENDING,
                attempt_count=0,
                payload={"kind": "reply", "_dispatch": {"last_status": "pending"}},
            )
        )
        db.commit()

    payload = {
        "trace_id": str(uuid4()),
        "outbound_intent_id": str(outbound_intent_id),
        "status": "sent",
        "provider_message_id": "msg-456",
        "error_code": None,
        "error_message": None,
        "occurred_at": datetime.now(timezone.utc).isoformat(),
    }

    response = client.post("/gateway/outbound/status", json=payload)

    assert response.status_code == 202
    assert response.json()["accepted"] is True
    assert response.json()["trace_id"] == payload["trace_id"]

    with test_session_factory() as db:
        stored_intent = db.execute(
            select(OutboundIntent).where(OutboundIntent.outbound_intent_id == outbound_intent_id)
        ).scalar_one()

    assert stored_intent.status == OutboundStatus.SENT
    assert stored_intent.payload["_dispatch"]["last_status"] == "sent"
    assert stored_intent.payload["_dispatch"]["provider_message_id"] == payload["provider_message_id"]
    assert stored_intent.payload["_dispatch"]["last_error_code"] is None
    assert stored_intent.payload["_dispatch"]["last_error_message"] is None
