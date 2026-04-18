from __future__ import annotations

import logging

from fastapi import APIRouter, status

from kuuna_backend.api.schemas.gateway import (
    GatewayInboundAccepted,
    GatewayInboundEvent,
    GatewayOutboundStatusAccepted,
    GatewayOutboundStatusEvent,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/gateway", tags=["gateway"])


@router.post(
    "/inbound",
    response_model=GatewayInboundAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
def ingest_inbound_event(event: GatewayInboundEvent) -> GatewayInboundAccepted:
    logger.info(
        "gateway_inbound_accepted",
        extra={
            "trace_id": str(event.trace_id),
            "provider": event.provider,
            "provider_group_id": event.provider_group_id,
            "provider_message_id": event.provider_message_id,
            "event_type": event.event_type,
        },
    )
    return GatewayInboundAccepted(accepted=True, trace_id=event.trace_id)


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
