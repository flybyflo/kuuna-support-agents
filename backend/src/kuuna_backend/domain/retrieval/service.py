from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import func, inspect, literal, select
from sqlalchemy.engine import Row
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from kuuna_backend.db.models import (
    Embedding,
    KnowledgeCommonDoc,
    KnowledgeGroupDoc,
    KnowledgeScope,
    KnowledgeVersion,
    Message,
    MessageVersion,
    TemplateVersionStatus,
)
from kuuna_backend.integrations.openai import (
    OpenAIIntegrationError,
    create_text_embedding,
    is_openai_configured,
)

logger = logging.getLogger(__name__)

RETRIEVABLE_KNOWLEDGE_STATUSES = (TemplateVersionStatus.READY,)
EMBEDDING_DIMENSIONS = 1536


@dataclass(frozen=True, slots=True)
class RetrievalHit:
    source_type: str
    source_scope: str
    score: float
    content: str
    occurred_at: datetime
    message_id: UUID | None = None
    message_version_id: UUID | None = None
    provider_message_id: str | None = None
    knowledge_version_id: UUID | None = None
    knowledge_doc_id: UUID | None = None
    knowledge_doc_title: str | None = None
    chunk_no: int | None = None


def retrieve_context(
    db: Session,
    provider_group_id: str,
    query: str,
    limit: int = 12,
) -> list[RetrievalHit]:
    if limit <= 0:
        return []

    normalized_query = query.strip()
    recent_target = min(limit, max(1, min(4, limit // 2)))

    recent_hits = _retrieve_recent_message_hits(
        db,
        provider_group_id=provider_group_id,
        limit=recent_target,
    )

    remaining = max(limit - len(recent_hits), 0)
    knowledge_hits: list[RetrievalHit] = []
    if remaining > 0 and normalized_query:
        knowledge_hits = _retrieve_knowledge_hits(
            db,
            provider_group_id=provider_group_id,
            query=normalized_query,
            limit=remaining,
        )

    hits = [*recent_hits, *knowledge_hits]
    hits.sort(key=lambda hit: (_scope_priority(hit.source_scope), hit.score, hit.occurred_at), reverse=True)
    return hits[:limit]


def _retrieve_recent_message_hits(
    db: Session,
    *,
    provider_group_id: str,
    limit: int,
) -> list[RetrievalHit]:
    stmt = (
        select(
            Message.id.label("message_id"),
            Message.provider_message_id.label("provider_message_id"),
            MessageVersion.id.label("message_version_id"),
            MessageVersion.text_content.label("content"),
            MessageVersion.occurred_at.label("occurred_at"),
        )
        .join(
            MessageVersion,
            (MessageVersion.message_id == Message.id)
            & (MessageVersion.version_no == Message.latest_version_no),
        )
        .where(
            Message.provider_group_id == provider_group_id,
            MessageVersion.is_deleted.is_(False),
            MessageVersion.text_content.is_not(None),
        )
        .order_by(MessageVersion.occurred_at.desc(), Message.id.desc())
        .limit(limit)
    )

    rows = db.execute(stmt).all()
    hits: list[RetrievalHit] = []
    for index, row in enumerate(rows):
        content = (row.content or "").strip()
        if not content:
            continue

        hits.append(
            RetrievalHit(
                source_type="message",
                source_scope="conversation",
                score=300.0 - float(index),
                content=content,
                occurred_at=row.occurred_at,
                message_id=row.message_id,
                message_version_id=row.message_version_id,
                provider_message_id=row.provider_message_id,
            )
        )

    return hits


def _retrieve_knowledge_hits(
    db: Session,
    *,
    provider_group_id: str,
    query: str,
    limit: int,
) -> list[RetrievalHit]:
    if limit <= 0:
        return []

    bind = db.get_bind()
    if bind.dialect.name != "postgresql":
        return []

    inspector = inspect(bind)
    required_tables = {"embeddings", "knowledge_versions", "knowledge_group_docs", "knowledge_common_docs"}
    if not required_tables.issubset(set(inspector.get_table_names())):
        return []

    per_scope_limit = max(limit, 4)

    use_vector_search = is_openai_configured()
    query_embedding: list[float] | None = None

    if use_vector_search:
        try:
            query_embedding = create_text_embedding(query)
            if len(query_embedding) != EMBEDDING_DIMENSIONS:
                raise ValueError(
                    "query embedding dimensions mismatch "
                    f"(expected={EMBEDDING_DIMENSIONS}, received={len(query_embedding)})"
                )
        except (OpenAIIntegrationError, ValueError):
            logger.exception(
                "retrieval_query_embedding_failed_falling_back_to_fulltext",
                extra={"provider_group_id": provider_group_id},
            )
            use_vector_search = False

    try:
        if use_vector_search and query_embedding is not None:
            group_hits = _retrieve_group_knowledge_hits_vector(
                db,
                provider_group_id=provider_group_id,
                query_embedding=query_embedding,
                limit=per_scope_limit,
            )
            common_hits = _retrieve_common_knowledge_hits_vector(
                db,
                query_embedding=query_embedding,
                limit=per_scope_limit,
            )
        else:
            group_hits = _retrieve_group_knowledge_hits_fulltext(
                db,
                provider_group_id=provider_group_id,
                query=query,
                limit=per_scope_limit,
            )
            common_hits = _retrieve_common_knowledge_hits_fulltext(
                db,
                query=query,
                limit=per_scope_limit,
            )
    except SQLAlchemyError:
        return []

    hits = [*group_hits, *common_hits]
    hits.sort(key=lambda hit: (_scope_priority(hit.source_scope), hit.score, hit.occurred_at), reverse=True)
    return hits[:limit]


def _retrieve_group_knowledge_hits_vector(
    db: Session,
    *,
    provider_group_id: str,
    query_embedding: list[float],
    limit: int,
) -> list[RetrievalHit]:
    distance = Embedding.embedding.cosine_distance(query_embedding)
    score = literal(200.0) + (literal(1.0) - distance)

    stmt = (
        select(
            KnowledgeVersion.id.label("knowledge_version_id"),
            KnowledgeGroupDoc.id.label("knowledge_doc_id"),
            KnowledgeGroupDoc.title.label("knowledge_doc_title"),
            Embedding.chunk_no.label("chunk_no"),
            Embedding.content.label("content"),
            KnowledgeVersion.updated_at.label("occurred_at"),
            score.label("score"),
        )
        .join(KnowledgeVersion, KnowledgeVersion.id == Embedding.source_version_id)
        .join(KnowledgeGroupDoc, KnowledgeGroupDoc.id == KnowledgeVersion.doc_ref_id)
        .where(
            Embedding.scope == KnowledgeScope.GROUP,
            KnowledgeVersion.scope == KnowledgeScope.GROUP,
            KnowledgeVersion.status.in_(RETRIEVABLE_KNOWLEDGE_STATUSES),
            KnowledgeGroupDoc.provider_group_id == provider_group_id,
        )
        .order_by(distance.asc(), KnowledgeVersion.updated_at.desc(), Embedding.chunk_no.asc())
        .limit(limit)
    )

    return _build_knowledge_hits(db.execute(stmt).all(), source_scope="group")


def _retrieve_common_knowledge_hits_vector(
    db: Session,
    *,
    query_embedding: list[float],
    limit: int,
) -> list[RetrievalHit]:
    distance = Embedding.embedding.cosine_distance(query_embedding)
    score = literal(100.0) + (literal(1.0) - distance)

    stmt = (
        select(
            KnowledgeVersion.id.label("knowledge_version_id"),
            KnowledgeCommonDoc.id.label("knowledge_doc_id"),
            KnowledgeCommonDoc.title.label("knowledge_doc_title"),
            Embedding.chunk_no.label("chunk_no"),
            Embedding.content.label("content"),
            KnowledgeVersion.updated_at.label("occurred_at"),
            score.label("score"),
        )
        .join(KnowledgeVersion, KnowledgeVersion.id == Embedding.source_version_id)
        .join(KnowledgeCommonDoc, KnowledgeCommonDoc.id == KnowledgeVersion.doc_ref_id)
        .where(
            Embedding.scope == KnowledgeScope.COMMON,
            KnowledgeVersion.scope == KnowledgeScope.COMMON,
            KnowledgeVersion.status.in_(RETRIEVABLE_KNOWLEDGE_STATUSES),
        )
        .order_by(distance.asc(), KnowledgeVersion.updated_at.desc(), Embedding.chunk_no.asc())
        .limit(limit)
    )

    return _build_knowledge_hits(db.execute(stmt).all(), source_scope="common")


def _retrieve_group_knowledge_hits_fulltext(
    db: Session,
    *,
    provider_group_id: str,
    query: str,
    limit: int,
) -> list[RetrievalHit]:
    tsquery = func.plainto_tsquery("simple", query)
    content_rank = func.ts_rank_cd(func.to_tsvector("simple", Embedding.content), tsquery)
    title_rank = func.ts_rank_cd(func.to_tsvector("simple", KnowledgeGroupDoc.title), tsquery)
    rank = content_rank + (literal(0.25) * title_rank)
    score = literal(200.0) + rank

    stmt = (
        select(
            KnowledgeVersion.id.label("knowledge_version_id"),
            KnowledgeGroupDoc.id.label("knowledge_doc_id"),
            KnowledgeGroupDoc.title.label("knowledge_doc_title"),
            Embedding.chunk_no.label("chunk_no"),
            Embedding.content.label("content"),
            KnowledgeVersion.updated_at.label("occurred_at"),
            score.label("score"),
        )
        .join(KnowledgeVersion, KnowledgeVersion.id == Embedding.source_version_id)
        .join(KnowledgeGroupDoc, KnowledgeGroupDoc.id == KnowledgeVersion.doc_ref_id)
        .where(
            Embedding.scope == KnowledgeScope.GROUP,
            KnowledgeVersion.scope == KnowledgeScope.GROUP,
            KnowledgeVersion.status.in_(RETRIEVABLE_KNOWLEDGE_STATUSES),
            KnowledgeGroupDoc.provider_group_id == provider_group_id,
            rank > 0,
        )
        .order_by(score.desc(), KnowledgeVersion.updated_at.desc(), Embedding.chunk_no.asc())
        .limit(limit)
    )

    return _build_knowledge_hits(db.execute(stmt).all(), source_scope="group")


def _retrieve_common_knowledge_hits_fulltext(
    db: Session,
    *,
    query: str,
    limit: int,
) -> list[RetrievalHit]:
    tsquery = func.plainto_tsquery("simple", query)
    content_rank = func.ts_rank_cd(func.to_tsvector("simple", Embedding.content), tsquery)
    title_rank = func.ts_rank_cd(func.to_tsvector("simple", KnowledgeCommonDoc.title), tsquery)
    rank = content_rank + (literal(0.25) * title_rank)
    score = literal(100.0) + rank

    stmt = (
        select(
            KnowledgeVersion.id.label("knowledge_version_id"),
            KnowledgeCommonDoc.id.label("knowledge_doc_id"),
            KnowledgeCommonDoc.title.label("knowledge_doc_title"),
            Embedding.chunk_no.label("chunk_no"),
            Embedding.content.label("content"),
            KnowledgeVersion.updated_at.label("occurred_at"),
            score.label("score"),
        )
        .join(KnowledgeVersion, KnowledgeVersion.id == Embedding.source_version_id)
        .join(KnowledgeCommonDoc, KnowledgeCommonDoc.id == KnowledgeVersion.doc_ref_id)
        .where(
            Embedding.scope == KnowledgeScope.COMMON,
            KnowledgeVersion.scope == KnowledgeScope.COMMON,
            KnowledgeVersion.status.in_(RETRIEVABLE_KNOWLEDGE_STATUSES),
            rank > 0,
        )
        .order_by(score.desc(), KnowledgeVersion.updated_at.desc(), Embedding.chunk_no.asc())
        .limit(limit)
    )

    return _build_knowledge_hits(db.execute(stmt).all(), source_scope="common")


KnowledgeHitRow = Row[tuple[UUID, UUID, str, int, str, datetime, float]]


def _scope_priority(source_scope: str) -> int:
    if source_scope == "conversation":
        return 3
    if source_scope == "group":
        return 2
    if source_scope == "common":
        return 1
    return 0


def _build_knowledge_hits(rows: Sequence[KnowledgeHitRow], *, source_scope: str) -> list[RetrievalHit]:
    hits: list[RetrievalHit] = []
    for row in rows:
        (
            knowledge_version_id,
            knowledge_doc_id,
            knowledge_doc_title,
            chunk_no,
            content,
            occurred_at,
            score,
        ) = row
        normalized_content = content.strip()
        if not normalized_content:
            continue

        hits.append(
            RetrievalHit(
                source_type="knowledge",
                source_scope=source_scope,
                score=float(score),
                content=normalized_content,
                occurred_at=occurred_at,
                knowledge_version_id=knowledge_version_id,
                knowledge_doc_id=knowledge_doc_id,
                knowledge_doc_title=knowledge_doc_title,
                chunk_no=chunk_no,
            )
        )

    return hits
