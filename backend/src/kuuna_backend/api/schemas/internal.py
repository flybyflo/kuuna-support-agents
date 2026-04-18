from __future__ import annotations

from pydantic import BaseModel, Field


class MediaReconcileRequest(BaseModel):
    provider_group_id: str | None = None
    limit: int = Field(default=500, ge=1, le=10000)
    cleanup_bogus: bool = True
    enqueue_pending: bool = True
    retry_failed: bool = True
    dry_run: bool = False


class MediaReconcileSnapshot(BaseModel):
    pending: int
    failed: int
    failed_bogus: int
    ready: int


class MediaReconcileResponse(BaseModel):
    accepted: bool = True
    provider_group_id: str | None = None
    dry_run: bool
    before: MediaReconcileSnapshot
    after: MediaReconcileSnapshot
    actions: dict[str, int]
    message: str
