from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from kuuna_backend.db.models import KnowledgeScope, TemplateVersionStatus

KnowledgeDocKey = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=255),
]
KnowledgeDocTitle = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=255),
]
ProviderGroupId = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=255),
]


class RequestModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class ORMResponseModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class KnowledgeCommonDocCreateRequest(RequestModel):
    doc_key: KnowledgeDocKey
    title: KnowledgeDocTitle


class KnowledgeGroupDocCreateRequest(RequestModel):
    provider_group_id: ProviderGroupId
    doc_key: KnowledgeDocKey
    title: KnowledgeDocTitle


class KnowledgeCommonDocResponse(ORMResponseModel):
    id: UUID
    doc_key: str
    title: str
    created_at: datetime
    updated_at: datetime


class KnowledgeGroupDocResponse(ORMResponseModel):
    id: UUID
    provider_group_id: str
    doc_key: str
    title: str
    created_at: datetime
    updated_at: datetime


class KnowledgeVersionCreateRequest(RequestModel):
    content_markdown: str = Field(min_length=1)


class KnowledgeVersionResponse(ORMResponseModel):
    id: UUID
    scope: KnowledgeScope
    doc_ref_id: UUID
    version_no: int
    status: TemplateVersionStatus
    content_markdown: str
    created_at: datetime
    updated_at: datetime
