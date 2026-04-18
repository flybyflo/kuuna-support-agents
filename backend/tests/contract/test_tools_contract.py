from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from kuuna_backend.db.models import ToolCatalogEntry


def test_list_tools_bootstraps_default_catalog(
    client: TestClient,
    test_session_factory: sessionmaker[Session],
) -> None:
    response = client.get("/tools")
    assert response.status_code == 200

    payload = response.json()
    items = payload["items"]
    assert len(items) >= 4

    keys = {item["tool_key"] for item in items}
    assert "echo" in keys
    assert "uppercase" in keys

    echo_item = next(item for item in items if item["tool_key"] == "echo")
    assert isinstance(echo_item["description"], str)
    assert echo_item["description"]

    with test_session_factory() as db:
        persisted = db.scalars(select(ToolCatalogEntry)).all()
    assert persisted


def test_upsert_tool_catalog_entry_updates_existing_tool(client: TestClient) -> None:
    create_response = client.post(
        "/tools",
        json={
            "tool_key": "reply_safety_guard",
            "display_name": "Reply Safety Guard",
            "description": "Runs outbound reply checks before dispatch.",
            "risk_class": "read",
            "category": "safety",
            "is_enabled": True,
        },
    )
    assert create_response.status_code == 201

    update_response = client.post(
        "/tools",
        json={
            "tool_key": "reply_safety_guard",
            "display_name": "Reply Safety Guard",
            "description": "Runs strict outbound reply policy checks.",
            "risk_class": "admin",
            "category": "safety",
            "is_enabled": False,
        },
    )
    assert update_response.status_code == 201

    item = update_response.json()
    assert item["tool_key"] == "reply_safety_guard"
    assert item["description"] == "Runs strict outbound reply policy checks."
    assert item["risk_class"] == "admin"
    assert item["is_enabled"] is False

    list_response = client.get("/tools")
    assert list_response.status_code == 200
    listed = next(
        row
        for row in list_response.json()["items"]
        if row["tool_key"] == "reply_safety_guard"
    )
    assert listed["description"] == "Runs strict outbound reply policy checks."
