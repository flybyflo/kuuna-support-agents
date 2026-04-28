from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from kuuna_backend.db.models import (
    MediaAsset,
    MediaStatus,
    Message,
    MessageEventType,
    MessageLink,
    MessageVersion,
    RetrievalChunk,
    Transcript,
)
from kuuna_backend.jobs import retrieval_indexing


def _seed_message(db: Session, *, provider_group_id: str = "group-index@g.us") -> Message:
    message = Message(
        provider_group_id=provider_group_id,
        provider_message_id="msg-index-1",
        sender_provider_user_id="user-1",
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
            text_content="Please check the financing condition for this customer.",
            raw_event={},
            occurred_at=datetime.now(timezone.utc),
        )
    )
    db.commit()
    return message


def test_retrieval_indexing_indexes_latest_message_text(
    test_session_factory: sessionmaker[Session],
    monkeypatch,
) -> None:
    with test_session_factory() as db:
        message = _seed_message(db)
        message_id = str(message.id)

    monkeypatch.setattr(retrieval_indexing, "get_db_session", lambda: test_session_factory())

    retrieval_indexing.process_retrieval_source_job("message", message_id, "trace-index-1")

    with test_session_factory() as db:
        chunk = db.scalar(select(RetrievalChunk).where(RetrievalChunk.source_type == "message"))

    assert chunk is not None
    assert chunk.scope == "conversation"
    assert chunk.provider_group_id == "group-index@g.us"
    assert "financing condition" in chunk.content


def test_retrieval_indexing_indexes_links_and_ready_media_transcripts(
    test_session_factory: sessionmaker[Session],
    monkeypatch,
) -> None:
    with test_session_factory() as db:
        message = _seed_message(db)
        link = MessageLink(
            message_id=message.id,
            provider_group_id=message.provider_group_id,
            url="https://example.com/invoice",
            normalized_url="https://example.com/invoice",
            title="Invoice evidence",
            metadata_json={},
        )
        db.add(link)
        media = MediaAsset(
            message_id=message.id,
            provider_media_id="media-1",
            mime_type="audio/ogg",
            file_name="voice.ogg",
            status=MediaStatus.READY,
            metadata_json={},
        )
        db.add(media)
        db.flush()
        db.add(
            Transcript(
                media_asset_id=media.id,
                text_content="The client asks whether we can finance this invoice.",
                status=MediaStatus.READY,
            )
        )
        db.commit()
        link_id = str(link.id)
        media_id = str(media.id)

    monkeypatch.setattr(retrieval_indexing, "get_db_session", lambda: test_session_factory())

    retrieval_indexing.process_retrieval_source_job("message_link", link_id, "trace-index-2")
    retrieval_indexing.process_retrieval_source_job("media_asset", media_id, "trace-index-3")

    with test_session_factory() as db:
        chunks = db.scalars(
            select(RetrievalChunk).where(
                RetrievalChunk.source_type.in_(["message_link", "media_asset"])
            )
        ).all()

    assert {chunk.source_type for chunk in chunks} == {"message_link", "media_asset"}
    assert any("Invoice evidence" in chunk.content for chunk in chunks)
    assert any("finance this invoice" in chunk.content for chunk in chunks)
