from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy import select

from kuuna_backend.config.settings import get_settings
from kuuna_backend.db.models import Todo, TodoStatus
from kuuna_backend.integrations.postgres import get_db_session

logger = logging.getLogger(__name__)


def export_pending_todos_job(limit: int = 100, provider_group_id: str | None = None) -> int:
    settings = get_settings()
    if not settings.todo_export_enabled:
        logger.info("todo_export_disabled")
        return 0

    if not settings.todo_export_webhook_url:
        logger.warning("todo_export_webhook_missing")
        return 0

    db = get_db_session()
    exported_count = 0
    try:
        stmt = (
            select(Todo)
            .where(
                Todo.exported_at.is_(None),
                Todo.status.in_([TodoStatus.OPEN, TodoStatus.IN_PROGRESS]),
            )
            .order_by(Todo.created_at.asc())
            .limit(limit)
        )
        if provider_group_id:
            stmt = stmt.where(Todo.provider_group_id == provider_group_id)

        todos = db.scalars(stmt).all()
        for todo in todos:
            todo.export_attempt_count += 1
            try:
                external_ref = _post_todo(settings.todo_export_webhook_url, todo)
            except Exception as exc:
                todo.last_export_error = str(exc)[:1000]
                logger.warning(
                    "todo_export_failed",
                    extra={
                        "todo_id": str(todo.id),
                        "provider_group_id": todo.provider_group_id,
                        "error": str(exc),
                    },
                )
                continue

            todo.exported_at = datetime.now(timezone.utc)
            todo.external_ref = external_ref
            todo.last_export_error = None
            exported_count += 1

        db.commit()
        return exported_count
    except Exception:
        db.rollback()
        logger.exception("todo_export_job_failed")
        raise
    finally:
        db.close()


def _post_todo(webhook_url: str, todo: Todo) -> str | None:
    settings = get_settings()
    response = httpx.post(
        webhook_url,
        json={
            "id": str(todo.id),
            "provider_group_id": todo.provider_group_id,
            "message_id": str(todo.message_id) if todo.message_id else None,
            "agent_run_id": str(todo.agent_run_id) if todo.agent_run_id else None,
            "title": todo.title,
            "description": todo.description,
            "status": todo.status.value,
            "priority": todo.priority.value,
            "due_at": todo.due_at.isoformat() if todo.due_at else None,
            "created_at": todo.created_at.isoformat(),
            "updated_at": todo.updated_at.isoformat(),
        },
        timeout=settings.todo_export_timeout_seconds,
    )
    response.raise_for_status()

    payload = response.json() if response.content else {}
    if isinstance(payload, dict):
        external_ref = payload.get("external_ref") or payload.get("id")
        if isinstance(external_ref, str) and external_ref:
            return external_ref
    return None


def main() -> None:
    export_pending_todos_job()


if __name__ == "__main__":
    main()
