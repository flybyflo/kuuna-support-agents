from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


GatewayEventType = Literal["message_created", "message_edited", "message_deleted"]
GatewayProvider = Literal["whatsapp-neonize"]
OutboundDeliveryStatus = Literal["sent", "failed", "retrying"]


class InboundMedia(BaseModel):
    provider_media_id: str
    mime_type: str
    file_name: str | None = None
    byte_size: int | None = None
    download_url: str | None = None


class InboundMessage(BaseModel):
    text: str | None = None
    reply_to_provider_message_id: str | None = None
    mentions: list[str] = Field(default_factory=list)
    media: list[InboundMedia] = Field(default_factory=list)


class GatewayInboundEvent(BaseModel):
    trace_id: UUID
    provider: GatewayProvider
    provider_group_id: str
    provider_message_id: str
    sender_provider_user_id: str | None = None
    event_type: GatewayEventType
    occurred_at: datetime
    message: InboundMessage
    raw_event: dict[str, Any] | None = None


class GatewayInboundAccepted(BaseModel):
    accepted: bool
    trace_id: UUID
    deduped: bool = False


class OutboundMetadata(BaseModel):
    agent_instance_id: UUID
    model_path: list[str]


class GatewayOutboundIntent(BaseModel):
    trace_id: UUID
    outbound_intent_id: UUID
    provider_group_id: str
    reply_to_provider_message_id: str | None = None
    text: str
    metadata: OutboundMetadata


class GatewayOutboundStatusEvent(BaseModel):
    trace_id: UUID
    outbound_intent_id: UUID
    status: OutboundDeliveryStatus
    provider_message_id: str | None = None
    error_code: str | None = None
    error_message: str | None = None
    occurred_at: datetime


class GatewayOutboundStatusAccepted(BaseModel):
    accepted: bool
    trace_id: UUID
