from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from kuuna_backend.db.models import MessageEventType


class ORMReadModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class KnowledgeCommonDocRead(ORMReadModel):
    id: UUID
    doc_key: str
    title: str
    created_at: datetime
    updated_at: datetime


class KnowledgeGroupDocRead(ORMReadModel):
    id: UUID
    provider_group_id: str
    doc_key: str
    title: str
    created_at: datetime
    updated_at: datetime


class IngestedKnowledgeDocRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    doc_key: str
    scope: str
    provider_group_id: str | None = None
    title: str
    status: str
    updated_at: datetime
    updated_by: str
    chunk_count: int


class MessageRead(ORMReadModel):
    id: UUID
    provider_group_id: str
    provider_message_id: str
    sender_provider_user_id: str | None
    latest_version_no: int
    created_at: datetime
    updated_at: datetime


class MessageVersionRead(ORMReadModel):
    id: UUID
    message_id: UUID
    version_no: int
    event_type: MessageEventType
    is_deleted: bool
    text_content: str | None
    raw_event: dict[str, Any]
    occurred_at: datetime
    created_at: datetime


class RetrievalHitRead(ORMReadModel):
    source_type: str
    source_scope: str
    score: float
    content: str
    occurred_at: datetime
    message_id: UUID | None = None
    message_version_id: UUID | None = None
    provider_message_id: str | None = None
    knowledge_version_id: UUID | None = None
    knowledge_doc_id: UUID | None = None
    knowledge_doc_title: str | None = None
    chunk_no: int | None = None


class AuditEventRead(ORMReadModel):
    id: UUID
    actor_user_id: UUID | None
    event_type: str
    entity_type: str
    entity_id: str
    payload: dict[str, Any]
    created_at: datetime


# ---------------------------------------------------------------------------
# Trace / pipeline-path read models (§9.3 traceability)
# ---------------------------------------------------------------------------


class TraceMediaAssetRead(ORMReadModel):
    """Snapshot of a single media asset as seen in the ingest/processing stage."""

    id: UUID
    provider_media_id: str
    mime_type: str
    file_name: str | None
    byte_size: int | None
    status: str  # MediaStatus value
    s3_key: str | None
    created_at: datetime


class TraceOutboundRead(ORMReadModel):
    """Outbound intent that can be linked back to an inbound message."""

    id: UUID
    outbound_intent_id: UUID
    provider_group_id: str
    status: str  # OutboundStatus value
    attempt_count: int
    payload: dict[str, Any]
    trace_id: str | None = None
    model_path: list[str] = Field(default_factory=list)
    retrieval_refs: list[dict[str, Any]] = Field(default_factory=list)
    created_at: datetime


class MessageTraceRead(BaseModel):
    """Full pipeline trace for one (provider_group_id, provider_message_id) pair.

    Covers three stages:
    - ingest   : raw message record + immutable version history
    - media    : media assets attached to the message (processing stage)
    - outbound : outbound intents whose payload references this message
    """

    provider_group_id: str
    provider_message_id: str
    message_id: UUID | None
    ingest: MessageRead | None
    versions: list[MessageVersionRead]
    media: list[TraceMediaAssetRead]
    outbound: list[TraceOutboundRead]
