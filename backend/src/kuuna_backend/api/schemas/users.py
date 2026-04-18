from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from typing_extensions import Annotated

from kuuna_backend.db.models import RoleName

EmailField = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=320)]
PasswordField = Annotated[str, StringConstraints(min_length=8, max_length=255)]
ProviderGroupIdField = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]


class RequestModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class UserCreateRequest(RequestModel):
    email: EmailField
    password: PasswordField
    roles: list[RoleName] = Field(default_factory=lambda: [RoleName.VIEWER])
    group_scope: list[ProviderGroupIdField] = Field(default_factory=list)
    must_change_password: bool = True
    is_active: bool = True


class UserUpdateRequest(RequestModel):
    is_active: bool | None = None
    must_change_password: bool | None = None


class UserRoleUpdateRequest(RequestModel):
    role: RoleName


class UserGroupAssignmentRequest(RequestModel):
    provider_group_id: ProviderGroupIdField


class UserResponse(BaseModel):
    id: UUID
    email: str
    is_active: bool
    must_change_password: bool
    roles: list[RoleName]
    group_scope: list[str]
    created_at: datetime
    updated_at: datetime


class UserListResponse(BaseModel):
    items: list[UserResponse]
