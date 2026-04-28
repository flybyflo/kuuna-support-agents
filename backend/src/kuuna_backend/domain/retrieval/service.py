from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import String, and_, cast, func, inspect, literal, or_, select
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
    RetrievalChunk,
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


@dataclass(frozen=True, slots=True)
class KnowledgeRetrievalPolicy:
    common_doc_keys: frozenset[str] | None = None
    group_doc_keys: frozenset[str] | None = None
    include_group_knowledge: bool = True


def knowledge_policy_from_tools_config(tools_config: dict[str, object] | None) -> KnowledgeRetrievalPolicy:
    if not isinstance(tools_config, dict):
        return KnowledgeRetrievalPolicy()

    raw_policy = tools_config.get("knowledge")
    if not isinstance(raw_policy, dict):
        return KnowledgeRetrievalPolicy()

    return KnowledgeRetrievalPolicy(
        common_doc_keys=_parse_doc_key_filter(raw_policy.get("common_doc_keys")),
        group_doc_keys=_parse_doc_key_filter(raw_policy.get("group_doc_keys")),
        include_group_knowledge=bool(raw_policy.get("include_group_knowledge", True)),
    )


def _parse_doc_key_filter(value: object) -> frozenset[str] | None:
    if value is None:
        return None
    if isinstance(value, str):
        normalized = value.strip()
        if not normalized or normalized == "*":
            return None
        if normalized.lower() in {"none", "off", "false"}:
            return frozenset()
        return frozenset(item.strip() for item in normalized.split(",") if item.strip())
    if isinstance(value, list):
        keys = frozenset(str(item).strip() for item in value if str(item).strip())
        return keys if keys else frozenset()
    return None


def retrieve_context(
    db: Session,
    provider_group_id: str,
    query: str,
    limit: int = 12,
    knowledge_policy: KnowledgeRetrievalPolicy | None = None,
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
    chunk_hits: list[RetrievalHit] = []
    if remaining > 0 and normalized_query:
        chunk_hits = _retrieve_retrieval_chunk_hits(
            db,
            provider_group_id=provider_group_id,
            query=normalized_query,
            limit=remaining,
        )

    remaining = max(limit - len(recent_hits) - len(chunk_hits), 0)
    knowledge_hits: list[RetrievalHit] = []
    if remaining > 0 and normalized_query:
        knowledge_hits = _retrieve_knowledge_hits(
            db,
            provider_group_id=provider_group_id,
            query=normalized_query,
            limit=remaining,
            policy=knowledge_policy or KnowledgeRetrievalPolicy(),
        )

    hits = [*recent_hits, *chunk_hits, *knowledge_hits]
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


def _retrieve_retrieval_chunk_hits(
    db: Session,
    *,
    provider_group_id: str,
    query: str,
    limit: int,
) -> list[RetrievalHit]:
    if limit <= 0:
        return []

    bind = db.get_bind()
    inspector = inspect(bind)
    if "retrieval_chunks" not in set(inspector.get_table_names()):
        return []

    fetch_limit = max(limit * 3, 12)
    if bind.dialect.name != "postgresql":
        return _retrieve_retrieval_chunk_hits_simple(
            db,
            provider_group_id=provider_group_id,
            query=query,
            limit=fetch_limit,
        )[:limit]

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
                "retrieval_chunk_query_embedding_failed_falling_back_to_fulltext",
                extra={"provider_group_id": provider_group_id},
            )
            use_vector_search = False

    try:
        if use_vector_search and query_embedding is not None:
            hits = _retrieve_retrieval_chunk_hits_vector(
                db,
                provider_group_id=provider_group_id,
                query_embedding=query_embedding,
                limit=fetch_limit,
            )
        else:
            hits = _retrieve_retrieval_chunk_hits_fulltext(
                db,
                provider_group_id=provider_group_id,
                query=query,
                limit=fetch_limit,
            )
    except SQLAlchemyError:
        return []

    hits.sort(key=lambda hit: (_scope_priority(hit.source_scope), hit.score, hit.occurred_at), reverse=True)
    return hits[:limit]


def _retrieval_chunk_scope_filter(provider_group_id: str):
    return or_(
        and_(RetrievalChunk.scope == "common", RetrievalChunk.source_type != "knowledge_version"),
        and_(
            RetrievalChunk.provider_group_id == provider_group_id,
            RetrievalChunk.scope.in_(["group", "conversation", "customer"]),
            RetrievalChunk.source_type != "knowledge_version",
        ),
    )


