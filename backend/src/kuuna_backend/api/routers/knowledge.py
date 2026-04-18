from __future__ import annotations

from collections.abc import Callable
from typing import Any, NoReturn
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from kuuna_backend.api.deps import get_db
from kuuna_backend.api.schemas.knowledge import (
    KnowledgeCommonDocCreateRequest,
    KnowledgeCommonDocResponse,
    KnowledgeGroupDocCreateRequest,
    KnowledgeGroupDocResponse,
    KnowledgeVersionCreateRequest,
    KnowledgeVersionResponse,
)
from kuuna_backend.api.schemas.read_models import (
    IngestedKnowledgeDocRead,
    KnowledgeCommonDocRead,
    KnowledgeGroupDocRead,
)
from kuuna_backend.db.models import KnowledgeCommonDoc, KnowledgeGroupDoc, KnowledgeScope
from kuuna_backend.domain.knowledge.service import (
    KnowledgeConflictError,
    KnowledgeDocNotFoundError,
    KnowledgeLifecycleError,
    KnowledgeServiceError,
    KnowledgeVersionNotFoundError,
    create_common_doc,
    create_group_doc,
    create_knowledge_version_draft,
    list_ingested_common_docs,
    list_ingested_group_docs,
    publish_knowledge_version,
    rollback_knowledge_version,
)

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


@router.get("/common-docs", response_model=list[KnowledgeCommonDocRead])
def list_common_docs(db: Session = Depends(get_db)) -> list[KnowledgeCommonDoc]:
    stmt = select(KnowledgeCommonDoc).order_by(KnowledgeCommonDoc.title.asc(), KnowledgeCommonDoc.doc_key.asc())
    return list(db.scalars(stmt))


@router.get("/ingested/common-docs", response_model=list[IngestedKnowledgeDocRead])
def list_ingested_common_docs_item(db: Session = Depends(get_db)) -> list[IngestedKnowledgeDocRead]:
    docs = list_ingested_common_docs(db)
    return [IngestedKnowledgeDocRead.model_validate(doc) for doc in docs]


@router.get("/ingested/group-docs", response_model=list[IngestedKnowledgeDocRead])
def list_ingested_group_docs_item(db: Session = Depends(get_db)) -> list[IngestedKnowledgeDocRead]:
    docs = list_ingested_group_docs(db)
    return [IngestedKnowledgeDocRead.model_validate(doc) for doc in docs]


@router.get("/ingested/group-docs/{provider_group_id}", response_model=list[IngestedKnowledgeDocRead])
def list_ingested_group_docs_by_group_item(
    provider_group_id: str,
    db: Session = Depends(get_db),
) -> list[IngestedKnowledgeDocRead]:
    docs = list_ingested_group_docs(db, provider_group_id=provider_group_id)
    return [IngestedKnowledgeDocRead.model_validate(doc) for doc in docs]


@router.post("/common-docs", response_model=KnowledgeCommonDocResponse, status_code=status.HTTP_201_CREATED)
def create_common_doc_item(
    payload: KnowledgeCommonDocCreateRequest,
    db: Session = Depends(get_db),
) -> KnowledgeCommonDocResponse:
    doc = _call_service(db, create_common_doc, doc_key=payload.doc_key, title=payload.title)
    return KnowledgeCommonDocResponse.model_validate(doc)


