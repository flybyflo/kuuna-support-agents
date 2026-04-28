from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from kuuna_backend.db.models import (
    MediaAsset,
    MediaStatus,
    Message,
    MessageLink,
    MessageVersion,
    RetrievalChunk,
    Transcript,
)
from kuuna_backend.integrations.postgres import get_db_session
from kuuna_backend.jobs.indexing import (
    EMBEDDING_DIMENSIONS,
    _chunk_markdown,
    _embed_chunks,
    _pseudo_embedding,
    _token_count,
)

logger = logging.getLogger(__name__)


def process_retrieval_source_job(
    source_type: str,
    source_id: str,
    trace_id: str | None = None,
) -> None:
    db = get_db_session()
    try:
        try:
            source_uuid = UUID(source_id)
        except ValueError:
            logger.error(
                "retrieval_indexing_invalid_source_id",
                extra={"trace_id": trace_id, "source_type": source_type, "source_id": source_id},
            )
            return

        normalized_type = source_type.strip().lower()
        if normalized_type == "message":
            _index_message(db, message_id=source_uuid, trace_id=trace_id)
        elif normalized_type == "message_link":
            _index_message_link(db, message_link_id=source_uuid, trace_id=trace_id)
        elif normalized_type == "media_asset":
            _index_media_asset(db, media_asset_id=source_uuid, trace_id=trace_id)
        else:
            logger.warning(
                "retrieval_indexing_unknown_source_type",
                extra={"trace_id": trace_id, "source_type": source_type, "source_id": source_id},
            )
            return

        db.commit()
    except Exception:
        db.rollback()
        logger.exception(
            "retrieval_indexing_failed",
            extra={"trace_id": trace_id, "source_type": source_type, "source_id": source_id},
        )
        raise
    finally:
        db.close()


def _index_message(db: Session, *, message_id: UUID, trace_id: str | None) -> None:
    row = db.execute(
        select(Message, MessageVersion)
        .join(
            MessageVersion,
            (MessageVersion.message_id == Message.id)
            & (MessageVersion.version_no == Message.latest_version_no),
        )
        .where(Message.id == message_id)
        .limit(1)
    ).one_or_none()

    if row is None:
        _delete_source_chunks(db, source_type="message", source_id=message_id)
        return

    message, version = row
    if version.is_deleted:
        _delete_source_chunks(db, source_type="message", source_id=message.id)
        return

    content = (version.text_content or "").strip()
    if not content:
        _delete_source_chunks(db, source_type="message", source_id=message.id)
        return

    _replace_source_chunks(
        db,
        scope="conversation",
        provider_group_id=message.provider_group_id,
        source_type="message",
        source_id=message.id,
        content=content,
        metadata={
            "trace_id": trace_id,
            "message_id": str(message.id),
            "message_version_id": str(version.id),
            "provider_message_id": message.provider_message_id,
            "sender_provider_user_id": message.sender_provider_user_id,
            "occurred_at": version.occurred_at.isoformat(),
        },
    )


def _index_message_link(db: Session, *, message_link_id: UUID, trace_id: str | None) -> None:
    row = db.execute(
        select(MessageLink, Message)
        .join(Message, Message.id == MessageLink.message_id)
        .where(MessageLink.id == message_link_id)
        .limit(1)
    ).one_or_none()
    if row is None:
        _delete_source_chunks(db, source_type="message_link", source_id=message_link_id)
        return

    link, message = row
    title = (link.title or "").strip()
    url = link.normalized_url or link.url
    content = "\n".join(part for part in (title, url) if part).strip()
    if not content:
        _delete_source_chunks(db, source_type="message_link", source_id=link.id)
        return

    _replace_source_chunks(
        db,
        scope="conversation",
        provider_group_id=link.provider_group_id,
        source_type="message_link",
        source_id=link.id,
        content=content,
        metadata={
            "trace_id": trace_id,
            "message_id": str(message.id),
            "provider_message_id": message.provider_message_id,
            "url": link.url,
            "normalized_url": link.normalized_url,
            "title": link.title,
        },
    )


def _index_media_asset(db: Session, *, media_asset_id: UUID, trace_id: str | None) -> None:
    row = db.execute(
        select(MediaAsset, Message, Transcript)
        .join(Message, Message.id == MediaAsset.message_id)
        .outerjoin(Transcript, Transcript.media_asset_id == MediaAsset.id)
        .where(MediaAsset.id == media_asset_id)
        .limit(1)
    ).one_or_none()
    if row is None:
        _delete_source_chunks(db, source_type="media_asset", source_id=media_asset_id)
        return

    asset, message, transcript = row
    content = (transcript.text_content or "").strip() if transcript is not None else ""
    if (
        asset.status != MediaStatus.READY
        or transcript is None
        or transcript.status != MediaStatus.READY
        or not content
    ):
        _delete_source_chunks(db, source_type="media_asset", source_id=asset.id)
        return

    _replace_source_chunks(
        db,
        scope="conversation",
        provider_group_id=message.provider_group_id,
        source_type="media_asset",
        source_id=asset.id,
        content=content,
        metadata={
            "trace_id": trace_id,
            "message_id": str(message.id),
            "provider_message_id": message.provider_message_id,
            "media_asset_id": str(asset.id),
            "mime_type": asset.mime_type,
            "file_name": asset.file_name,
            "transcript_id": str(transcript.id),
        },
    )


def _replace_source_chunks(
    db: Session,
    *,
    scope: str,
    provider_group_id: str | None,
    source_type: str,
    source_id: UUID,
    content: str,
    metadata: dict[str, object],
) -> None:
    chunks = _chunk_markdown(content)
    embeddings = _embed_retrieval_chunks(chunks)

    _delete_source_chunks(db, source_type=source_type, source_id=source_id)

    now = datetime.now(timezone.utc).isoformat()
    metadata_payload = {**metadata, "indexed_at": now}
    for chunk_no, (chunk_content, embedding) in enumerate(zip(chunks, embeddings, strict=True), start=1):
        normalized_content = chunk_content.strip()
        if not normalized_content:
            continue

        db.add(
            RetrievalChunk(
                scope=scope,
                provider_group_id=provider_group_id,
                source_type=source_type,
                source_id=source_id,
                chunk_no=chunk_no,
                content=normalized_content,
                token_count=_token_count(normalized_content),
                embedding=embedding,
                metadata_json=metadata_payload,
            )
        )


def _delete_source_chunks(db: Session, *, source_type: str, source_id: UUID) -> None:
    db.execute(
        delete(RetrievalChunk).where(
            RetrievalChunk.source_type == source_type,
            RetrievalChunk.source_id == source_id,
        )
    )


def _embed_retrieval_chunks(chunks: list[str]) -> list[list[float]]:
    try:
        return _embed_chunks(chunks)
    except Exception:
        logger.exception(
            "retrieval_embedding_failed_using_pseudo_embeddings",
            extra={"chunk_count": len(chunks)},
        )
        normalized_chunks = [chunk if chunk.strip() else "__empty__" for chunk in chunks]
        return [
            _pseudo_embedding(chunk, dimensions=EMBEDDING_DIMENSIONS)
            for chunk in normalized_chunks
        ]
