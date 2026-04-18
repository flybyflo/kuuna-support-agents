from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi.testclient import TestClient

from kuuna_backend.main import create_app


client = TestClient(create_app())


def test_gateway_inbound_contract_accepts_event() -> None:
    payload = {
        "trace_id": str(uuid4()),
        "provider": "whatsapp-neonize",
        "provider_group_id": "group-123",
        "provider_message_id": "msg-123",
        "sender_provider_user_id": "user-1",
        "event_type": "message_created",
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "message": {
            "text": "hello",
            "reply_to_provider_message_id": None,
            "mentions": [],
            "media": [],
        },
    }

    response = client.post("/gateway/inbound", json=payload)

    assert response.status_code == 202
    assert response.json()["accepted"] is True
    assert response.json()["trace_id"] == payload["trace_id"]


def test_gateway_outbound_status_contract_accepts_event() -> None:
    payload = {
        "trace_id": str(uuid4()),
        "outbound_intent_id": str(uuid4()),
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
