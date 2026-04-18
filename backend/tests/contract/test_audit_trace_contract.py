from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from kuuna_backend.domain.audit.service import append_audit_event


def test_audit_events_endpoint_returns_empty_list_initially(client: TestClient) -> None:
    response = client.get("/audit/events")
    assert response.status_code == 200
    assert response.json() == []


def test_audit_events_endpoint_returns_seeded_event(
    client: TestClient,
    test_session_factory: sessionmaker[Session],
) -> None:
    with test_session_factory() as db:
        append_audit_event(
            db,
            actor_user_id=None,
            event_type="auth.login",
            entity_type="user",
            entity_id="user-1",
            payload={"email": "test@example.com"},
        )
        db.commit()

    response = client.get("/audit/events")
    assert response.status_code == 200
    events = response.json()
    assert len(events) == 1
    assert events[0]["event_type"] == "auth.login"
    assert events[0]["entity_type"] == "user"
    assert events[0]["entity_id"] == "user-1"
    assert events[0]["actor_user_id"] is None


def test_audit_events_endpoint_returns_multiple_events_in_desc_order(
    client: TestClient,
    test_session_factory: sessionmaker[Session],
) -> None:
    with test_session_factory() as db:
        for i in range(3):
            append_audit_event(
                db,
                actor_user_id=None,
                event_type=f"test.event.{i}",
                entity_type="test",
                entity_id=str(i),
                payload={"seq": i},
            )
        db.commit()

    response = client.get("/audit/events")
    assert response.status_code == 200
    events = response.json()
    assert len(events) == 3


def test_audit_events_limit_parameter_restricts_results(
    client: TestClient,
    test_session_factory: sessionmaker[Session],
) -> None:
    with test_session_factory() as db:
        for i in range(5):
            append_audit_event(
                db,
                actor_user_id=None,
                event_type=f"test.limit.{i}",
                entity_type="test",
                entity_id=str(i),
                payload={},
            )
        db.commit()

    response = client.get("/audit/events", params={"limit": 3})
    assert response.status_code == 200
    assert len(response.json()) == 3


def test_audit_events_limit_above_max_returns_422(client: TestClient) -> None:
    response = client.get("/audit/events", params={"limit": 201})
    assert response.status_code == 422


def test_audit_events_limit_below_min_returns_422(client: TestClient) -> None:
    response = client.get("/audit/events", params={"limit": 0})
    assert response.status_code == 422
