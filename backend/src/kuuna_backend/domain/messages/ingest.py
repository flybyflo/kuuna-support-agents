from __future__ import annotations

import logging
import re
from urllib.parse import urlparse

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from kuuna_backend.api.schemas.gateway import GatewayInboundEvent
from kuuna_backend.db.models import (
    MediaAsset,
    MediaStatus,
    Message,
    MessageDecision,
    MessageEventType,
    MessageLink,
    MessageVersion,
    RetrievalChunk,
)
from kuuna_backend.domain.messages.trigger import TriggerDecision, evaluate_trigger
from kuuna_backend.jobs.queue import (
    enqueue_inbound_execution,
    enqueue_media_processing,
    enqueue_passive_message_analysis,
    enqueue_retrieval_indexing,
)

logger = logging.getLogger(__name__)
URL_PATTERN = re.compile(r"https?://[^\s<>()]+", re.IGNORECASE)


class InboundPersistResult:
    def __init__(
        self,
        *,
        deduped: bool,
        trigger_decision: TriggerDecision,
        execution_enqueued: bool = False,
    ) -> None:
        self.deduped = deduped
        self.trigger_decision = trigger_decision
        self.should_execute = trigger_decision.should_execute
        self.trigger_reason = trigger_decision.reason
        self.trigger_type = trigger_decision.trigger_type
        self.execution_enqueued = execution_enqueued


