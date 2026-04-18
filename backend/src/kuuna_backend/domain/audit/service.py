from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from kuuna_backend.db.models import AuditEvent


def append_audit_event(
    db: Session,
    *,
    actor_user_id: UUID | None,
    event_type: str,
    entity_type: str,
    entity_id: str,
    payload: dict[str, Any],
) -> AuditEvent:
    event = AuditEvent(
        actor_user_id=actor_user_id,
        event_type=event_type,
        entity_type=entity_type,
        entity_id=entity_id,
        payload=payload,
    )
    db.add(event)
    return event
