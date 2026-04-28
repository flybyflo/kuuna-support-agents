from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

import kuuna_backend.domain.messages.ingest as message_ingest
from kuuna_backend.api.schemas.gateway import GatewayInboundEvent
from kuuna_backend.db.models import MessageLink, RetrievalChunk


def _event(
    *,
    message_id: str,
    text: str | None,
    event_type: str = "message_created",
) -> GatewayInboundEvent:
    return GatewayInboundEvent(
        trace_id=uuid4(),
        provider="whatsapp-neonize",
        provider_group_id="group-links@g.us",
        provider_message_id=message_id,
        sender_provider_user_id="user-1",
        event_type=event_type,  # type: ignore[arg-type]
        occurred_at=datetime.now(timezone.utc),
        message={
            "text": text,
            "reply_to_provider_message_id": None,
            "mentions": [],
            "media": [],
        },
        raw_event={},
    )


def test_persist_inbound_event_prunes_links_removed_from_latest_message(
    test_session_factory: sessionmaker[Session],
    monkeypatch,
) -> None:
    monkeypatch.setattr(message_ingest, "enqueue_retrieval_indexing", lambda *args, **kwargs: "job")
    monkeypatch.setattr(message_ingest, "enqueue_passive_message_analysis", lambda *args, **kwargs: "job")
    monkeypatch.setattr(message_ingest, "enqueue_inbound_execution", lambda *args, **kwargs: "job")
    monkeypatch.setattr(message_ingest, "enqueue_media_processing", lambda *args, **kwargs: "job")

    with test_session_factory() as db:
        message_ingest.persist_inbound_event(
            db,
            _event(message_id="msg-links-1", text="Please see https://example.com/evidence"),
        )
        link = db.scalar(select(MessageLink).where(MessageLink.provider_group_id == "group-links@g.us"))
        assert link is not None
        stale_link_id = link.id
        db.add(
            RetrievalChunk(
                scope="conversation",
                provider_group_id="group-links@g.us",
                source_type="message_link",
                source_id=stale_link_id,
                chunk_no=1,
                content="https://example.com/evidence",
                token_count=1,
                embedding=None,
                metadata_json={},
            )
        )
        db.commit()

        message_ingest.persist_inbound_event(
            db,
            _event(message_id="msg-links-1", text="Removed the link.", event_type="message_edited"),
        )

        links = db.scalars(select(MessageLink).where(MessageLink.provider_group_id == "group-links@g.us")).all()
        stale_chunks = db.scalars(
            select(RetrievalChunk).where(
                RetrievalChunk.source_type == "message_link",
                RetrievalChunk.source_id == stale_link_id,
            )
        ).all()

    assert links == []
    assert stale_chunks == []
