from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from kuuna_backend.db.models import TemplateVersionStatus

TemplateKey = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)]
TemplateDisplayName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=255),
]


class RequestModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class ORMResponseModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class TemplateCreateRequest(RequestModel):
    key: TemplateKey
    display_name: TemplateDisplayName


class TemplateResponse(ORMResponseModel):

    id: UUID
    key: str
    display_name: str
    created_at: datetime
    updated_at: datetime


class TemplateListResponse(BaseModel):
    items: list[TemplateResponse]


class TemplateVersionCreateRequest(RequestModel):
    system_prompt: str | None = None
    model_settings: dict[str, Any] = Field(default_factory=dict, alias="model_config")
    tools_config: dict[str, Any] = Field(default_factory=dict)
    egress_policy: dict[str, Any] = Field(default_factory=dict)


class TemplateVersionResponse(ORMResponseModel):
    id: UUID
    template_id: UUID
    version_no: int
    status: TemplateVersionStatus
    system_prompt: str | None = None
    model_settings: dict[str, Any] = Field(alias="model_config")
    tools_config: dict[str, Any]
    egress_policy: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class TemplateVersionListResponse(BaseModel):
    items: list[TemplateVersionResponse]
