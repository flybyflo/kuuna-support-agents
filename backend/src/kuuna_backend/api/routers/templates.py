from __future__ import annotations

from collections.abc import Callable
from typing import Any, NoReturn
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from kuuna_backend.api.deps import get_db
from kuuna_backend.api.schemas.templates import (
    TemplateCreateRequest,
    TemplateListResponse,
    TemplateResponse,
    TemplateVersionCreateRequest,
    TemplateVersionListResponse,
    TemplateVersionResponse,
)
from kuuna_backend.domain.templates.service import (
    TemplateConflictError,
    TemplateLifecycleError,
    TemplateNotFoundError,
    TemplateServiceError,
    TemplateVersionNotFoundError,
    create_template,
    create_template_version_draft,
    get_template,
    list_template_versions,
    list_templates,
    publish_template_version,
    rollback_template_version,
)

router = APIRouter(prefix="/templates", tags=["templates"])


@router.get("", response_model=TemplateListResponse)
def list_template_items(db: Session = Depends(get_db)) -> TemplateListResponse:
    templates = _call_service(db, list_templates)
    return TemplateListResponse(items=[TemplateResponse.model_validate(template) for template in templates])


@router.get("/{template_id}", response_model=TemplateResponse)
def get_template_item(template_id: UUID, db: Session = Depends(get_db)) -> TemplateResponse:
    template = _call_service(db, get_template, template_id)
    return TemplateResponse.model_validate(template)


@router.post("", response_model=TemplateResponse, status_code=status.HTTP_201_CREATED)
def create_template_item(
    payload: TemplateCreateRequest,
    db: Session = Depends(get_db),
) -> TemplateResponse:
    template = _call_service(db, create_template, key=payload.key, display_name=payload.display_name)
    return TemplateResponse.model_validate(template)


@router.get("/{template_id}/versions", response_model=TemplateVersionListResponse)
def list_template_version_items(
    template_id: UUID,
    db: Session = Depends(get_db),
) -> TemplateVersionListResponse:
    versions = _call_service(db, list_template_versions, template_id)
    return TemplateVersionListResponse(
        items=[TemplateVersionResponse.model_validate(version) for version in versions]
    )


@router.post(
    "/{template_id}/versions",
    response_model=TemplateVersionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_template_version_item(
    template_id: UUID,
    payload: TemplateVersionCreateRequest,
    db: Session = Depends(get_db),
) -> TemplateVersionResponse:
    version = _call_service(
        db,
        create_template_version_draft,
        template_id,
        system_prompt=payload.system_prompt,
        model_config=payload.model_settings,
        tools_config=payload.tools_config,
        egress_policy=payload.egress_policy,
    )
    return TemplateVersionResponse.model_validate(version)


@router.post("/{template_id}/versions/{version_id}/publish", response_model=TemplateVersionResponse)
def publish_template_version_item(
    template_id: UUID,
    version_id: UUID,
    db: Session = Depends(get_db),
) -> TemplateVersionResponse:
    version = _call_service(db, publish_template_version, template_id, version_id)
    return TemplateVersionResponse.model_validate(version)


@router.post("/{template_id}/versions/{version_id}/rollback", response_model=TemplateVersionResponse)
def rollback_template_version_item(
    template_id: UUID,
    version_id: UUID,
    db: Session = Depends(get_db),
) -> TemplateVersionResponse:
    version = _call_service(db, rollback_template_version, template_id, version_id)
    return TemplateVersionResponse.model_validate(version)


def _call_service(
    db: Session,
    func: Callable[..., Any],
    *args: Any,
    **kwargs: Any,
) -> Any:
    try:
        return func(db, *args, **kwargs)
    except TemplateServiceError as exc:
        db.rollback()
        _raise_http_error(exc)


def _raise_http_error(exc: TemplateServiceError) -> NoReturn:
    if isinstance(exc, TemplateNotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if isinstance(exc, TemplateVersionNotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if isinstance(exc, TemplateConflictError):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if isinstance(exc, TemplateLifecycleError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="template operation failed") from exc
