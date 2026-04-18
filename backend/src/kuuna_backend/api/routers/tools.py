from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from kuuna_backend.api.deps import get_db
from kuuna_backend.api.schemas.tools import (
    ToolCatalogListResponse,
    ToolCatalogRequest,
    ToolCatalogResponse,
)
from kuuna_backend.domain.tools.service import (
    ToolCatalogValidationError,
    list_tool_catalog,
    upsert_tool_catalog_entry,
)

router = APIRouter(prefix="/tools", tags=["tools"])


@router.get("", response_model=ToolCatalogListResponse)
def list_tools(
    include_disabled: bool = Query(default=True),
    db: Session = Depends(get_db),
) -> ToolCatalogListResponse:
    tools = list_tool_catalog(db, include_disabled=include_disabled)
    return ToolCatalogListResponse(items=[ToolCatalogResponse.model_validate(tool) for tool in tools])


@router.post("", response_model=ToolCatalogResponse, status_code=status.HTTP_201_CREATED)
def upsert_tool(
    payload: ToolCatalogRequest,
    db: Session = Depends(get_db),
) -> ToolCatalogResponse:
    try:
        tool = upsert_tool_catalog_entry(
            db,
            tool_key=payload.tool_key,
            display_name=payload.display_name,
            description=payload.description,
            risk_class=payload.risk_class,
            category=payload.category,
            is_enabled=payload.is_enabled,
        )
    except ToolCatalogValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return ToolCatalogResponse.model_validate(tool)
