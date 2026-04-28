from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from kuuna_backend.db.models import (
    BindingStatus,
    GroupBinding,
    GroupTemplate,
    TemplateVersion,
    TemplateVersionStatus,
)


class TemplateServiceError(Exception):
    """Base error for template lifecycle operations."""


class TemplateNotFoundError(TemplateServiceError):
    pass


class TemplateVersionNotFoundError(TemplateServiceError):
    pass


class TemplateConflictError(TemplateServiceError):
    pass


class TemplateLifecycleError(TemplateServiceError):
    pass


def list_templates(db: Session) -> list[GroupTemplate]:
    return list(
        db.scalars(
            select(GroupTemplate).order_by(GroupTemplate.display_name.asc(), GroupTemplate.created_at.asc())
        ).all()
    )


def get_template(db: Session, template_id: UUID) -> GroupTemplate:
    template = db.get(GroupTemplate, template_id)
    if template is None:
        raise TemplateNotFoundError(f"template '{template_id}' not found")
    return template


def create_template(db: Session, *, key: str, display_name: str) -> GroupTemplate:
    existing_template = db.scalar(select(GroupTemplate).where(GroupTemplate.key == key))
    if existing_template is not None:
        raise TemplateConflictError(f"template with key '{key}' already exists")

    template = GroupTemplate(key=key, display_name=display_name)
    db.add(template)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise TemplateConflictError(f"template with key '{key}' already exists") from exc

    db.refresh(template)
    return template


def list_template_versions(db: Session, template_id: UUID) -> list[TemplateVersion]:
    get_template(db, template_id)
    return list(
        db.scalars(
            select(TemplateVersion)
            .where(TemplateVersion.template_id == template_id)
            .order_by(TemplateVersion.version_no.desc())
        ).all()
    )


def create_template_version_draft(
    db: Session,
    template_id: UUID,
    *,
    system_prompt: str | None = None,
    model_config: dict[str, object] | None = None,
    tools_config: dict[str, object] | None = None,
    egress_policy: dict[str, object] | None = None,
) -> TemplateVersion:
    get_template(db, template_id)

    latest_version_no = db.scalar(
        select(func.max(TemplateVersion.version_no)).where(TemplateVersion.template_id == template_id)
    )
    next_version_no = (latest_version_no or 0) + 1

    version = TemplateVersion(
        template_id=template_id,
        version_no=next_version_no,
        status=TemplateVersionStatus.DRAFT,
        system_prompt=system_prompt,
        model_config=model_config or {},
        tools_config=tools_config or {},
        egress_policy=egress_policy or {},
    )
    db.add(version)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise TemplateConflictError(
            f"could not create draft version {next_version_no} for template '{template_id}'"
        ) from exc

    db.refresh(version)
    return version


def publish_template_version(db: Session, template_id: UUID, version_id: UUID) -> TemplateVersion:
    version = _get_template_version(db, template_id, version_id)
    if version.status == TemplateVersionStatus.ARCHIVED:
        raise TemplateLifecycleError("archived versions must be restored via rollback")

    _archive_other_published_versions(db, template_id, version.id)
    version.status = TemplateVersionStatus.PUBLISHED
    _retarget_active_bindings_to_template_version(
        db,
        template_id=template_id,
        target_version_id=version.id,
    )
    db.commit()
    db.refresh(version)
    return version


def rollback_template_version(db: Session, template_id: UUID, version_id: UUID) -> TemplateVersion:
    version = _get_template_version(db, template_id, version_id)
    if version.status not in {TemplateVersionStatus.ARCHIVED, TemplateVersionStatus.PUBLISHED}:
        raise TemplateLifecycleError("rollback target must be an archived or published version")

    _archive_other_published_versions(db, template_id, version.id)
    version.status = TemplateVersionStatus.PUBLISHED
    _retarget_active_bindings_to_template_version(
        db,
        template_id=template_id,
        target_version_id=version.id,
    )
    db.commit()
    db.refresh(version)
    return version


def _get_template_version(db: Session, template_id: UUID, version_id: UUID) -> TemplateVersion:
    version = db.scalar(
        select(TemplateVersion).where(
            TemplateVersion.id == version_id,
            TemplateVersion.template_id == template_id,
        )
    )
    if version is None:
        raise TemplateVersionNotFoundError(
            f"template version '{version_id}' not found for template '{template_id}'"
        )
    return version


def _archive_other_published_versions(db: Session, template_id: UUID, target_version_id: UUID) -> None:
    published_versions = db.scalars(
        select(TemplateVersion).where(
            TemplateVersion.template_id == template_id,
            TemplateVersion.status == TemplateVersionStatus.PUBLISHED,
            TemplateVersion.id != target_version_id,
        )
    ).all()

    for published_version in published_versions:
        published_version.status = TemplateVersionStatus.ARCHIVED


def _retarget_active_bindings_to_template_version(
    db: Session,
    *,
    template_id: UUID,
    target_version_id: UUID,
) -> None:
    bindings = db.scalars(
        select(GroupBinding)
        .join(TemplateVersion, TemplateVersion.id == GroupBinding.template_version_id)
        .where(
            TemplateVersion.template_id == template_id,
            GroupBinding.status == BindingStatus.ACTIVE,
            GroupBinding.template_version_id != target_version_id,
        )
    ).all()

    for binding in bindings:
        binding.template_version_id = target_version_id
