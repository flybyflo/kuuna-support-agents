from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from kuuna_backend.domain.bindings.service import BindingView
from kuuna_backend.db.models import BindingStatus, RuntimeMode, RuntimeStatus


class BindingCreateRequest(BaseModel):
    provider_group_id: str
    template_version_id: UUID


class AgentInstanceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    group_binding_id: UUID
    runtime_mode: RuntimeMode
    status: RuntimeStatus
    created_at: datetime
    updated_at: datetime


class BindingResponse(BaseModel):
    id: UUID
    provider_group_id: str
    template_version_id: UUID
    status: BindingStatus
    created_at: datetime
    updated_at: datetime
    agent_instance: AgentInstanceResponse | None = None

    @classmethod
    def from_view(cls, view: BindingView) -> "BindingResponse":
        return cls(
            id=view.binding.id,
            provider_group_id=view.binding.provider_group_id,
            template_version_id=view.binding.template_version_id,
            status=view.binding.status,
            created_at=view.binding.created_at,
            updated_at=view.binding.updated_at,
            agent_instance=(
                AgentInstanceResponse.model_validate(view.agent_instance)
                if view.agent_instance is not None
                else None
            ),
        )


class BindingListResponse(BaseModel):
    items: list[BindingResponse]
