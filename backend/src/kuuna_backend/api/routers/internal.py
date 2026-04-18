from __future__ import annotations

import logging

from fastapi import APIRouter, Header, HTTPException, status

from kuuna_backend.api.schemas.internal import (
    MediaReconcileRequest,
    MediaReconcileResponse,
    MediaReconcileSnapshot,
)
from kuuna_backend.config.settings import get_settings
from kuuna_backend.jobs.media_processing import (
    cleanup_bogus_failed_assets,
    enqueue_failed_media_assets_for_retry,
    enqueue_pending_media_assets,
    get_media_reconcile_snapshot,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal", tags=["internal"])


def _require_internal_token(token: str | None) -> None:
    settings = get_settings()
    expected = settings.internal_ops_token

    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="internal ops token not configured",
        )

    if token != expected:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="invalid internal ops token",
        )


@router.post(
    "/media/reconcile",
    response_model=MediaReconcileResponse,
    status_code=status.HTTP_200_OK,
)
def reconcile_media_assets(
    request: MediaReconcileRequest,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> MediaReconcileResponse:
    _require_internal_token(x_internal_token)

    before = get_media_reconcile_snapshot(request.provider_group_id)

    actions = {
        "cleaned_bogus": 0,
        "enqueued_pending": 0,
        "retried_failed": 0,
    }

    if not request.dry_run:
        if request.cleanup_bogus:
            actions["cleaned_bogus"] = cleanup_bogus_failed_assets(
                limit=request.limit,
                provider_group_id=request.provider_group_id,
            )

        if request.enqueue_pending:
            actions["enqueued_pending"] = enqueue_pending_media_assets(
                limit=request.limit,
                provider_group_id=request.provider_group_id,
            )

        if request.retry_failed:
            actions["retried_failed"] = enqueue_failed_media_assets_for_retry(
                limit=request.limit,
                provider_group_id=request.provider_group_id,
            )

    after = get_media_reconcile_snapshot(request.provider_group_id)

    logger.info(
        "internal_media_reconcile",
        extra={
            "provider_group_id": request.provider_group_id,
            "dry_run": request.dry_run,
            **actions,
            "before": before,
            "after": after,
        },
    )

    message = (
        "dry-run completed"
        if request.dry_run
        else "reconcile jobs enqueued and cleanup applied"
    )

    return MediaReconcileResponse(
        provider_group_id=request.provider_group_id,
        dry_run=request.dry_run,
        before=MediaReconcileSnapshot(**before),
        after=MediaReconcileSnapshot(**after),
        actions=actions,
        message=message,
    )
