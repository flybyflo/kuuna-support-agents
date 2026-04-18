from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from kuuna_backend.api.schemas.gateway import GatewayInboundEvent
from kuuna_backend.db.models import MediaAsset, MediaStatus, Message, MessageEventType, MessageVersion
from kuuna_backend.domain.messages.trigger import TriggerDecision, evaluate_trigger
from kuuna_backend.jobs.queue import enqueue_inbound_execution, enqueue_media_processing

logger = logging.getLogger(__name__)


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

    db.commit()

    trigger_decision = evaluate_trigger(event)

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
