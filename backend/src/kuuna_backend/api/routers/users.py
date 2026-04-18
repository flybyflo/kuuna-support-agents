from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from kuuna_backend.api.deps import CurrentAuthContext, get_db, require_roles
from kuuna_backend.api.schemas.users import (
    UserCreateRequest,
    UserGroupAssignmentRequest,
    UserListResponse,
    UserResponse,
    UserRoleUpdateRequest,
    UserUpdateRequest,
)
from kuuna_backend.db.models import RoleName
from kuuna_backend.domain.users import (
    PasswordPolicyError,
    UserConflictError,
    UserNotFoundError,
    create_user,
    get_user,
    get_user_group_scope,
    get_user_roles,
    hard_delete_user,
    list_users,
    set_user_group_scope,
    set_user_roles,
    update_user,
)

router = APIRouter(prefix="/users", tags=["users"])

AdminContext = Depends(require_roles(RoleName.OWNER, RoleName.ADMIN))


@router.get("", response_model=UserListResponse)
def list_user_items(
    _: CurrentAuthContext = AdminContext,
    db: Session = Depends(get_db),
) -> UserListResponse:
    users = list_users(db)
    return UserListResponse(items=[_to_response(db, user.id) for user in users])


@router.get("/{user_id}", response_model=UserResponse)
def get_user_item(
    user_id: UUID,
    _: CurrentAuthContext = AdminContext,
    db: Session = Depends(get_db),
) -> UserResponse:
    try:
        user = get_user(db, user_id=user_id)
    except UserNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return _to_response(db, user.id)


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user_item(
    payload: UserCreateRequest,
    context: CurrentAuthContext = AdminContext,
    db: Session = Depends(get_db),
) -> UserResponse:
    try:
        user = create_user(
            db,
            actor_user_id=context.user_id,
            email=payload.email,
            password=payload.password,
            roles=payload.roles,
            group_scope=payload.group_scope,
            must_change_password=payload.must_change_password,
            is_active=payload.is_active,
        )
    except PasswordPolicyError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"message": "password policy violation", "violations": exc.violations},
        ) from exc
    except UserConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return _to_response(db, user.id)


@router.patch("/{user_id}", response_model=UserResponse)
def update_user_item(
    user_id: UUID,
    payload: UserUpdateRequest,
    context: CurrentAuthContext = AdminContext,
    db: Session = Depends(get_db),
) -> UserResponse:
    try:
        user = update_user(
            db,
            actor_user_id=context.user_id,
            user_id=user_id,
            is_active=payload.is_active,
            must_change_password=payload.must_change_password,
        )
    except UserNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return _to_response(db, user.id)


@router.put("/{user_id}/roles", response_model=UserResponse)
def set_user_roles_item(
    user_id: UUID,
    payload: list[UserRoleUpdateRequest],
    context: CurrentAuthContext = AdminContext,
    db: Session = Depends(get_db),
) -> UserResponse:
    roles = [item.role for item in payload] or [RoleName.VIEWER]

    try:
        user = set_user_roles(
            db,
            actor_user_id=context.user_id,
            user_id=user_id,
            roles=roles,
        )
    except UserNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return _to_response(db, user.id)


@router.put("/{user_id}/assignments", response_model=UserResponse)
def set_user_assignments_item(
    user_id: UUID,
    payload: list[UserGroupAssignmentRequest],
    context: CurrentAuthContext = AdminContext,
    db: Session = Depends(get_db),
) -> UserResponse:
    group_scope = [item.provider_group_id for item in payload]

    try:
        user = set_user_group_scope(
            db,
            actor_user_id=context.user_id,
            user_id=user_id,
            group_scope=group_scope,
        )
    except UserNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return _to_response(db, user.id)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user_item(
    user_id: UUID,
    context: CurrentAuthContext = AdminContext,
    db: Session = Depends(get_db),
) -> None:
    if context.user_id == user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="cannot hard-delete current user")

    try:
        hard_delete_user(db, actor_user_id=context.user_id, user_id=user_id)
    except UserNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc



def _to_response(db: Session, user_id: UUID) -> UserResponse:
    user = get_user(db, user_id=user_id)
    return UserResponse(
        id=user.id,
        email=user.email,
        is_active=user.is_active,
        must_change_password=user.must_change_password,
        roles=get_user_roles(db, user_id=user.id),
        group_scope=get_user_group_scope(db, user_id=user.id),
        created_at=user.created_at,
        updated_at=user.updated_at,
    )
