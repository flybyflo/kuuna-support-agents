from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from kuuna_backend.api.deps import get_db
from kuuna_backend.api.schemas.gateway import (
    GatewayInboundAccepted,
    GatewayInboundEvent,
    GatewayOutboundStatusAccepted,
    GatewayOutboundStatusEvent,
)
from kuuna_backend.domain.messages.ingest import persist_inbound_event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/gateway", tags=["gateway"])


@router.post(
    "/inbound",
    response_model=GatewayInboundAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
def ingest_inbound_event(
    event: GatewayInboundEvent,
    db: Session = Depends(get_db),
) -> GatewayInboundAccepted:
    try:
        result = persist_inbound_event(db, event)
    except Exception as exc:  # pragma: no cover - defensive error boundary
        db.rollback()
        logger.exception(
            "gateway_inbound_failed",
            extra={
                "trace_id": str(event.trace_id),
                "provider_group_id": event.provider_group_id,
                "provider_message_id": event.provider_message_id,
            },
        )
        raise HTTPException(status_code=500, detail="inbound persistence failed") from exc

    logger.info(
        "gateway_inbound_accepted",
        extra={
            "trace_id": str(event.trace_id),
            "provider": event.provider,
            "provider_group_id": event.provider_group_id,
            "provider_message_id": event.provider_message_id,
            "event_type": event.event_type,
            "deduped": result.deduped,
        },
    )
    return GatewayInboundAccepted(accepted=True, trace_id=event.trace_id, deduped=result.deduped)


@router.post(
    "/outbound/status",
    response_model=GatewayOutboundStatusAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
def report_outbound_status(event: GatewayOutboundStatusEvent) -> GatewayOutboundStatusAccepted:
    logger.info(
        "gateway_outbound_status_accepted",
        extra={
            "trace_id": str(event.trace_id),
            "outbound_intent_id": str(event.outbound_intent_id),
            "status": event.status,
            "provider_message_id": event.provider_message_id,
        },
    )
    return GatewayOutboundStatusAccepted(accepted=True, trace_id=event.trace_id)
