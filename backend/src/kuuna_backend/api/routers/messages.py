from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from kuuna_backend.api.deps import get_db
from kuuna_backend.api.schemas.read_models import MessageRead, MessageVersionRead, RetrievalHitRead
from kuuna_backend.db.models import Message, MessageVersion
from kuuna_backend.domain.retrieval import retrieve_context

router = APIRouter(prefix="/messages", tags=["messages"])


@router.get("", response_model=list[MessageRead])
def list_messages(
    provider_group_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[Message]:
    stmt = select(Message)
    if provider_group_id is not None:
        stmt = stmt.where(Message.provider_group_id == provider_group_id)

    stmt = stmt.order_by(Message.created_at.desc(), Message.id.desc())
    return list(db.scalars(stmt))


@router.get("/retrieval/{provider_group_id}", response_model=list[RetrievalHitRead])
def debug_retrieve_context(
    provider_group_id: str,
    q: str = Query(min_length=1),
    limit: int = Query(default=12, ge=1, le=50),
    db: Session = Depends(get_db),
) -> list[RetrievalHitRead]:
    hits = retrieve_context(
        db,
        provider_group_id=provider_group_id,
        query=q,
        limit=limit,
    )
    return [RetrievalHitRead.model_validate(hit) for hit in hits]


@router.get("/{message_id}/versions", response_model=list[MessageVersionRead])
def list_message_versions(message_id: UUID, db: Session = Depends(get_db)) -> list[MessageVersion]:
    message_exists = db.execute(select(Message.id).where(Message.id == message_id).limit(1)).scalar_one_or_none()
    if message_exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="message not found")

    stmt = (
        select(MessageVersion)
        .where(MessageVersion.message_id == message_id)
        .order_by(MessageVersion.version_no.asc())
    )
    return list(db.scalars(stmt))
