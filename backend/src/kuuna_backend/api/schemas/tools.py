from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, StringConstraints

from kuuna_backend.db.models import ToolRiskClass


ToolKey = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)]
ToolDisplayName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=255),
]
ToolDescription = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=4000),
]
ToolCategory = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=64),
]


class ToolCatalogRequest(BaseModel):
    tool_key: ToolKey
    display_name: ToolDisplayName
    description: ToolDescription
    risk_class: ToolRiskClass
    category: ToolCategory = "runtime"
    is_enabled: bool = True


class ToolCatalogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tool_key: str
    display_name: str
    description: str
    risk_class: ToolRiskClass
    category: str
    is_enabled: bool
    created_at: datetime
    updated_at: datetime


class ToolCatalogListResponse(BaseModel):
    items: list[ToolCatalogResponse]
