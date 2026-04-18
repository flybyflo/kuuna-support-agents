from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from kuuna_backend.api.deps import get_db
from kuuna_backend.api.schemas.bindings import (
    BindingCreateRequest,
    BindingListResponse,
    BindingResponse,
)
from kuuna_backend.domain.bindings.service import (
    ActiveBindingConflictError,
    BindingNotFoundError,
    TemplateVersionNotFoundError,
    TemplateVersionNotPublishedError,
    create_binding as create_binding_service,
    list_bindings as list_bindings_service,
    unbind as unbind_service,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/bindings", tags=["bindings"])


@router.get("", response_model=BindingListResponse)
def list_bindings(db: Session = Depends(get_db)) -> BindingListResponse:
    bindings = list_bindings_service(db)
    return BindingListResponse(items=[BindingResponse.from_view(binding) for binding in bindings])


@router.post("", response_model=BindingResponse, status_code=status.HTTP_201_CREATED)
def create_binding(
    payload: BindingCreateRequest,
    db: Session = Depends(get_db),
) -> BindingResponse:
    try:
        binding = create_binding_service(
            db,
            provider_group_id=payload.provider_group_id,
            template_version_id=payload.template_version_id,
        )
    except TemplateVersionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="template version not found") from exc
    except TemplateVersionNotPublishedError as exc:
        raise HTTPException(status_code=409, detail="template version must be published") from exc
    except ActiveBindingConflictError as exc:
        raise HTTPException(status_code=409, detail="active binding already exists") from exc
    except Exception as exc:  # pragma: no cover - defensive error boundary
        db.rollback()
        logger.exception(
            "binding_create_failed",
            extra={
                "provider_group_id": payload.provider_group_id,
                "template_version_id": str(payload.template_version_id),
            },
        )
        raise HTTPException(status_code=500, detail="binding creation failed") from exc

    return BindingResponse.from_view(binding)


@router.delete("/{binding_id}", response_model=BindingResponse)
def unbind(binding_id: UUID, db: Session = Depends(get_db)) -> BindingResponse:
    try:
        binding = unbind_service(db, binding_id=binding_id)
    except BindingNotFoundError as exc:
        raise HTTPException(status_code=404, detail="binding not found") from exc
    except Exception as exc:  # pragma: no cover - defensive error boundary
        db.rollback()
        logger.exception("binding_unbind_failed", extra={"binding_id": str(binding_id)})
        raise HTTPException(status_code=500, detail="binding unbind failed") from exc

    return BindingResponse.from_view(binding)