def _retrieve_retrieval_chunk_hits_vector(
    db: Session,
    *,
    provider_group_id: str,
    query_embedding: list[float],
    limit: int,
) -> list[RetrievalHit]:
    distance = RetrievalChunk.embedding.cosine_distance(query_embedding)
    score = literal(1.0) - distance

    stmt = (
        select(
            RetrievalChunk.source_type.label("source_type"),
            RetrievalChunk.scope.label("scope"),
            cast(RetrievalChunk.source_id, String).label("source_id"),
            RetrievalChunk.chunk_no.label("chunk_no"),
            RetrievalChunk.content.label("content"),
            RetrievalChunk.metadata_json.label("metadata_json"),
            RetrievalChunk.updated_at.label("occurred_at"),
            score.label("score"),
        )
        .where(
            _retrieval_chunk_scope_filter(provider_group_id),
            RetrievalChunk.embedding.is_not(None),
        )
        .order_by(distance.asc(), RetrievalChunk.updated_at.desc())
        .limit(limit)
    )

    return _build_retrieval_chunk_hits(db.execute(stmt).all())


def _retrieve_retrieval_chunk_hits_fulltext(
    db: Session,
    *,
    provider_group_id: str,
    query: str,
    limit: int,
) -> list[RetrievalHit]:
    tsquery = func.plainto_tsquery("simple", query)
    rank = func.ts_rank_cd(func.to_tsvector("simple", RetrievalChunk.content), tsquery)

    stmt = (
        select(
            RetrievalChunk.source_type.label("source_type"),
            RetrievalChunk.scope.label("scope"),
            cast(RetrievalChunk.source_id, String).label("source_id"),
            RetrievalChunk.chunk_no.label("chunk_no"),
            RetrievalChunk.content.label("content"),
            RetrievalChunk.metadata_json.label("metadata_json"),
            RetrievalChunk.updated_at.label("occurred_at"),
            rank.label("score"),
        )
        .where(
            _retrieval_chunk_scope_filter(provider_group_id),
            rank > 0,
        )
        .order_by(rank.desc(), RetrievalChunk.updated_at.desc())
        .limit(limit)
    )

    return _build_retrieval_chunk_hits(db.execute(stmt).all())


def _retrieve_retrieval_chunk_hits_simple(
    db: Session,
    *,
    provider_group_id: str,
    query: str,
    limit: int,
) -> list[RetrievalHit]:
    terms = [term.casefold() for term in query.split() if term.strip()]
    if not terms:
        return []

    rows = db.execute(
        select(
            RetrievalChunk.source_type.label("source_type"),
            RetrievalChunk.scope.label("scope"),
            cast(RetrievalChunk.source_id, String).label("source_id"),
            RetrievalChunk.chunk_no.label("chunk_no"),
            RetrievalChunk.content.label("content"),
            RetrievalChunk.metadata_json.label("metadata_json"),
            RetrievalChunk.updated_at.label("occurred_at"),
        )
        .where(_retrieval_chunk_scope_filter(provider_group_id))
        .order_by(RetrievalChunk.updated_at.desc())
        .limit(max(limit * 4, 24))
    ).all()

    scored_rows: list[tuple[object, float]] = []
    for row in rows:
        content = str(row.content or "").casefold()
        score = float(sum(1 for term in terms if term in content))
        if score > 0:
            scored_rows.append((row, score))

    scored_rows.sort(key=lambda item: item[1], reverse=True)
    return _build_retrieval_chunk_hits(
        [
            (
                row.source_type,
                row.scope,
                row.source_id,
                row.chunk_no,
                row.content,
                row.metadata_json,
                row.occurred_at,
                score,
            )
            for row, score in scored_rows[:limit]
        ]
    )


