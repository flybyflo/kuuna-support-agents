from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from kuuna_backend.db.models import (
    KnowledgeCommonDoc,
    KnowledgeGroupDoc,
    KnowledgeScope,
    KnowledgeVersion,
    MediaAsset,
    MediaStatus,
    Message,
    MessageVersion,
    TemplateVersionStatus,
    Transcript,
)
from kuuna_backend.jobs.queue import enqueue_knowledge_indexing

logger = logging.getLogger(__name__)


_INGESTED_DOC_KEY = "ingested-chat-history"
_INGESTED_UPDATED_BY = "ingest-pipeline"


@dataclass(slots=True)
class IngestedKnowledgeDoc:
    id: str
    doc_key: str
    scope: KnowledgeScope
    provider_group_id: str | None
    title: str
    status: str
    updated_at: datetime
    updated_by: str
    chunk_count: int


@dataclass(slots=True)
class _GroupIngestStats:
    provider_group_id: str
    chunk_count: int = 0
    updated_at: datetime | None = None
    has_pending_media: bool = False
    has_failed_media: bool = False


class KnowledgeServiceError(Exception):
    """Base error for knowledge lifecycle operations."""


class KnowledgeDocNotFoundError(KnowledgeServiceError):
    pass


class KnowledgeVersionNotFoundError(KnowledgeServiceError):
    pass


class KnowledgeConflictError(KnowledgeServiceError):
    pass


class KnowledgeLifecycleError(KnowledgeServiceError):
    pass


def create_common_doc(db: Session, *, doc_key: str, title: str) -> KnowledgeCommonDoc:
    existing_doc = db.scalar(select(KnowledgeCommonDoc).where(KnowledgeCommonDoc.doc_key == doc_key))
    if existing_doc is not None:
        raise KnowledgeConflictError(f"common knowledge doc with key '{doc_key}' already exists")

    doc = KnowledgeCommonDoc(doc_key=doc_key, title=title)
    db.add(doc)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise KnowledgeConflictError(f"common knowledge doc with key '{doc_key}' already exists") from exc

    db.refresh(doc)
    return doc



def create_group_doc(
    db: Session,
    *,
    provider_group_id: str,
    doc_key: str,
    title: str,
) -> KnowledgeGroupDoc:
    existing_doc = db.scalar(
        select(KnowledgeGroupDoc).where(
            KnowledgeGroupDoc.provider_group_id == provider_group_id,
            KnowledgeGroupDoc.doc_key == doc_key,
        )
    )
    if existing_doc is not None:
        raise KnowledgeConflictError(
            f"group knowledge doc with key '{doc_key}' already exists for group '{provider_group_id}'"
        )

    doc = KnowledgeGroupDoc(provider_group_id=provider_group_id, doc_key=doc_key, title=title)
    db.add(doc)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise KnowledgeConflictError(
            f"group knowledge doc with key '{doc_key}' already exists for group '{provider_group_id}'"
        ) from exc

    db.refresh(doc)
    return doc



def create_knowledge_version_draft(
    db: Session,
    *,
    scope: KnowledgeScope,
    doc_ref_id: UUID,
    content_markdown: str,
) -> KnowledgeVersion:
    _get_doc_or_raise(db, scope=scope, doc_ref_id=doc_ref_id)

    latest_version_no = db.scalar(
        select(func.max(KnowledgeVersion.version_no)).where(
            KnowledgeVersion.scope == scope,
            KnowledgeVersion.doc_ref_id == doc_ref_id,
        )
    )
    next_version_no = (latest_version_no or 0) + 1

    version = KnowledgeVersion(
        scope=scope,
        doc_ref_id=doc_ref_id,
        version_no=next_version_no,
        status=TemplateVersionStatus.DRAFT,
        content_markdown=content_markdown,
    )
    db.add(version)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise KnowledgeConflictError(
            f"could not create draft version {next_version_no} for knowledge doc '{doc_ref_id}'"
        ) from exc

    db.refresh(version)
    return version



