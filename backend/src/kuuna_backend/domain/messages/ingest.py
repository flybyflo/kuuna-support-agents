from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from kuuna_backend.api.schemas.gateway import GatewayInboundEvent
from kuuna_backend.db.models import MediaAsset, MediaStatus, Message, MessageEventType, MessageVersion


class InboundPersistResult:
    def __init__(self, *, deduped: bool) -> None:
        self.deduped = deduped


def persist_inbound_event(db: Session, event: GatewayInboundEvent) -> InboundPersistResult:
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
            return InboundPersistResult(deduped=True)
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

    for media in event.message.media:
        db.add(
            MediaAsset(
                message_id=message.id,
                provider_media_id=media.provider_media_id,
                mime_type=media.mime_type,
                file_name=media.file_name,
                byte_size=media.byte_size,
                status=MediaStatus.PENDING,
                metadata_json={"download_url": media.download_url} if media.download_url else {},
            )
        )

    db.commit()
    return InboundPersistResult(deduped=False)
