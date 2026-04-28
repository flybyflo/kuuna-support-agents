from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from kuuna_backend.api.deps import get_db
from kuuna_backend.api.schemas.read_models import (
    AgentRunRead,
    MessageDecisionRead,
    TodoRead,
    ToolInvocationRead,
)
from kuuna_backend.db.models import AgentRun, MessageDecision, Todo, ToolInvocationRecord

router = APIRouter(tags=["agent-state"])


@router.get("/todos", response_model=list[TodoRead])
def list_todos(
    provider_group_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[TodoRead]:
    stmt = select(Todo)
    if provider_group_id:
        stmt = stmt.where(Todo.provider_group_id == provider_group_id)
    stmt = stmt.order_by(Todo.updated_at.desc()).limit(200)
    return [TodoRead.model_validate(todo) for todo in db.scalars(stmt).all()]


@router.get("/agent-runs", response_model=list[AgentRunRead])
def list_agent_runs(
    provider_group_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[AgentRunRead]:
    stmt = select(AgentRun)
    if provider_group_id:
        stmt = stmt.where(AgentRun.provider_group_id == provider_group_id)
    stmt = stmt.order_by(AgentRun.started_at.desc()).limit(100)
    return [AgentRunRead.model_validate(agent_run) for agent_run in db.scalars(stmt).all()]


@router.get("/message-decisions", response_model=list[MessageDecisionRead])
def list_message_decisions(
    provider_group_id: str | None = Query(default=None),
    message_id: UUID | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[MessageDecisionRead]:
    stmt = select(MessageDecision)
    if provider_group_id:
        stmt = stmt.where(MessageDecision.provider_group_id == provider_group_id)
    if message_id:
        stmt = stmt.where(MessageDecision.message_id == message_id)
    stmt = stmt.order_by(MessageDecision.created_at.desc()).limit(200)
    return [MessageDecisionRead.model_validate(decision) for decision in db.scalars(stmt).all()]


@router.get("/tool-invocations", response_model=list[ToolInvocationRead])
def list_tool_invocations(
    provider_group_id: str | None = Query(default=None),
    agent_run_id: UUID | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[ToolInvocationRead]:
    stmt = select(ToolInvocationRecord)
    if provider_group_id:
        stmt = stmt.where(ToolInvocationRecord.provider_group_id == provider_group_id)
    if agent_run_id:
        stmt = stmt.where(ToolInvocationRecord.agent_run_id == agent_run_id)
    stmt = stmt.order_by(ToolInvocationRecord.created_at.desc()).limit(200)
    return [ToolInvocationRead.model_validate(invocation) for invocation in db.scalars(stmt).all()]