def _retrieve_knowledge_hits(
    db: Session,
    *,
    provider_group_id: str,
    query: str,
    limit: int,
    policy: KnowledgeRetrievalPolicy | None = None,
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
    policy = policy or KnowledgeRetrievalPolicy()

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
                policy=policy,
            )
            common_hits = _retrieve_common_knowledge_hits_vector(
                db,
                query_embedding=query_embedding,
                limit=per_scope_limit,
                policy=policy,
            )
        else:
            group_hits = _retrieve_group_knowledge_hits_fulltext(
                db,
                provider_group_id=provider_group_id,
                query=query,
                limit=per_scope_limit,
                policy=policy,
            )
            common_hits = _retrieve_common_knowledge_hits_fulltext(
                db,
                query=query,
                limit=per_scope_limit,
                policy=policy,
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
    policy: KnowledgeRetrievalPolicy,
) -> list[RetrievalHit]:
    if not policy.include_group_knowledge:
        return []

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
            _doc_key_filter(KnowledgeGroupDoc.doc_key, policy.group_doc_keys),
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
    policy: KnowledgeRetrievalPolicy,
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
            _doc_key_filter(KnowledgeCommonDoc.doc_key, policy.common_doc_keys),
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
    policy: KnowledgeRetrievalPolicy,
) -> list[RetrievalHit]:
    if not policy.include_group_knowledge:
        return []

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
            _doc_key_filter(KnowledgeGroupDoc.doc_key, policy.group_doc_keys),
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
    policy: KnowledgeRetrievalPolicy,
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
            _doc_key_filter(KnowledgeCommonDoc.doc_key, policy.common_doc_keys),
            rank > 0,
        )
        .order_by(score.desc(), KnowledgeVersion.updated_at.desc(), Embedding.chunk_no.asc())
        .limit(limit)
    )

    return _build_knowledge_hits(db.execute(stmt).all(), source_scope="common")


RetrievalChunkHitRow = Row[tuple[str, str, UUID, int, str, dict[str, object], datetime, float]]
KnowledgeHitRow = Row[tuple[UUID, UUID, str, int, str, datetime, float]]


def _doc_key_filter(column, allowed_doc_keys: frozenset[str] | None):
    if allowed_doc_keys is None:
        return literal(True)
    if not allowed_doc_keys:
        return literal(False)
    return column.in_(sorted(allowed_doc_keys))


def _scope_priority(source_scope: str) -> int:
    if source_scope == "conversation":
        return 3
    if source_scope == "customer":
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


def _build_retrieval_chunk_hits(
    rows: Sequence[RetrievalChunkHitRow | tuple[object, ...]],
) -> list[RetrievalHit]:
    hits: list[RetrievalHit] = []
    for row in rows:
        (
            source_type,
            scope,
            source_id,
            chunk_no,
            content,
            metadata_json,
            occurred_at,
            score,
        ) = row
        normalized_content = str(content or "").strip()
        if not normalized_content:
            continue

        metadata = metadata_json if isinstance(metadata_json, dict) else {}
        source_type_text = str(source_type)
        scope_text = str(scope)
        source_uuid = source_id if isinstance(source_id, UUID) else _parse_uuid(source_id)
        message_id = _metadata_uuid(metadata, "message_id")
        message_version_id = _metadata_uuid(metadata, "message_version_id")
        provider_message_id = _metadata_str(metadata, "provider_message_id")
        knowledge_version_id: UUID | None = None

        if source_type_text == "message" and source_uuid is not None:
            message_id = source_uuid
        elif source_type_text == "knowledge_version" and source_uuid is not None:
            knowledge_version_id = source_uuid

        resolved_source_type = _resolve_retrieval_source_type(source_type_text)
        resolved_occurred_at = _metadata_datetime(metadata, "occurred_at") or occurred_at

        hits.append(
            RetrievalHit(
                source_type=resolved_source_type,
                source_scope=scope_text,
                score=float(score),
                content=normalized_content,
                occurred_at=resolved_occurred_at,
                message_id=message_id,
                message_version_id=message_version_id,
                provider_message_id=provider_message_id,
                knowledge_version_id=knowledge_version_id,
                knowledge_doc_id=_metadata_uuid(metadata, "doc_ref_id"),
                chunk_no=int(chunk_no),
            )
        )

    return hits


def _resolve_retrieval_source_type(source_type: str) -> str:
    if source_type == "knowledge_version":
        return "knowledge"
    if source_type == "message_link":
        return "url"
    if source_type == "media_asset":
        return "media"
    return source_type


def _metadata_str(metadata: dict[str, object], key: str) -> str | None:
    value = metadata.get(key)
    return value if isinstance(value, str) and value else None


def _metadata_uuid(metadata: dict[str, object], key: str) -> UUID | None:
    return _parse_uuid(metadata.get(key))


def _parse_uuid(value: object) -> UUID | None:
    if isinstance(value, UUID):
        return value
    if not isinstance(value, str):
        return None
    try:
        return UUID(value)
    except ValueError:
        return None


def _metadata_datetime(metadata: dict[str, object], key: str) -> datetime | None:
    value = metadata.get(key)
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
