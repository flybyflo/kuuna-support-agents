from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import cast
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from kuuna_backend.db.models import (
    AgentInstance,
    BindingStatus,
    GroupBinding,
    RuntimeStatus,
    TemplateVersion,
    TemplateVersionStatus,
)
from kuuna_backend.domain.outbound.service import create_outbound_intent

logger = logging.getLogger(__name__)

_ACTIVATION_DISCLOSURE_TEXT = (
    "Hallo! Ich bin jetzt als automatisierter Support-Agent für diese Gruppe aktiviert und unterstütze bei Bedarf."
)


class BindingServiceError(Exception):
    """Base error for binding operations."""


class BindingNotFoundError(BindingServiceError):
    """Raised when a binding cannot be found."""


class TemplateVersionNotFoundError(BindingServiceError):
    """Raised when a template version cannot be found."""


class TemplateVersionNotPublishedError(BindingServiceError):
    """Raised when a template version is not published."""


class ActiveBindingConflictError(BindingServiceError):
    """Raised when an active binding already exists for a provider group."""


@dataclass(slots=True)
class BindingView:
    binding: GroupBinding
    agent_instance: AgentInstance | None


def list_bindings(db: Session) -> list[BindingView]:
    rows = db.execute(
        select(GroupBinding, AgentInstance)
        .outerjoin(AgentInstance, AgentInstance.group_binding_id == GroupBinding.id)
        .order_by(GroupBinding.created_at.desc())
    ).all()
    return [BindingView(binding=binding, agent_instance=agent_instance) for binding, agent_instance in rows]


def create_binding(
    db: Session,
    *,
    provider_group_id: str,
    template_version_id: UUID,
) -> BindingView:
    template_version = db.execute(
        select(TemplateVersion).where(TemplateVersion.id == template_version_id).limit(1)
    ).scalar_one_or_none()
    if template_version is None:
        raise TemplateVersionNotFoundError
    if template_version.status != TemplateVersionStatus.PUBLISHED:
        raise TemplateVersionNotPublishedError

    existing_active_binding_id = db.execute(
        select(GroupBinding.id)
        .where(
            GroupBinding.provider_group_id == provider_group_id,
            GroupBinding.status == BindingStatus.ACTIVE,
        )
        .limit(1)
    ).scalar_one_or_none()
    if existing_active_binding_id is not None:
        raise ActiveBindingConflictError

    binding = GroupBinding(
        provider_group_id=provider_group_id,
        template_version_id=template_version_id,
        status=BindingStatus.PROVISIONING,
    )
    db.add(binding)

    outbound_intent_id: UUID | None = None

    try:
        db.flush()

        agent_instance = _upsert_agent_instance(db, binding_id=binding.id)
        agent_instance.status = RuntimeStatus.PROVISIONING

        binding.status = BindingStatus.ACTIVE
        agent_instance.status = RuntimeStatus.HEALTHY

        activation_trace_id = uuid4()
        activation_outbound_intent_id = uuid4()
        outbound_intent = create_outbound_intent(
            db,
            provider_group_id=provider_group_id,
            outbound_intent_id=activation_outbound_intent_id,
            payload={
                "trace_id": activation_trace_id,
                "outbound_intent_id": activation_outbound_intent_id,
                "provider_group_id": provider_group_id,
                "text": _ACTIVATION_DISCLOSURE_TEXT,
                "metadata": {
                    "agent_instance_id": agent_instance.id,
                    "model_path": _build_model_path(template_version),
                },
            },
        )
        outbound_intent_id = outbound_intent.outbound_intent_id
    except IntegrityError as exc:
        db.rollback()
        if _is_active_binding_conflict(exc):
            raise ActiveBindingConflictError from exc
        raise

    if outbound_intent_id is not None:
        _enqueue_activation_dispatch_job(outbound_intent_id, provider_group_id=provider_group_id)

    return get_binding(db, binding.id)


def unbind(db: Session, *, binding_id: UUID) -> BindingView:
    binding = db.execute(select(GroupBinding).where(GroupBinding.id == binding_id).limit(1)).scalar_one_or_none()
    if binding is None:
        raise BindingNotFoundError

    agent_instance = db.execute(
        select(AgentInstance).where(AgentInstance.group_binding_id == binding.id).limit(1)
    ).scalar_one_or_none()

    binding.status = BindingStatus.INACTIVE
    if agent_instance is not None:
        agent_instance.status = RuntimeStatus.STOPPED

    db.commit()

    return get_binding(db, binding.id)


def get_binding(db: Session, binding_id: UUID) -> BindingView:
    row = db.execute(
        select(GroupBinding, AgentInstance)
        .outerjoin(AgentInstance, AgentInstance.group_binding_id == GroupBinding.id)
        .where(GroupBinding.id == binding_id)
        .limit(1)
    ).one_or_none()
    if row is None:
        raise BindingNotFoundError

    binding, agent_instance = row
    return BindingView(binding=binding, agent_instance=agent_instance)


def _upsert_agent_instance(db: Session, *, binding_id: UUID) -> AgentInstance:
    agent_instance = db.execute(
        select(AgentInstance).where(AgentInstance.group_binding_id == binding_id).limit(1)
    ).scalar_one_or_none()
    if agent_instance is not None:
        return agent_instance

    agent_instance = AgentInstance(group_binding_id=binding_id)
    db.add(agent_instance)
    db.flush()
    return agent_instance


def _build_model_path(template_version: TemplateVersion) -> list[str]:
    model_config = template_version.model_config or {}
    if not isinstance(model_config, dict):
        return []

    direct_path = model_config.get("model_path")
    if isinstance(direct_path, list):
        return [item for item in direct_path if isinstance(item, str) and item]
    if isinstance(direct_path, str) and direct_path:
        return [part for part in direct_path.split("/") if part]

    nested_model = model_config.get("model")
    if isinstance(nested_model, dict):
        nested_path = _build_model_path_from_config(cast(dict[str, object], nested_model))
        if nested_path:
            return nested_path

    return _build_model_path_from_config(model_config)


def _build_model_path_from_config(model_config: dict[str, object]) -> list[str]:
    provider = model_config.get("provider")
    model_name = model_config.get("model_name") or model_config.get("model_id")
    raw_model = model_config.get("model")
    if isinstance(raw_model, str) and raw_model:
        model_name = raw_model

    path = [part for part in (provider, model_name) if isinstance(part, str) and part]
    return path if path else []


def _enqueue_activation_dispatch_job(outbound_intent_id: UUID, *, provider_group_id: str) -> None:
    try:
        from kuuna_backend.jobs.queue import get_default_queue

        queue = get_default_queue()
        normalized_id = str(outbound_intent_id).replace("-", "_")
        queue.enqueue(
            "kuuna_backend.jobs.outbound_dispatch.process_outbound_dispatch_job",
            str(outbound_intent_id),
            job_id=f"outbound_dispatch_{normalized_id}",
        )
    except Exception:
        logger.exception(
            "binding_activation_dispatch_enqueue_failed",
            extra={
                "outbound_intent_id": str(outbound_intent_id),
                "provider_group_id": provider_group_id,
            },
        )


def _is_active_binding_conflict(exc: IntegrityError) -> bool:
    constraint_name = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
    if constraint_name == "uq_group_bindings_provider_group_id_active":
        return True

    message = str(exc.orig).lower()
    return (
        "uq_group_bindings_provider_group_id_active" in message
        or ("group_bindings" in message and "provider_group_id" in message and "unique" in message)
    )
