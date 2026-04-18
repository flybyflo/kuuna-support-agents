from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from typing_extensions import Annotated

EmailField = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=320)]
PasswordField = Annotated[str, StringConstraints(min_length=8, max_length=255)]


class RequestModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class AuthLoginRequest(RequestModel):
    email: EmailField
    password: PasswordField


class AuthChangePasswordRequest(RequestModel):
    current_password: PasswordField
    new_password: PasswordField


class AuthLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user_id: UUID
    role: str
    group_scope: list[str]
    must_change_password: bool


class AuthMeResponse(BaseModel):
    id: UUID
    email: str
    is_active: bool
    must_change_password: bool
    role: str
    group_scope: list[str]
    failed_login_attempts: int = Field(ge=0)
    locked_until: datetime | None
