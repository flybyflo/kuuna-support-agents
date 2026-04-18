from __future__ import annotations

import hashlib
import logging
import math
from uuid import UUID

from sqlalchemy import delete, select

from kuuna_backend.db.models import Embedding, KnowledgeVersion, TemplateVersionStatus
from kuuna_backend.integrations.openai import (
    OpenAIIntegrationError,
    create_text_embeddings,
    is_openai_configured,
)
from kuuna_backend.integrations.postgres import get_db_session

logger = logging.getLogger(__name__)

EMBEDDING_DIMENSIONS = 1536
MAX_CHUNK_CHARS = 1000


def process_knowledge_version_job(knowledge_version_id: str, trace_id: str | None = None) -> None:
    db = get_db_session()

    try:
        version_uuid = UUID(knowledge_version_id)
    except ValueError:
        logger.error(
            "knowledge_indexing_invalid_version_id",
            extra={"trace_id": trace_id, "knowledge_version_id": knowledge_version_id},
        )
        db.close()
        return

    try:
        version = db.scalar(select(KnowledgeVersion).where(KnowledgeVersion.id == version_uuid))
        if version is None:
            logger.warning(
                "knowledge_version_not_found",
                extra={"trace_id": trace_id, "knowledge_version_id": knowledge_version_id},
            )
            return

        chunks = _chunk_markdown(version.content_markdown)
        chunk_embeddings = _embed_chunks(chunks)

        db.execute(delete(Embedding).where(Embedding.source_version_id == version.id))

        for chunk_no, (chunk_content, chunk_embedding) in enumerate(
            zip(chunks, chunk_embeddings, strict=True),
            start=1,
        ):
            db.add(
                Embedding(
                    scope=version.scope,
                    source_version_id=version.id,
                    chunk_no=chunk_no,
                    content=chunk_content,
                    token_count=_token_count(chunk_content),
                    embedding=chunk_embedding,
                )
            )

        version.status = TemplateVersionStatus.READY

        db.commit()
        logger.info(
            "knowledge_version_indexed",
            extra={
                "trace_id": trace_id,
                "knowledge_version_id": knowledge_version_id,
                "chunk_count": len(chunks),
                "status": version.status.value,
            },
        )
    except Exception:
        db.rollback()
        logger.exception(
            "knowledge_version_indexing_failed",
            extra={"trace_id": trace_id, "knowledge_version_id": knowledge_version_id},
        )
        raise
    finally:
        db.close()


def _chunk_markdown(content_markdown: str, *, max_chunk_chars: int = MAX_CHUNK_CHARS) -> list[str]:
    normalized_content = content_markdown.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized_content:
        return [""]

    paragraphs = [paragraph.strip() for paragraph in normalized_content.split("\n\n") if paragraph.strip()]
    if not paragraphs:
        return [_split_text(normalized_content, max_chunk_chars)[0]]

    chunks: list[str] = []
    current_chunk = ""

    for paragraph in paragraphs:
        paragraph_parts = _split_text(paragraph, max_chunk_chars)
        for part in paragraph_parts:
            if not current_chunk:
                current_chunk = part
                continue

            candidate = f"{current_chunk}\n\n{part}"
            if len(candidate) <= max_chunk_chars:
                current_chunk = candidate
                continue

            chunks.append(current_chunk)
            current_chunk = part

    if current_chunk:
        chunks.append(current_chunk)

    return chunks or [normalized_content[:max_chunk_chars]]


def _split_text(text: str, max_chunk_chars: int) -> list[str]:
    remaining = text.strip()
    if not remaining:
        return [""]

    parts: list[str] = []
    while remaining:
        if len(remaining) <= max_chunk_chars:
            parts.append(remaining)
            break

        split_at = remaining.rfind("\n", 0, max_chunk_chars + 1)
        if split_at <= 0:
            split_at = remaining.rfind(" ", 0, max_chunk_chars + 1)
        if split_at <= 0:
            split_at = max_chunk_chars

        part = remaining[:split_at].strip()
        if part:
            parts.append(part)

        remaining = remaining[split_at:].strip()

    return parts or [text[:max_chunk_chars]]


def _token_count(content: str) -> int:
    stripped_content = content.strip()
    if not stripped_content:
        return 0
    return len(stripped_content.split())


def _embed_chunks(chunks: list[str], *, dimensions: int = EMBEDDING_DIMENSIONS) -> list[list[float]]:
    if not chunks:
        return []

    normalized_chunks = [chunk if chunk.strip() else "__empty__" for chunk in chunks]

    if not is_openai_configured():
        logger.warning(
            "knowledge_indexing_openai_not_configured_using_pseudo_embeddings",
            extra={"chunk_count": len(chunks)},
        )
        return [_pseudo_embedding(chunk, dimensions=dimensions) for chunk in normalized_chunks]

    try:
        embeddings = create_text_embeddings(normalized_chunks)
    except OpenAIIntegrationError:
        logger.exception(
            "knowledge_embedding_request_failed",
            extra={"chunk_count": len(chunks)},
        )
        raise

    if len(embeddings) != len(chunks):
        raise ValueError(
            "embedding response size mismatch "
            f"(expected={len(chunks)}, received={len(embeddings)})"
        )

    for index, embedding in enumerate(embeddings):
        if len(embedding) != dimensions:
            raise ValueError(
                "embedding dimensions mismatch "
                f"at index {index} (expected={dimensions}, received={len(embedding)})"
            )

    return embeddings


def _pseudo_embedding(content: str, *, dimensions: int = EMBEDDING_DIMENSIONS) -> list[float]:
    seed = content.strip() or "__empty__"
    vector: list[float] = []
    counter = 0

    while len(vector) < dimensions:
        digest = hashlib.sha256(f"{seed}:{counter}".encode("utf-8")).digest()
        for index in range(0, len(digest), 4):
            value = int.from_bytes(digest[index : index + 4], "big", signed=False)
            normalized = (value / 0xFFFFFFFF) * 2.0 - 1.0
            vector.append(normalized)
            if len(vector) == dimensions:
                break
        counter += 1

    magnitude = math.sqrt(sum(component * component for component in vector)) or 1.0
    return [component / magnitude for component in vector]
