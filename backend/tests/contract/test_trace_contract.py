"""Contract tests for §9.3 traceability endpoint.

Covers GET /audit/trace/message/{provider_group_id}/{provider_message_id}
across all three pipeline stages: ingest → execution → outbound.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from kuuna_backend.db.models import MediaAsset, MediaStatus, OutboundIntent, OutboundStatus


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_GROUP_ID = "group-trace-test@g.us"
_MSG_ID = "msg-trace-001"


def _inbound_payload(*, message_id: str = _MSG_ID, group_id: str = _GROUP_ID) -> dict:
    return {
        "trace_id": str(uuid4()),
        "provider": "whatsapp-neonize",
        "provider_group_id": group_id,
        "provider_message_id": message_id,
        "sender_provider_user_id": "user-abc",
        "event_type": "message_created",
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "message": {
            "text": "trace test message",
            "reply_to_provider_message_id": None,
            "mentions": [],
            "media": [],
        },
        "raw_event": {
            "provider_payload": {"kind": "MessageEv", "message_id": message_id},
            "raw_flags": {"from_me": False},
        },
    }


# ---------------------------------------------------------------------------
# Test: unknown message returns 200 with empty trace
# ---------------------------------------------------------------------------


def test_trace_returns_200_for_unknown_message(client: TestClient) -> None:
    """Trace endpoint must return 200 even when no data exists yet."""
    response = client.get(f"/audit/trace/message/{_GROUP_ID}/msg-does-not-exist")

    assert response.status_code == 200
    body = response.json()

    assert body["provider_group_id"] == _GROUP_ID
    assert body["provider_message_id"] == "msg-does-not-exist"
    assert body["message_id"] is None
    assert body["ingest"] is None
    assert body["versions"] == []
    assert body["media"] == []
    assert body["outbound"] == []


# ---------------------------------------------------------------------------
# Test: ingest stage
# ---------------------------------------------------------------------------


def test_trace_ingest_stage_after_gateway_event(
    client: TestClient,
    test_session_factory: sessionmaker[Session],
) -> None:
    """After an inbound event is accepted, the trace reflects the ingest stage."""
    payload = _inbound_payload()
    ingest_response = client.post("/gateway/inbound", json=payload)
    assert ingest_response.status_code == 202

    response = client.get(f"/audit/trace/message/{_GROUP_ID}/{_MSG_ID}")

    assert response.status_code == 200
    body = response.json()

    # Ingest section must be populated.
    assert body["message_id"] is not None
    assert body["ingest"] is not None
    assert body["ingest"]["provider_group_id"] == _GROUP_ID
    assert body["ingest"]["provider_message_id"] == _MSG_ID

    # At least one version must exist.
    assert len(body["versions"]) == 1
    version = body["versions"][0]
    assert version["version_no"] == 1
    assert version["event_type"] == "message_created"
    assert version["is_deleted"] is False
    assert version["text_content"] == "trace test message"


# ---------------------------------------------------------------------------
# Test: media stage
# ---------------------------------------------------------------------------


def test_trace_media_stage_shows_attached_asset(
    client: TestClient,
    test_session_factory: sessionmaker[Session],
) -> None:
    """Media assets attached to a message appear in the trace media stage."""
    # Ingest the message first.
    payload = _inbound_payload(message_id="msg-trace-media")
    ingest_response = client.post("/gateway/inbound", json=payload)
    assert ingest_response.status_code == 202

    # Retrieve the message_id from the trace to attach a media asset.
    trace_before = client.get(f"/audit/trace/message/{_GROUP_ID}/msg-trace-media").json()
    message_id = trace_before["message_id"]
    assert message_id is not None
    message_uuid = UUID(message_id)

    # Directly insert a media asset (simulates async media-processing pipeline).
    with test_session_factory() as db:
        asset = MediaAsset(
            message_id=message_uuid,
            provider_media_id="media-provider-001",
            mime_type="image/jpeg",
            file_name="photo.jpg",
            byte_size=204800,
            s3_key="uploads/photo.jpg",
            status=MediaStatus.READY,
            metadata_json={},
        )
        db.add(asset)
        db.commit()
        asset_id = str(asset.id)

    response = client.get(f"/audit/trace/message/{_GROUP_ID}/msg-trace-media")

    assert response.status_code == 200
    body = response.json()

    assert len(body["media"]) == 1
    media_item = body["media"][0]
    assert media_item["id"] == asset_id
    assert media_item["mime_type"] == "image/jpeg"
    assert media_item["status"] == "ready"
    assert media_item["s3_key"] == "uploads/photo.jpg"


# ---------------------------------------------------------------------------
# Test: outbound stage
# ---------------------------------------------------------------------------


def test_trace_outbound_stage_shows_linked_intent(
    client: TestClient,
    test_session_factory: sessionmaker[Session],
) -> None:
    """OutboundIntent whose payload references the message appears in the trace."""
    msg_id = "msg-trace-outbound"

    # Ingest the trigger message.
    payload = _inbound_payload(message_id=msg_id)
    ingest_response = client.post("/gateway/inbound", json=payload)
    assert ingest_response.status_code == 202

    outbound_intent_id = uuid4()

    # Directly insert an outbound intent that references the inbound message
    # (this mirrors what jobs/ingest.py produces when a binding is active).
    with test_session_factory() as db:
        db.add(
            OutboundIntent(
                outbound_intent_id=outbound_intent_id,
                provider_group_id=_GROUP_ID,
                status=OutboundStatus.SENT,
                attempt_count=1,
                payload={
                    "provider_group_id": _GROUP_ID,
                    "reply_to_provider_message_id": msg_id,
                    "text": "Danke, wir haben deine Nachricht erhalten.",
                    "_dispatch": {
                        "last_status": "sent",
                        "provider_message_id": "msg-reply-001",
                    },
                },
            )
        )
        db.commit()

    response = client.get(f"/audit/trace/message/{_GROUP_ID}/{msg_id}")

    assert response.status_code == 200
    body = response.json()

    assert len(body["outbound"]) == 1
    ob = body["outbound"][0]
    assert ob["outbound_intent_id"] == str(outbound_intent_id)
    assert ob["provider_group_id"] == _GROUP_ID
    assert ob["status"] == "sent"
    assert ob["attempt_count"] == 1
    assert ob["payload"]["reply_to_provider_message_id"] == msg_id
    assert ob["trace_id"] is None
    assert ob["model_path"] == []
    assert ob["retrieval_refs"] == []


# ---------------------------------------------------------------------------
# Test: outbound filtering – intent for a different message is excluded
# ---------------------------------------------------------------------------


def test_trace_outbound_excludes_unrelated_intents(
    client: TestClient,
    test_session_factory: sessionmaker[Session],
) -> None:
    """Outbound intents for other messages in the same group must not leak."""
    msg_a = "msg-trace-filter-a"
    msg_b = "msg-trace-filter-b"

    client.post("/gateway/inbound", json=_inbound_payload(message_id=msg_a))
    client.post("/gateway/inbound", json=_inbound_payload(message_id=msg_b))

    with test_session_factory() as db:
        # Intent that belongs to msg_b – must NOT appear when tracing msg_a.
        db.add(
            OutboundIntent(
                outbound_intent_id=uuid4(),
                provider_group_id=_GROUP_ID,
                status=OutboundStatus.PENDING,
                attempt_count=0,
                payload={
                    "provider_group_id": _GROUP_ID,
                    "reply_to_provider_message_id": msg_b,
                    "text": "reply for b",
                    "_dispatch": {"last_status": "pending"},
                },
            )
        )
        db.commit()

    response = client.get(f"/audit/trace/message/{_GROUP_ID}/{msg_a}")

    assert response.status_code == 200
    body = response.json()
    assert body["outbound"] == [], "outbound intents for other messages must be filtered out"


# ---------------------------------------------------------------------------
# Test: full end-to-end trace shape validation
# ---------------------------------------------------------------------------


def test_trace_outbound_includes_model_path_and_retrieval_refs(
    client: TestClient,
    test_session_factory: sessionmaker[Session],
) -> None:
    msg_id = "msg-trace-model-path"

    client.post("/gateway/inbound", json=_inbound_payload(message_id=msg_id))

    with test_session_factory() as db:
        db.add(
            OutboundIntent(
                outbound_intent_id=uuid4(),
                provider_group_id=_GROUP_ID,
                status=OutboundStatus.SENT,
                attempt_count=1,
                payload={
                    "trace_id": str(uuid4()),
                    "provider_group_id": _GROUP_ID,
                    "reply_to_provider_message_id": msg_id,
                    "metadata": {
                        "agent_instance_id": str(uuid4()),
                        "model_path": ["gpt-4.1", "gpt-4.1-mini"],
                        "retrieval_refs": [
                            {"source": "group", "doc_id": "a"},
                            {"source": "common", "doc_id": "b"},
                        ],
                    },
                },
            )
        )
        db.commit()

    response = client.get(f"/audit/trace/message/{_GROUP_ID}/{msg_id}")
    assert response.status_code == 200

    outbound_item = response.json()["outbound"][0]
    assert outbound_item["model_path"] == ["gpt-4.1", "gpt-4.1-mini"]
    assert outbound_item["retrieval_refs"] == [
        {"source": "group", "doc_id": "a"},
        {"source": "common", "doc_id": "b"},
    ]


def test_trace_full_pipeline_shape(
    client: TestClient,
    test_session_factory: sessionmaker[Session],
) -> None:
    """Smoke-test the complete response shape across all three stages."""
    msg_id = "msg-trace-full"

    client.post("/gateway/inbound", json=_inbound_payload(message_id=msg_id))

    outbound_intent_id = uuid4()
    with test_session_factory() as db:
        db.add(
            OutboundIntent(
                outbound_intent_id=outbound_intent_id,
                provider_group_id=_GROUP_ID,
                status=OutboundStatus.PENDING,
                attempt_count=0,
                payload={
                    "provider_group_id": _GROUP_ID,
                    "reply_to_provider_message_id": msg_id,
                    "text": "Danke.",
                    "_dispatch": {"last_status": "pending"},
                },
            )
        )
        db.commit()

    response = client.get(f"/audit/trace/message/{_GROUP_ID}/{msg_id}")

    assert response.status_code == 200
    body = response.json()

    # Top-level keys
    required_keys = {
        "provider_group_id",
        "provider_message_id",
        "message_id",
        "ingest",
        "versions",
        "media",
        "outbound",
    }
    assert required_keys.issubset(body.keys())

    # Ingest keys
    ingest_keys = {
        "id",
        "provider_group_id",
        "provider_message_id",
        "sender_provider_user_id",
        "latest_version_no",
        "created_at",
        "updated_at",
    }
    assert ingest_keys.issubset(body["ingest"].keys())

    # Version keys
    version_keys = {
        "id",
        "message_id",
        "version_no",
        "event_type",
        "is_deleted",
        "text_content",
        "raw_event",
        "occurred_at",
        "created_at",
    }
    assert version_keys.issubset(body["versions"][0].keys())

    # Outbound keys
    outbound_keys = {
        "id",
        "outbound_intent_id",
        "provider_group_id",
        "status",
        "attempt_count",
        "payload",
        "created_at",
    }
    assert outbound_keys.issubset(body["outbound"][0].keys())
