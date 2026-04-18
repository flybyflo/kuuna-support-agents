from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from kuuna_backend.api.deps import get_db
from kuuna_backend.api.schemas.read_models import (
    AuditEventRead,
    MessageRead,
    MessageTraceRead,
    MessageVersionRead,
    TraceMediaAssetRead,
    TraceOutboundRead,
)
from kuuna_backend.db.models import AuditEvent, MediaAsset, Message, MessageVersion, OutboundIntent

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("/events", response_model=list[AuditEventRead])
def list_audit_events(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> list[AuditEvent]:
    stmt = (
        select(AuditEvent).order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc()).limit(limit)
    )
    return list(db.scalars(stmt))


@router.get(
    "/trace/message/{provider_group_id}/{provider_message_id}",
    response_model=MessageTraceRead,
    summary="Inspect the full ingest → execution → outbound trace for a single message",
)
def get_message_trace(
    provider_group_id: str,
    provider_message_id: str,
    db: Session = Depends(get_db),
) -> MessageTraceRead:
    """Return a structured pipeline trace using only persisted data.

    Stages returned:

    * **ingest** – the ``Message`` record plus every ``MessageVersion`` row in
      version order (one row per created/edited/deleted event received from the
      gateway).
    * **media** – every ``MediaAsset`` linked to the message (status reflects
      the async media-processing pipeline: *pending* → *ready* / *failed*).
    * **outbound** – ``OutboundIntent`` rows whose payload contains
      ``reply_to_provider_message_id`` matching ``provider_message_id`` and the
      same ``provider_group_id``.  These are written by the ingest-execution
      job when an active binding exists for the group.

    Returns 200 with empty ``versions``/``media``/``outbound`` lists when the
    message is not yet known (the ``ingest`` field will be ``null``).
    """
    # ------------------------------------------------------------------
    # Stage 1 – ingest: message + version history
    # ------------------------------------------------------------------
    message = db.execute(
        select(Message).where(
            Message.provider_group_id == provider_group_id,
            Message.provider_message_id == provider_message_id,
        )
    ).scalar_one_or_none()

    versions: list[MessageVersionRead] = []
    media: list[TraceMediaAssetRead] = []

    if message is not None:
        raw_versions = list(
            db.scalars(
                select(MessageVersion)
                .where(MessageVersion.message_id == message.id)
                .order_by(MessageVersion.version_no.asc())
            )
        )
        versions = [MessageVersionRead.model_validate(v) for v in raw_versions]

        # ------------------------------------------------------------------
        # Stage 2 – media-processing: assets attached to this message
        # ------------------------------------------------------------------
        raw_assets = list(
            db.scalars(
                select(MediaAsset)
                .where(MediaAsset.message_id == message.id)
                .order_by(MediaAsset.created_at.asc())
            )
        )
        media = [TraceMediaAssetRead.model_validate(a) for a in raw_assets]

    # ------------------------------------------------------------------
    # Stage 3 – outbound: intents whose payload references this message.
    #
    # The ingest-execution job (jobs/ingest.py) stores
    # ``reply_to_provider_message_id`` inside the JSON payload.  We fetch
    # all intents for the group and filter in Python so the query works
    # identically on both PostgreSQL and the SQLite used in unit tests.
    # ------------------------------------------------------------------
    raw_intents = list(
        db.scalars(
            select(OutboundIntent)
            .where(OutboundIntent.provider_group_id == provider_group_id)
            .order_by(OutboundIntent.created_at.asc())
        )
    )
    outbound = [
        _build_trace_outbound(oi)
        for oi in raw_intents
        if oi.payload.get("reply_to_provider_message_id") == provider_message_id
    ]

    return MessageTraceRead(
        provider_group_id=provider_group_id,
        provider_message_id=provider_message_id,
        message_id=message.id if message else None,
        ingest=MessageRead.model_validate(message) if message else None,
        versions=versions,
        media=media,
        outbound=outbound,
    )


def _build_trace_outbound(outbound_intent: OutboundIntent) -> TraceOutboundRead:
    payload = outbound_intent.payload if isinstance(outbound_intent.payload, dict) else {}
    metadata_raw = payload.get("metadata")
    metadata = metadata_raw if isinstance(metadata_raw, dict) else {}

    model_path_raw = metadata.get("model_path")
    model_path = [str(item) for item in model_path_raw if isinstance(item, str)] if isinstance(model_path_raw, list) else []

    retrieval_refs = _extract_retrieval_refs(payload, metadata)

    trace_id_raw = payload.get("trace_id")
    trace_id = str(trace_id_raw) if isinstance(trace_id_raw, str) and trace_id_raw else None

    return TraceOutboundRead(
        id=outbound_intent.id,
        outbound_intent_id=outbound_intent.outbound_intent_id,
        provider_group_id=outbound_intent.provider_group_id,
        status=outbound_intent.status.value,
        attempt_count=outbound_intent.attempt_count,
        payload=payload,
        trace_id=trace_id,
        model_path=model_path,
        retrieval_refs=retrieval_refs,
        created_at=outbound_intent.created_at,
    )


def _extract_retrieval_refs(payload: dict[str, Any], metadata: dict[str, Any]) -> list[dict[str, Any]]:
    candidates = (
        payload.get("retrieval_refs"),
        metadata.get("retrieval_refs"),
        payload.get("retrieval"),
        metadata.get("retrieval"),
    )

    for candidate in candidates:
        if isinstance(candidate, list):
            return [item for item in candidate if isinstance(item, dict)]

    return []
