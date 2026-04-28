from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from kuuna_backend.db.models import (
    AgentRun,
    AgentRunStatus,
    Message,
    MessageDecision,
    Todo,
    TodoPriority,
    TodoStatus,
    ToolInvocationRecord,
)


def test_agent_state_contract_lists_todos_and_agent_runs(
    client: TestClient,
    test_session_factory: sessionmaker[Session],
) -> None:
    provider_group_id = "agent-state-group@g.us"

    with test_session_factory() as db:
        message = Message(
            provider_group_id=provider_group_id,
            provider_message_id="provider-message-agent-state",
            sender_provider_user_id="client@example.test",
            latest_version_no=1,
        )
        db.add(message)
        db.flush()

        agent_run = AgentRun(
            message_id=message.id,
            provider_group_id=provider_group_id,
            trace_id="trace-agent-state",
            status=AgentRunStatus.SUCCEEDED,
            model_path=["gpt-5.5"],
            model_used="gpt-5.5",
            reasoning_effort="medium",
            allowed_tools=["todo_create"],
            retrieval_refs=[],
            response_text="Created a todo.",
            started_at=datetime.now(timezone.utc),
            completed_at=datetime.now(timezone.utc),
        )
        db.add(agent_run)
        db.flush()
        db.add(
            Todo(
                id=uuid4(),
                provider_group_id=provider_group_id,
                agent_run_id=agent_run.id,
                title="Collect invoice screenshots",
                description="Ask the client for missing documents.",
                status=TodoStatus.OPEN,
                priority=TodoPriority.HIGH,
            )
        )
        db.add(
            MessageDecision(
                message_id=message.id,
                provider_group_id=provider_group_id,
                decision_type="passive_analysis",
                reason="message_received",
                should_execute=False,
                payload={"created_todo_count": 1},
            )
        )
        db.add(
            ToolInvocationRecord(
                agent_run_id=agent_run.id,
                message_id=message.id,
                provider_group_id=provider_group_id,
                tool_name="todo_create",
                ok=True,
                stdout='{"title":"Collect invoice screenshots"}',
                stderr="",
                timed_out=False,
                duration_ms=42,
                details={"operation": "create", "title": "Collect invoice screenshots"},
            )
        )
        db.commit()

    todos_response = client.get(f"/todos?provider_group_id={provider_group_id}")
    assert todos_response.status_code == 200
    todos = todos_response.json()
    assert len(todos) == 1
    assert todos[0]["title"] == "Collect invoice screenshots"
    assert todos[0]["status"] == "open"
    assert todos[0]["priority"] == "high"

    runs_response = client.get(f"/agent-runs?provider_group_id={provider_group_id}")
    assert runs_response.status_code == 200
    runs = runs_response.json()
    assert len(runs) == 1
    assert runs[0]["model_path"] == ["gpt-5.5"]
    assert runs[0]["model_used"] == "gpt-5.5"
    assert runs[0]["reasoning_effort"] == "medium"

    decisions_response = client.get(f"/message-decisions?provider_group_id={provider_group_id}")
    assert decisions_response.status_code == 200
    decisions = decisions_response.json()
    assert len(decisions) == 1
    assert decisions[0]["decision_type"] == "passive_analysis"
    assert decisions[0]["payload"]["created_todo_count"] == 1

    invocations_response = client.get(f"/tool-invocations?provider_group_id={provider_group_id}")
    assert invocations_response.status_code == 200
    invocations = invocations_response.json()
    assert len(invocations) == 1
    assert invocations[0]["tool_name"] == "todo_create"
    assert invocations[0]["ok"] is True
    assert invocations[0]["details"]["operation"] == "create"