def publish_knowledge_version(
    db: Session,
    *,
    scope: KnowledgeScope,
    doc_ref_id: UUID,
    version_id: UUID,
) -> KnowledgeVersion:
    _get_doc_or_raise(db, scope=scope, doc_ref_id=doc_ref_id)
    version = _get_knowledge_version(db, scope=scope, doc_ref_id=doc_ref_id, version_id=version_id)
    if version.status == TemplateVersionStatus.ARCHIVED:
        raise KnowledgeLifecycleError("archived knowledge versions must be restored via rollback")

    _archive_other_published_versions(db, scope=scope, doc_ref_id=doc_ref_id, target_version_id=version.id)
    version.status = TemplateVersionStatus.PUBLISHED
    db.commit()
    db.refresh(version)

    try:
        enqueue_knowledge_indexing(str(version.id))
    except Exception:
        logger.exception(
            "knowledge_indexing_enqueue_failed",
            extra={
                "knowledge_version_id": str(version.id),
                "scope": scope.value,
                "doc_ref_id": str(doc_ref_id),
            },
        )

    return version



def rollback_knowledge_version(
    db: Session,
    *,
    scope: KnowledgeScope,
    doc_ref_id: UUID,
    version_id: UUID,
) -> KnowledgeVersion:
    _get_doc_or_raise(db, scope=scope, doc_ref_id=doc_ref_id)
    version = _get_knowledge_version(db, scope=scope, doc_ref_id=doc_ref_id, version_id=version_id)
    if version.status not in {TemplateVersionStatus.ARCHIVED, TemplateVersionStatus.PUBLISHED}:
        raise KnowledgeLifecycleError(
            "rollback target must be an archived or published knowledge version"
        )

    _archive_other_published_versions(db, scope=scope, doc_ref_id=doc_ref_id, target_version_id=version.id)
    version.status = TemplateVersionStatus.PUBLISHED
    db.commit()
    db.refresh(version)

    try:
        enqueue_knowledge_indexing(str(version.id))
    except Exception:
        logger.exception(
            "knowledge_indexing_enqueue_failed",
            extra={
                "knowledge_version_id": str(version.id),
                "scope": scope.value,
                "doc_ref_id": str(doc_ref_id),
            },
        )

    return version



def _get_doc_or_raise(db: Session, *, scope: KnowledgeScope, doc_ref_id: UUID) -> KnowledgeCommonDoc | KnowledgeGroupDoc:
    doc_model = _get_doc_model(scope)
    doc = db.get(doc_model, doc_ref_id)
    if doc is None:
        raise KnowledgeDocNotFoundError(f"knowledge doc '{doc_ref_id}' not found for scope '{scope.value}'")
    return doc



def _get_knowledge_version(
    db: Session,
    *,
    scope: KnowledgeScope,
    doc_ref_id: UUID,
    version_id: UUID,
) -> KnowledgeVersion:
    version = db.scalar(
        select(KnowledgeVersion).where(
            KnowledgeVersion.id == version_id,
            KnowledgeVersion.scope == scope,
            KnowledgeVersion.doc_ref_id == doc_ref_id,
        )
    )
    if version is None:
        raise KnowledgeVersionNotFoundError(
            f"knowledge version '{version_id}' not found for document '{doc_ref_id}'"
        )
    return version



def _archive_other_published_versions(
    db: Session,
    *,
    scope: KnowledgeScope,
    doc_ref_id: UUID,
    target_version_id: UUID,
) -> None:
    published_versions = db.scalars(
        select(KnowledgeVersion).where(
            KnowledgeVersion.scope == scope,
            KnowledgeVersion.doc_ref_id == doc_ref_id,
            KnowledgeVersion.status == TemplateVersionStatus.PUBLISHED,
            KnowledgeVersion.id != target_version_id,
        )
    ).all()

    for published_version in published_versions:
        published_version.status = TemplateVersionStatus.ARCHIVED



def list_ingested_group_docs(
    db: Session,
    *,
    provider_group_id: str | None = None,
) -> list[IngestedKnowledgeDoc]:
    stats_by_group = _collect_ingest_stats(db)

    docs: list[IngestedKnowledgeDoc] = []
    eligible_stats = [
        stats
        for stats in stats_by_group.values()
        if stats.chunk_count > 0 and stats.updated_at is not None
    ]

    for stats in sorted(eligible_stats, key=lambda item: item.updated_at, reverse=True):
        if provider_group_id is not None and stats.provider_group_id != provider_group_id:
            continue

        docs.append(
            IngestedKnowledgeDoc(
                id=stats.provider_group_id,
                doc_key=_INGESTED_DOC_KEY,
                scope=KnowledgeScope.GROUP,
                provider_group_id=stats.provider_group_id,
                title=stats.provider_group_id,
                status=_derive_ingested_status(stats),
                updated_at=stats.updated_at,
                updated_by=_INGESTED_UPDATED_BY,
                chunk_count=stats.chunk_count,
            )
        )

    return docs



