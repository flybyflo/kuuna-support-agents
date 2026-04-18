from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from kuuna_backend.db.models import Role, RoleName, User, UserRole
from kuuna_backend.domain.auth.service import hash_password


def _seed_user(
    db: Session,
    *,
    email: str,
    password: str,
    role: RoleName = RoleName.OPERATOR,
    is_active: bool = True,
    must_change_password: bool = False,
) -> User:
    user = User(
        email=email,
        password_hash=hash_password(password),
        must_change_password=must_change_password,
        is_active=is_active,
    )
    db.add(user)
    db.flush()

    role_obj = db.scalar(select(Role).where(Role.name == role))
    if role_obj is None:
        role_obj = Role(name=role)
        db.add(role_obj)
        db.flush()

    db.add(UserRole(user_id=user.id, role_id=role_obj.id))
    db.commit()
    db.refresh(user)
    return user


def _login(client: TestClient, *, email: str, password: str) -> str:
    response = client.post("/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    return response.json()["access_token"]


# --- /auth/me guard tests ---

def test_me_without_token_returns_401(client: TestClient) -> None:
    response = client.get("/auth/me")
    assert response.status_code == 401


def test_me_with_invalid_token_returns_401(client: TestClient) -> None:
    response = client.get("/auth/me", headers={"Authorization": "Bearer not-a-real-token"})
    assert response.status_code == 401


def test_me_with_empty_bearer_returns_401(client: TestClient) -> None:
    response = client.get("/auth/me", headers={"Authorization": "Bearer "})
    assert response.status_code == 401


def test_me_with_valid_token_returns_200(
    client: TestClient,
    test_session_factory: sessionmaker[Session],
) -> None:
    with test_session_factory() as db:
        _seed_user(db, email="me_valid@example.com", password="ValidPass123!")

    token = _login(client, email="me_valid@example.com", password="ValidPass123!")
    response = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json()["email"] == "me_valid@example.com"


# --- /auth/login guard tests ---

def test_login_wrong_password_returns_401(
    client: TestClient,
    test_session_factory: sessionmaker[Session],
) -> None:
    with test_session_factory() as db:
        _seed_user(db, email="wrongpw@example.com", password="ValidPass123!")

    response = client.post(
        "/auth/login", json={"email": "wrongpw@example.com", "password": "WrongPass999!"}
    )
    assert response.status_code == 401


def test_login_unknown_email_returns_401(client: TestClient) -> None:
    response = client.post(
        "/auth/login", json={"email": "nobody@example.com", "password": "SomePass123!"}
    )
    assert response.status_code == 401


def test_login_inactive_user_returns_403(
    client: TestClient,
    test_session_factory: sessionmaker[Session],
) -> None:
    with test_session_factory() as db:
        _seed_user(db, email="inactive@example.com", password="ValidPass123!", is_active=False)

    response = client.post(
        "/auth/login", json={"email": "inactive@example.com", "password": "ValidPass123!"}
    )
    assert response.status_code == 403


# --- /auth/change-password guard tests ---

def test_change_password_wrong_current_returns_401(
    client: TestClient,
    test_session_factory: sessionmaker[Session],
) -> None:
    with test_session_factory() as db:
        _seed_user(db, email="changepw_wrong@example.com", password="ValidPass123!")

    token = _login(client, email="changepw_wrong@example.com", password="ValidPass123!")
    response = client.post(
        "/auth/change-password",
        headers={"Authorization": f"Bearer {token}"},
        json={"current_password": "WrongPass999!", "new_password": "NewSecure99!!"},
    )
    assert response.status_code == 401


def test_change_password_weak_new_password_returns_400(
    client: TestClient,
    test_session_factory: sessionmaker[Session],
) -> None:
    with test_session_factory() as db:
        _seed_user(db, email="weakpw@example.com", password="ValidPass123!")

    token = _login(client, email="weakpw@example.com", password="ValidPass123!")
    # Must be >=8 chars (Pydantic) but fail domain policy (no uppercase/digit/symbol)
    response = client.post(
        "/auth/change-password",
        headers={"Authorization": f"Bearer {token}"},
        json={"current_password": "ValidPass123!", "new_password": "alllower"},
    )
    assert response.status_code == 400
    assert "violations" in response.json()["detail"]


def test_change_password_succeeds_and_clears_must_change_flag(
    client: TestClient,
    test_session_factory: sessionmaker[Session],
) -> None:
    with test_session_factory() as db:
        _seed_user(
            db,
            email="mustchange@example.com",
            password="ValidPass123!",
            must_change_password=True,
        )

    token = _login(client, email="mustchange@example.com", password="ValidPass123!")
    response = client.post(
        "/auth/change-password",
        headers={"Authorization": f"Bearer {token}"},
        json={"current_password": "ValidPass123!", "new_password": "NewSecure99!!"},
    )
    assert response.status_code == 200
    assert response.json()["must_change_password"] is False


def test_change_password_without_token_returns_401(client: TestClient) -> None:
    response = client.post(
        "/auth/change-password",
        json={"current_password": "any", "new_password": "also_any"},
    )
    assert response.status_code == 401
