from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from kuuna_backend.db.models import GroupAssignment, Role, RoleName, User, UserRole
from kuuna_backend.domain.audit.service import append_audit_event
from kuuna_backend.domain.auth.service import hash_password, password_policy_violations


class UserServiceError(RuntimeError):
    """Base error for user admin operations."""


class UserNotFoundError(UserServiceError):
    pass


class UserConflictError(UserServiceError):
    pass


class RoleNotFoundError(UserServiceError):
    pass


class PasswordPolicyError(UserServiceError):
    def __init__(self, violations: list[str]) -> None:
        super().__init__("password policy violation")
        self.violations = violations


def list_users(db: Session) -> list[User]:
    stmt = select(User).order_by(User.email.asc())
    return list(db.scalars(stmt))


def get_user(db: Session, *, user_id: UUID) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise UserNotFoundError("user not found")
    return user


def create_user(
    db: Session,
    *,
    actor_user_id: UUID,
    email: str,
    password: str,
    roles: list[RoleName],
    group_scope: list[str],
    must_change_password: bool,
    is_active: bool,
) -> User:
    normalized_email = email.strip().lower()
    violations = password_policy_violations(password)
    if violations:
        raise PasswordPolicyError(violations)

    user = User(
        email=normalized_email,
        password_hash=hash_password(password),
        must_change_password=must_change_password,
        is_active=is_active,
        password_changed_at=datetime.now(UTC),
    )
    db.add(user)

    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise UserConflictError("email already exists") from exc

    _replace_roles(db, user_id=user.id, roles=roles)
    _replace_group_assignments(db, user_id=user.id, group_scope=group_scope)

    append_audit_event(
        db,
        actor_user_id=actor_user_id,
        event_type="user.created",
        entity_type="user",
        entity_id=str(user.id),
        payload={"email": user.email, "roles": [role.value for role in roles]},
    )

    db.commit()
    db.refresh(user)
    return user


def update_user(
    db: Session,
    *,
    actor_user_id: UUID,
    user_id: UUID,
    is_active: bool | None,
    must_change_password: bool | None,
) -> User:
    user = get_user(db, user_id=user_id)
    before = {
        "is_active": user.is_active,
        "must_change_password": user.must_change_password,
    }

    if is_active is not None:
        user.is_active = is_active
    if must_change_password is not None:
        user.must_change_password = must_change_password

    append_audit_event(
        db,
        actor_user_id=actor_user_id,
        event_type="user.updated",
        entity_type="user",
        entity_id=str(user.id),
        payload={
            "before": before,
            "after": {
                "is_active": user.is_active,
                "must_change_password": user.must_change_password,
            },
        },
    )

    db.commit()
    db.refresh(user)
    return user


def set_user_roles(
    db: Session,
    *,
    actor_user_id: UUID,
    user_id: UUID,
    roles: list[RoleName],
) -> User:
    user = get_user(db, user_id=user_id)
    _replace_roles(db, user_id=user.id, roles=roles)

    append_audit_event(
        db,
        actor_user_id=actor_user_id,
        event_type="user.roles_updated",
        entity_type="user",
        entity_id=str(user.id),
        payload={"roles": [role.value for role in roles]},
    )

    db.commit()
    db.refresh(user)
    return user


def set_user_group_scope(
    db: Session,
    *,
    actor_user_id: UUID,
    user_id: UUID,
    group_scope: list[str],
) -> User:
    user = get_user(db, user_id=user_id)
    _replace_group_assignments(db, user_id=user.id, group_scope=group_scope)

    append_audit_event(
        db,
        actor_user_id=actor_user_id,
        event_type="user.group_scope_updated",
        entity_type="user",
        entity_id=str(user.id),
        payload={"group_scope": sorted(set(group_scope))},
    )

    db.commit()
    db.refresh(user)
    return user


def hard_delete_user(db: Session, *, actor_user_id: UUID, user_id: UUID) -> None:
    user = get_user(db, user_id=user_id)

    append_audit_event(
        db,
        actor_user_id=actor_user_id,
        event_type="user.hard_deleted",
        entity_type="user",
        entity_id=str(user.id),
        payload={"email": user.email},
    )
    db.delete(user)
    db.commit()


def get_user_roles(db: Session, *, user_id: UUID) -> list[RoleName]:
    role_names = db.scalars(
        select(Role.name)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(UserRole.user_id == user_id)
        .order_by(Role.name.asc())
    ).all()
    return role_names


def get_user_group_scope(db: Session, *, user_id: UUID) -> list[str]:
    return db.scalars(
        select(GroupAssignment.provider_group_id)
        .where(GroupAssignment.user_id == user_id)
        .order_by(GroupAssignment.provider_group_id.asc())
    ).all()


def _replace_roles(db: Session, *, user_id: UUID, roles: list[RoleName]) -> None:
    unique_roles = sorted(set(roles), key=lambda role: role.value)
    if not unique_roles:
        unique_roles = [RoleName.VIEWER]

    db.query(UserRole).filter(UserRole.user_id == user_id).delete(synchronize_session=False)

    for role_name in unique_roles:
        role = _get_or_create_role(db, role_name=role_name)
        db.add(UserRole(user_id=user_id, role_id=role.id))


def _replace_group_assignments(db: Session, *, user_id: UUID, group_scope: list[str]) -> None:
    db.query(GroupAssignment).filter(GroupAssignment.user_id == user_id).delete(synchronize_session=False)

    for provider_group_id in sorted(set(group_scope)):
        db.add(GroupAssignment(user_id=user_id, provider_group_id=provider_group_id))


def _get_or_create_role(db: Session, *, role_name: RoleName) -> Role:
    role = db.scalar(select(Role).where(Role.name == role_name))
    if role is not None:
        return role

    role = Role(name=role_name)
    db.add(role)
    db.flush()
    return role