def list_ingested_common_docs(db: Session) -> list[IngestedKnowledgeDoc]:
    stats_by_group = _collect_ingest_stats(db)
    populated = [stats for stats in stats_by_group.values() if stats.chunk_count > 0 and stats.updated_at is not None]
    if not populated:
        return []

    updated_at = max(item.updated_at for item in populated if item.updated_at is not None)
    has_pending_media = any(item.has_pending_media for item in populated)
    has_failed_media = any(item.has_failed_media for item in populated)

    aggregate = _GroupIngestStats(
        provider_group_id="common-ingested",
        chunk_count=sum(item.chunk_count for item in populated),
        updated_at=updated_at,
        has_pending_media=has_pending_media,
        has_failed_media=has_failed_media,
    )

    return [
        IngestedKnowledgeDoc(
            id="common-ingested",
            doc_key=_INGESTED_DOC_KEY,
            scope=KnowledgeScope.COMMON,
            provider_group_id=None,
            title="Common Knowledge (Ingested)",
            status=_derive_ingested_status(aggregate),
            updated_at=updated_at,
            updated_by=_INGESTED_UPDATED_BY,
            chunk_count=aggregate.chunk_count,
        )
    ]



def _collect_ingest_stats(db: Session) -> dict[str, _GroupIngestStats]:
    stats_by_group: dict[str, _GroupIngestStats] = {}

    latest_versions = db.execute(
        select(
            Message.provider_group_id,
            MessageVersion.occurred_at,
            MessageVersion.text_content,
        )
        .join(MessageVersion, MessageVersion.message_id == Message.id)
        .where(
            MessageVersion.version_no == Message.latest_version_no,
            MessageVersion.is_deleted.is_(False),
            MessageVersion.text_content.is_not(None),
        )
    ).all()

    for provider_group_id, occurred_at, text_content in latest_versions:
        content = (text_content or "").strip()
        if not content:
            continue

        stats = stats_by_group.setdefault(provider_group_id, _GroupIngestStats(provider_group_id=provider_group_id))
        stats.chunk_count += 1
        stats.updated_at = _max_datetime(stats.updated_at, occurred_at)

    transcript_rows = db.execute(
        select(
            Message.provider_group_id,
            func.coalesce(Transcript.updated_at, MediaAsset.updated_at, Message.updated_at),
            Transcript.text_content,
        )
        .join(MediaAsset, MediaAsset.message_id == Message.id)
        .join(Transcript, Transcript.media_asset_id == MediaAsset.id)
        .where(Transcript.text_content.is_not(None))
    ).all()

    for provider_group_id, occurred_at, text_content in transcript_rows:
        content = (text_content or "").strip()
        if not content:
            continue

        stats = stats_by_group.setdefault(provider_group_id, _GroupIngestStats(provider_group_id=provider_group_id))
        stats.chunk_count += 1
        stats.updated_at = _max_datetime(stats.updated_at, occurred_at)

    media_rows = db.execute(
        select(
            Message.provider_group_id,
            MediaAsset.status,
        ).join(MediaAsset, MediaAsset.message_id == Message.id)
    ).all()

    for provider_group_id, media_status in media_rows:
        stats = stats_by_group.setdefault(provider_group_id, _GroupIngestStats(provider_group_id=provider_group_id))
        if media_status == MediaStatus.PENDING:
            stats.has_pending_media = True
        elif media_status == MediaStatus.FAILED:
            stats.has_failed_media = True

    return stats_by_group



def _derive_ingested_status(stats: _GroupIngestStats) -> str:
    if stats.has_pending_media:
        return "processing"
    if stats.has_failed_media:
        return "failed"
    return "ready"



def _max_datetime(current: datetime | None, candidate: datetime | None) -> datetime | None:
    if candidate is None:
        return current
    if current is None or candidate > current:
        return candidate
    return current



def _get_doc_model(scope: KnowledgeScope) -> type[KnowledgeCommonDoc] | type[KnowledgeGroupDoc]:
    if scope == KnowledgeScope.COMMON:
        return KnowledgeCommonDoc
    return KnowledgeGroupDoc
