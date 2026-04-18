from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Mapping
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from kuuna_backend.db.models import OutboundIntent, OutboundStatus


def _json_safe(value: Any) -> Any:
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Mapping):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [_json_safe(item) for item in value]
    return value


def _payload_to_dict(payload: Any) -> dict[str, Any]:
    if payload is None:
        return {}

    if hasattr(payload, "model_dump"):
        return dict(payload.model_dump(mode="json"))

    if isinstance(payload, Mapping):
        return dict(_json_safe(payload))

    raise TypeError("payload must be a mapping or support model_dump(mode='json')")


def _optional_mapping_to_dict(payload: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if payload is None:
        return None

    normalized_payload = dict(_json_safe(payload))
    return normalized_payload or None


def _utc_timestamp() -> str:
    return datetime.now(UTC).isoformat()


def _status_timestamp(occurred_at: datetime | None) -> str:
    if occurred_at is None:
        return _utc_timestamp()
    return occurred_at.astimezone(UTC).isoformat()


def _merge_dispatch_metadata(payload: Mapping[str, Any] | None, *, updates: Mapping[str, Any]) -> dict[str, Any]:
    merged_payload = dict(payload or {})
    dispatch = dict(merged_payload.get("_dispatch") or {})
    dispatch.update(dict(updates))
    merged_payload["_dispatch"] = dispatch
    return merged_payload


def get_outbound_intent(db: Session, outbound_intent_id: UUID) -> OutboundIntent | None:
    return db.execute(
        select(OutboundIntent).where(OutboundIntent.outbound_intent_id == outbound_intent_id)
    ).scalar_one_or_none()


def create_outbound_intent(
    db: Session,
    *,
    provider_group_id: str,
    payload: Any,
    outbound_intent_id: UUID | None = None,
) -> OutboundIntent:
    intent_id = outbound_intent_id or uuid4()
    normalized_payload = _payload_to_dict(payload)
    normalized_payload.setdefault("outbound_intent_id", str(intent_id))
    normalized_payload.setdefault("provider_group_id", provider_group_id)

    outbound_intent = OutboundIntent(
        outbound_intent_id=intent_id,
        provider_group_id=provider_group_id,
        status=OutboundStatus.PENDING,
        attempt_count=0,
        payload=_merge_dispatch_metadata(
            normalized_payload,
            updates={
                "created_at": _utc_timestamp(),
                "last_status": OutboundStatus.PENDING.value,
            },
        ),
    )
    db.add(outbound_intent)
    db.commit()
    db.refresh(outbound_intent)
    return outbound_intent


def mark_outbound_intent_sending(db: Session, outbound_intent_id: UUID) -> OutboundIntent | None:
    outbound_intent = get_outbound_intent(db, outbound_intent_id)
    if outbound_intent is None:
        return None

    outbound_intent.status = OutboundStatus.SENDING
    outbound_intent.attempt_count += 1
    outbound_intent.payload = _merge_dispatch_metadata(
        outbound_intent.payload,
        updates={
            "last_status": OutboundStatus.SENDING.value,
            "last_attempt_at": _utc_timestamp(),
            "last_error_code": None,
            "last_error_message": None,
            "next_retry_in_seconds": None,
        },
    )
    db.commit()
    db.refresh(outbound_intent)
    return outbound_intent


def mark_outbound_intent_retrying(
    db: Session,
    outbound_intent_id: UUID,
    *,
    error_code: str | None = None,
    error_message: str | None = None,
    provider_message_id: str | None = None,
    response_payload: Mapping[str, Any] | None = None,
    occurred_at: datetime | None = None,
    retry_in_seconds: int | None = None,
) -> OutboundIntent | None:
    outbound_intent = get_outbound_intent(db, outbound_intent_id)
    if outbound_intent is None:
        return None

    outbound_intent.status = OutboundStatus.SENDING
    outbound_intent.payload = _merge_dispatch_metadata(
        outbound_intent.payload,
        updates={
            "last_status": "retrying",
            "retrying_at": _status_timestamp(occurred_at),
            "provider_message_id": provider_message_id,
            "last_error_code": error_code,
            "last_error_message": error_message,
            "last_response": _optional_mapping_to_dict(response_payload),
            "next_retry_in_seconds": retry_in_seconds,
        },
    )
    db.commit()
    db.refresh(outbound_intent)
    return outbound_intent


def mark_outbound_intent_sent(
    db: Session,
    outbound_intent_id: UUID,
    *,
    provider_message_id: str | None = None,
    response_payload: Mapping[str, Any] | None = None,
    occurred_at: datetime | None = None,
) -> OutboundIntent | None:
    outbound_intent = get_outbound_intent(db, outbound_intent_id)
    if outbound_intent is None:
        return None

    outbound_intent.status = OutboundStatus.SENT
    outbound_intent.payload = _merge_dispatch_metadata(
        outbound_intent.payload,
        updates={
            "last_status": OutboundStatus.SENT.value,
            "sent_at": _status_timestamp(occurred_at),
            "provider_message_id": provider_message_id,
            "last_error_code": None,
            "last_error_message": None,
            "last_response": _optional_mapping_to_dict(response_payload),
            "next_retry_in_seconds": None,
        },
    )
    db.commit()
    db.refresh(outbound_intent)
    return outbound_intent


def mark_outbound_intent_failed(
    db: Session,
    outbound_intent_id: UUID,
    *,
    error_code: str | None = None,
    error_message: str | None = None,
    provider_message_id: str | None = None,
    response_payload: Mapping[str, Any] | None = None,
    occurred_at: datetime | None = None,
) -> OutboundIntent | None:
    outbound_intent = get_outbound_intent(db, outbound_intent_id)
    if outbound_intent is None:
        return None

    outbound_intent.status = OutboundStatus.FAILED
    outbound_intent.payload = _merge_dispatch_metadata(
        outbound_intent.payload,
        updates={
            "last_status": OutboundStatus.FAILED.value,
            "failed_at": _status_timestamp(occurred_at),
            "provider_message_id": provider_message_id,
            "last_error_code": error_code,
            "last_error_message": error_message,
            "last_response": _optional_mapping_to_dict(response_payload),
            "next_retry_in_seconds": None,
        },
    )
    db.commit()
    db.refresh(outbound_intent)
    return outbound_intent
