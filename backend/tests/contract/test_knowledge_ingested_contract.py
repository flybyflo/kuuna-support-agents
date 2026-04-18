from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from kuuna_backend.db.models import MediaAsset, MediaStatus, Message, MessageEventType, MessageVersion, Transcript


def test_ingested_common_docs_returns_empty_without_ingest(client: TestClient) -> None:
    response = client.get("/knowledge/ingested/common-docs")

    assert response.status_code == 200
    assert response.json() == []



def test_ingested_group_docs_aggregates_latest_message_versions(
    client: TestClient,
    test_session_factory: sessionmaker[Session],
) -> None:
    group_id = "contract-group@g.us"

    with test_session_factory() as db:
        message = Message(
            id=uuid4(),
            provider_group_id=group_id,
            provider_message_id="msg-1",
            sender_provider_user_id="user-1",
            latest_version_no=2,
        )
        db.add(message)
        db.flush()

        db.add_all(
            [
                MessageVersion(
                    message_id=message.id,
                    version_no=1,
                    event_type=MessageEventType.CREATED,
                    is_deleted=False,
                    text_content="first",
                    raw_event={"event": "created"},
                    occurred_at=datetime(2026, 4, 18, 10, 0, tzinfo=UTC),
                ),
                MessageVersion(
                    message_id=message.id,
                    version_no=2,
                    event_type=MessageEventType.EDITED,
                    is_deleted=False,
                    text_content="second",
                    raw_event={"event": "edited"},
                    occurred_at=datetime(2026, 4, 18, 11, 0, tzinfo=UTC),
                ),
            ]
        )
        db.commit()

    response = client.get(f"/knowledge/ingested/group-docs/{group_id}")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["id"] == group_id
    assert payload[0]["scope"] == "group"
    assert payload[0]["status"] == "ready"
    assert payload[0]["chunk_count"] == 1



def test_ingested_group_docs_status_processing_when_pending_media(
    client: TestClient,
    test_session_factory: sessionmaker[Session],
) -> None:
    group_id = "group-processing@g.us"

    with test_session_factory() as db:
        message = Message(
            id=uuid4(),
            provider_group_id=group_id,
            provider_message_id="msg-processing",
            sender_provider_user_id="user-2",
            latest_version_no=1,
        )
        db.add(message)
        db.flush()

        db.add(
            MessageVersion(
                message_id=message.id,
                version_no=1,
                event_type=MessageEventType.CREATED,
                is_deleted=False,
                text_content="hello",
                raw_event={"event": "created"},
                occurred_at=datetime(2026, 4, 18, 11, 30, tzinfo=UTC),
            )
        )

        db.add(
            MediaAsset(
                message_id=message.id,
                provider_media_id="media-1",
                mime_type="audio/ogg",
                file_name="voice.ogg",
                byte_size=123,
                status=MediaStatus.PENDING,
                metadata_json={},
            )
        )
        db.commit()

    response = client.get(f"/knowledge/ingested/group-docs/{group_id}")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["status"] == "processing"



def test_ingested_common_docs_includes_transcript_chunks(
    client: TestClient,
    test_session_factory: sessionmaker[Session],
) -> None:
    group_id = "group-transcript@g.us"

    with test_session_factory() as db:
        message = Message(
            id=uuid4(),
            provider_group_id=group_id,
            provider_message_id="msg-transcript",
            sender_provider_user_id="user-3",
            latest_version_no=1,
        )
        db.add(message)
        db.flush()

        db.add(
            MessageVersion(
                message_id=message.id,
                version_no=1,
                event_type=MessageEventType.CREATED,
                is_deleted=False,
                text_content="",
                raw_event={"event": "created"},
                occurred_at=datetime(2026, 4, 18, 12, 0, tzinfo=UTC),
            )
        )

        media = MediaAsset(
            id=uuid4(),
            message_id=message.id,
            provider_media_id="media-2",
            mime_type="audio/ogg",
            file_name="voice2.ogg",
            byte_size=321,
            status=MediaStatus.READY,
            metadata_json={},
        )
        db.add(media)
        db.flush()

        db.add(
            Transcript(
                media_asset_id=media.id,
                text_content="transcribed text",
                language="de",
                status=MediaStatus.READY,
            )
        )
        db.commit()

    response = client.get("/knowledge/ingested/common-docs")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["scope"] == "common"
    assert payload[0]["chunk_count"] == 1
    assert payload[0]["status"] == "ready"