@router.post(
    "/common-docs/{doc_id}/versions",
    response_model=KnowledgeVersionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_common_doc_version_item(
    doc_id: UUID,
    payload: KnowledgeVersionCreateRequest,
    db: Session = Depends(get_db),
) -> KnowledgeVersionResponse:
    version = _call_service(
        db,
        create_knowledge_version_draft,
        scope=KnowledgeScope.COMMON,
        doc_ref_id=doc_id,
        content_markdown=payload.content_markdown,
    )
    return KnowledgeVersionResponse.model_validate(version)


@router.post("/common-docs/{doc_id}/versions/{version_id}/publish", response_model=KnowledgeVersionResponse)
def publish_common_doc_version_item(
    doc_id: UUID,
    version_id: UUID,
    db: Session = Depends(get_db),
) -> KnowledgeVersionResponse:
    version = _call_service(
        db,
        publish_knowledge_version,
        scope=KnowledgeScope.COMMON,
        doc_ref_id=doc_id,
        version_id=version_id,
    )
    return KnowledgeVersionResponse.model_validate(version)


@router.post("/common-docs/{doc_id}/versions/{version_id}/rollback", response_model=KnowledgeVersionResponse)
def rollback_common_doc_version_item(
    doc_id: UUID,
    version_id: UUID,
    db: Session = Depends(get_db),
) -> KnowledgeVersionResponse:
    version = _call_service(
        db,
        rollback_knowledge_version,
        scope=KnowledgeScope.COMMON,
        doc_ref_id=doc_id,
        version_id=version_id,
    )
    return KnowledgeVersionResponse.model_validate(version)


@router.get("/group-docs/{provider_group_id}", response_model=list[KnowledgeGroupDocRead])
def list_group_docs(provider_group_id: str, db: Session = Depends(get_db)) -> list[KnowledgeGroupDoc]:
    stmt = (
        select(KnowledgeGroupDoc)
        .where(KnowledgeGroupDoc.provider_group_id == provider_group_id)
        .order_by(KnowledgeGroupDoc.title.asc(), KnowledgeGroupDoc.doc_key.asc())
    )
    return list(db.scalars(stmt))


@router.post("/group-docs", response_model=KnowledgeGroupDocResponse, status_code=status.HTTP_201_CREATED)
def create_group_doc_item(
    payload: KnowledgeGroupDocCreateRequest,
    db: Session = Depends(get_db),
) -> KnowledgeGroupDocResponse:
    doc = _call_service(
        db,
        create_group_doc,
        provider_group_id=payload.provider_group_id,
        doc_key=payload.doc_key,
        title=payload.title,
    )
    return KnowledgeGroupDocResponse.model_validate(doc)


@router.post(
    "/group-docs/{doc_id}/versions",
    response_model=KnowledgeVersionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_group_doc_version_item(
    doc_id: UUID,
    payload: KnowledgeVersionCreateRequest,
    db: Session = Depends(get_db),
) -> KnowledgeVersionResponse:
    version = _call_service(
        db,
        create_knowledge_version_draft,
        scope=KnowledgeScope.GROUP,
        doc_ref_id=doc_id,
        content_markdown=payload.content_markdown,
    )
    return KnowledgeVersionResponse.model_validate(version)


@router.post("/group-docs/{doc_id}/versions/{version_id}/publish", response_model=KnowledgeVersionResponse)
def publish_group_doc_version_item(
    doc_id: UUID,
    version_id: UUID,
    db: Session = Depends(get_db),
) -> KnowledgeVersionResponse:
    version = _call_service(
        db,
        publish_knowledge_version,
        scope=KnowledgeScope.GROUP,
        doc_ref_id=doc_id,
        version_id=version_id,
    )
    return KnowledgeVersionResponse.model_validate(version)


@router.post("/group-docs/{doc_id}/versions/{version_id}/rollback", response_model=KnowledgeVersionResponse)
def rollback_group_doc_version_item(
    doc_id: UUID,
    version_id: UUID,
    db: Session = Depends(get_db),
) -> KnowledgeVersionResponse:
    version = _call_service(
        db,
        rollback_knowledge_version,
        scope=KnowledgeScope.GROUP,
        doc_ref_id=doc_id,
        version_id=version_id,
    )
    return KnowledgeVersionResponse.model_validate(version)



def _call_service(
    db: Session,
    func: Callable[..., Any],
    *args: Any,
    **kwargs: Any,
) -> Any:
    try:
        return func(db, *args, **kwargs)
    except KnowledgeServiceError as exc:
        db.rollback()
        _raise_http_error(exc)



def _raise_http_error(exc: KnowledgeServiceError) -> NoReturn:
    if isinstance(exc, KnowledgeDocNotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if isinstance(exc, KnowledgeVersionNotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if isinstance(exc, KnowledgeConflictError):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if isinstance(exc, KnowledgeLifecycleError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="knowledge operation failed") from exc