def persist_inbound_event(db: Session, event: GatewayInboundEvent) -> InboundPersistResult:
    trace_id = str(event.trace_id)
    message = db.execute(
        select(Message).where(
            Message.provider_group_id == event.provider_group_id,
            Message.provider_message_id == event.provider_message_id,
        )
    ).scalar_one_or_none()

    if message is None:
        message = Message(
            provider_group_id=event.provider_group_id,
            provider_message_id=event.provider_message_id,
            sender_provider_user_id=event.sender_provider_user_id,
            latest_version_no=1,
        )
        db.add(message)
        db.flush()
        version_no = 1
    else:
        if event.event_type == MessageEventType.CREATED.value:
            trigger_decision = TriggerDecision(
                should_execute=False,
                reason="deduped_message_created",
                trigger_type=None,
            )
            logger.info(
                "inbound_event_deduped",
                extra={
                    "trace_id": trace_id,
                    "provider_group_id": event.provider_group_id,
                    "provider_message_id": event.provider_message_id,
                    "event_type": event.event_type,
                    "deduped": True,
                    "trigger_reason": trigger_decision.reason,
                    "trigger_type": trigger_decision.trigger_type,
                },
            )
            return InboundPersistResult(
                deduped=True,
                trigger_decision=trigger_decision,
                execution_enqueued=False,
            )
        version_no = message.latest_version_no + 1
        message.latest_version_no = version_no

    raw_event_payload = event.raw_event or event.model_dump(mode="json")

    message_version = MessageVersion(
        message_id=message.id,
        version_no=version_no,
        event_type=MessageEventType(event.event_type),
        is_deleted=event.event_type == MessageEventType.DELETED.value,
        text_content=event.message.text,
        raw_event=raw_event_payload,
        occurred_at=event.occurred_at,
    )
    db.add(message_version)

    media_asset_ids: list[str] = []

    for media in event.message.media:
        metadata = {"provider_group_id": event.provider_group_id}
        if media.download_url:
            metadata["download_url"] = media.download_url
        if media.inline_data_base64:
            metadata["inline_data_base64"] = media.inline_data_base64

        media_asset = MediaAsset(
            message_id=message.id,
            provider_media_id=media.provider_media_id,
            mime_type=media.mime_type,
            file_name=media.file_name,
            byte_size=media.byte_size,
            status=MediaStatus.PENDING,
            metadata_json=metadata,
        )
        db.add(media_asset)
        db.flush()
        media_asset_ids.append(str(media_asset.id))

    trigger_decision = evaluate_trigger(event)
    db.add(
        MessageDecision(
            message_id=message.id,
            provider_group_id=event.provider_group_id,
            decision_type=trigger_decision.trigger_type or "ignore",
            reason=trigger_decision.reason,
            should_execute=trigger_decision.should_execute,
            payload={
                "trace_id": trace_id,
                "provider_message_id": event.provider_message_id,
                "event_type": event.event_type,
            },
        )
    )

    message_link_ids: list[str] = []
    current_urls: dict[str, str] = {}
    for url in _extract_urls(event.message.text):
        normalized_url = _normalize_url(url)
        if normalized_url in current_urls:
            continue
        current_urls[normalized_url] = url

    existing_links = db.scalars(select(MessageLink).where(MessageLink.message_id == message.id)).all()
    existing_links_by_url = {link.normalized_url: link for link in existing_links}
    stale_link_ids = [
        link.id
        for link in existing_links
        if link.normalized_url not in current_urls
    ]
    if stale_link_ids:
        db.execute(
            delete(RetrievalChunk).where(
                RetrievalChunk.source_type == "message_link",
                RetrievalChunk.source_id.in_(stale_link_ids),
            )
        )
        db.execute(delete(MessageLink).where(MessageLink.id.in_(stale_link_ids)))

    for normalized_url, url in current_urls.items():
        existing_link = existing_links_by_url.get(normalized_url)
        if existing_link is not None:
            existing_link.url = url
            existing_link.provider_group_id = event.provider_group_id
            continue
        message_link = MessageLink(
            message_id=message.id,
            provider_group_id=event.provider_group_id,
            url=url,
            normalized_url=normalized_url,
            metadata_json={"trace_id": trace_id},
        )
        db.add(message_link)
        db.flush()
        message_link_ids.append(str(message_link.id))

    db.commit()

    logger.info(
        "inbound_event_persisted",
        extra={
            "trace_id": trace_id,
            "provider_group_id": event.provider_group_id,
            "provider_message_id": event.provider_message_id,
            "event_type": event.event_type,
            "deduped": False,
            "trigger_reason": trigger_decision.reason,
            "trigger_type": trigger_decision.trigger_type,
        },
    )

    for media_asset_id in media_asset_ids:
        try:
            enqueue_media_processing(media_asset_id, trace_id)
        except Exception:
            logger.exception(
                "media_processing_enqueue_failed",
                extra={
                    "trace_id": trace_id,
                    "media_asset_id": media_asset_id,
                    "provider_message_id": event.provider_message_id,
                },
            )

    try:
        enqueue_retrieval_indexing("message", str(message.id), trace_id)
    except Exception:
        logger.exception(
            "message_retrieval_indexing_enqueue_failed",
            extra={
                "trace_id": trace_id,
                "message_id": str(message.id),
                "provider_group_id": event.provider_group_id,
            },
        )

    for message_link_id in message_link_ids:
        try:
            enqueue_retrieval_indexing("message_link", message_link_id, trace_id)
        except Exception:
            logger.exception(
                "message_link_retrieval_indexing_enqueue_failed",
                extra={
                    "trace_id": trace_id,
                    "message_link_id": message_link_id,
                    "provider_group_id": event.provider_group_id,
                },
            )

    if event.event_type != MessageEventType.DELETED.value:
        try:
            enqueue_passive_message_analysis(
                message_id=str(message.id),
                provider_group_id=event.provider_group_id,
                reason="message_received",
                trace_id=trace_id,
            )
        except Exception:
            logger.exception(
                "passive_message_analysis_enqueue_failed",
                extra={
                    "trace_id": trace_id,
                    "message_id": str(message.id),
                    "provider_group_id": event.provider_group_id,
                    "provider_message_id": event.provider_message_id,
                },
            )

    execution_enqueued = False
    if trigger_decision.should_execute and event.event_type != MessageEventType.DELETED.value:
        try:
            enqueue_inbound_execution(
                message_id=str(message.id),
                provider_group_id=event.provider_group_id,
                reason=trigger_decision.reason,
                trace_id=trace_id,
            )
            execution_enqueued = True
        except Exception:
            logger.exception(
                "inbound_execution_enqueue_failed",
                extra={
                    "trace_id": trace_id,
                    "message_id": str(message.id),
                    "provider_group_id": event.provider_group_id,
                    "provider_message_id": event.provider_message_id,
                    "trigger_reason": trigger_decision.reason,
                },
            )

    return InboundPersistResult(
        deduped=False,
        trigger_decision=trigger_decision,
        execution_enqueued=execution_enqueued,
    )


def _extract_urls(text: str | None) -> list[str]:
    if not text:
        return []

    urls: list[str] = []
    for match in URL_PATTERN.finditer(text):
        url = match.group(0).rstrip(".,;:!?)]}")
        if url and url not in urls:
            urls.append(url)
    return urls


def _normalize_url(url: str) -> str:
    parsed = urlparse(url.strip())
    scheme = parsed.scheme.lower() or "https"
    host = parsed.netloc.lower()
    path = parsed.path or ""
    query = f"?{parsed.query}" if parsed.query else ""
    return f"{scheme}://{host}{path}{query}"
