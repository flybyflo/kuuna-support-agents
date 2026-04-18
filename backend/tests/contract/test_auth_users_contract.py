from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from kuuna_backend.db.models import AuditEvent, Role, RoleName, User, UserRole
from kuuna_backend.domain.auth.service import hash_password


OWNER_EMAIL = "owner@example.com"
OWNER_PASSWORD = "OwnerSecure123!"


def _seed_owner(db: Session) -> User:
    owner = User(
        email=OWNER_EMAIL,
        password_hash=hash_password(OWNER_PASSWORD),
        must_change_password=False,
        is_active=True,
    )
    db.add(owner)
    db.flush()

    role_owner = db.scalar(select(Role).where(Role.name == RoleName.OWNER))
    if role_owner is None:
        role_owner = Role(name=RoleName.OWNER)
        db.add(role_owner)
        db.flush()

    db.add(UserRole(user_id=owner.id, role_id=role_owner.id))
    db.commit()
    db.refresh(owner)
    return owner


def _login_owner(client: TestClient) -> str:
    response = client.post(
        "/auth/login",
        json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD},
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def test_auth_login_and_me_contract(
    client: TestClient,
    test_session_factory: sessionmaker[Session],
) -> None:
    with test_session_factory() as db:
        _seed_owner(db)

    access_token = _login_owner(client)

    me_response = client.get("/auth/me", headers={"Authorization": f"Bearer {access_token}"})
    assert me_response.status_code == 200

    payload = me_response.json()
    assert payload["email"] == OWNER_EMAIL
    assert payload["role"] == RoleName.OWNER.value
    assert payload["group_scope"] == []


def test_users_create_and_delete_contract(
    client: TestClient,
    test_session_factory: sessionmaker[Session],
) -> None:
    with test_session_factory() as db:
        owner = _seed_owner(db)
        owner_id = owner.id

    access_token = _login_owner(client)
    headers = {"Authorization": f"Bearer {access_token}"}

    create_response = client.post(
        "/users",
        headers=headers,
        json={
            "email": "operator@example.com",
            "password": "Operator123!!",
            "roles": [RoleName.OPERATOR.value],
            "group_scope": ["group-a@g.us"],
            "must_change_password": True,
            "is_active": True,
        },
    )
    assert create_response.status_code == 201
    created_user = create_response.json()
    assert created_user["roles"] == [RoleName.OPERATOR.value]
    assert created_user["group_scope"] == ["group-a@g.us"]

    created_user_id = created_user["id"]

    delete_response = client.delete(f"/users/{created_user_id}", headers=headers)
    assert delete_response.status_code == 204

    with test_session_factory() as db:
        hard_delete_event = db.scalar(
            select(AuditEvent).where(AuditEvent.event_type == "user.hard_deleted").limit(1)
        )
        assert hard_delete_event is not None
        assert hard_delete_event.actor_user_id == owner_id
