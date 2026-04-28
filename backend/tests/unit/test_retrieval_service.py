from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import UUID

from sqlalchemy.orm import Session, sessionmaker

from kuuna_backend.db.models import RetrievalChunk, TemplateVersionStatus
from kuuna_backend.domain.retrieval import service


def test_retrievable_statuses_are_ready_only() -> None:
    assert service.RETRIEVABLE_KNOWLEDGE_STATUSES == (TemplateVersionStatus.READY,)


def test_scope_priority_orders_group_above_common() -> None:
    assert service._scope_priority("conversation") > service._scope_priority("group")
    assert service._scope_priority("group") > service._scope_priority("common")


def test_knowledge_policy_parses_template_tool_config() -> None:
    policy = service.knowledge_policy_from_tools_config(
        {
            "knowledge": {
                "common_doc_keys": "financing, intake",
                "group_doc_keys": "none",
                "include_group_knowledge": False,
            }
        }
    )

    assert policy.common_doc_keys == frozenset({"financing", "intake"})
    assert policy.group_doc_keys == frozenset()
    assert policy.include_group_knowledge is False


def test_knowledge_retrieval_prefers_vector_when_openai_configured(monkeypatch) -> None:
    fake_bind = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))
    fake_db = SimpleNamespace(get_bind=lambda: fake_bind)
    fake_inspector = SimpleNamespace(
        get_table_names=lambda: [
            "embeddings",
            "knowledge_versions",
            "knowledge_group_docs",
            "knowledge_common_docs",
        ]
    )

    now = datetime.now(timezone.utc)

    monkeypatch.setattr(service, "inspect", lambda _: fake_inspector)
    monkeypatch.setattr(service, "is_openai_configured", lambda: True)
    monkeypatch.setattr(service, "create_text_embedding", lambda _: [0.0] * service.EMBEDDING_DIMENSIONS)
    monkeypatch.setattr(
        service,
        "_retrieve_group_knowledge_hits_vector",
        lambda *args, **kwargs: [
            service.RetrievalHit(
                source_type="knowledge",
                source_scope="group",
                score=201.0,
                content="group hit",
                occurred_at=now,
            )
        ],
    )
    monkeypatch.setattr(
        service,
        "_retrieve_common_knowledge_hits_vector",
        lambda *args, **kwargs: [
            service.RetrievalHit(
                source_type="knowledge",
                source_scope="common",
                score=101.0,
                content="common hit",
                occurred_at=now,
            )
        ],
    )

    called_fulltext = {"value": False}

    def _mark_fulltext(*_args, **_kwargs):
        called_fulltext["value"] = True
        return []

    monkeypatch.setattr(service, "_retrieve_group_knowledge_hits_fulltext", _mark_fulltext)
    monkeypatch.setattr(service, "_retrieve_common_knowledge_hits_fulltext", _mark_fulltext)

    hits = service._retrieve_knowledge_hits(
        fake_db,
        provider_group_id="group-1@g.us",
        query="refund policy",
        limit=5,
    )

    assert [hit.source_scope for hit in hits] == ["group", "common"]
    assert called_fulltext["value"] is False


def test_knowledge_retrieval_falls_back_to_fulltext_when_embedding_unavailable(monkeypatch) -> None:
    fake_bind = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))
    fake_db = SimpleNamespace(get_bind=lambda: fake_bind)
    fake_inspector = SimpleNamespace(
        get_table_names=lambda: [
            "embeddings",
            "knowledge_versions",
            "knowledge_group_docs",
            "knowledge_common_docs",
        ]
    )

    now = datetime.now(timezone.utc)

    monkeypatch.setattr(service, "inspect", lambda _: fake_inspector)
    monkeypatch.setattr(service, "is_openai_configured", lambda: True)
    monkeypatch.setattr(service, "create_text_embedding", lambda _: [0.0])

    called_vector = {"value": False}

    def _mark_vector(*_args, **_kwargs):
        called_vector["value"] = True
        return []

    monkeypatch.setattr(service, "_retrieve_group_knowledge_hits_vector", _mark_vector)
    monkeypatch.setattr(service, "_retrieve_common_knowledge_hits_vector", _mark_vector)

    monkeypatch.setattr(
        service,
        "_retrieve_group_knowledge_hits_fulltext",
        lambda *args, **kwargs: [
            service.RetrievalHit(
                source_type="knowledge",
                source_scope="group",
                score=200.5,
                content="fallback group",
                occurred_at=now,
            )
        ],
    )
    monkeypatch.setattr(
        service,
        "_retrieve_common_knowledge_hits_fulltext",
        lambda *args, **kwargs: [
            service.RetrievalHit(
                source_type="knowledge",
                source_scope="common",
                score=100.5,
                content="fallback common",
                occurred_at=now,
            )
        ],
    )

    hits = service._retrieve_knowledge_hits(
        fake_db,
        provider_group_id="group-1@g.us",
        query="refund policy",
        limit=5,
    )

    assert [hit.source_scope for hit in hits] == ["group", "common"]
    assert called_vector["value"] is False


def test_retrieval_chunks_are_scoped_to_current_group_on_sqlite(
    test_session_factory: sessionmaker[Session],
) -> None:
    with test_session_factory() as db:
        db.add(
            RetrievalChunk(
                scope="conversation",
                provider_group_id="group-a@g.us",
                source_type="message",
                source_id=UUID("00000000-0000-0000-0000-000000000001"),
                chunk_no=1,
                content="Customer asks about financing terms.",
                token_count=5,
                embedding=[0.0] * service.EMBEDDING_DIMENSIONS,
                metadata_json={"provider_message_id": "msg-a"},
            )
        )
        db.add(
            RetrievalChunk(
                scope="conversation",
                provider_group_id="group-b@g.us",
                source_type="message",
                source_id=UUID("00000000-0000-0000-0000-000000000002"),
                chunk_no=1,
                content="Customer asks about financing terms.",
                token_count=5,
                embedding=[0.0] * service.EMBEDDING_DIMENSIONS,
                metadata_json={"provider_message_id": "msg-b"},
            )
        )
        db.add(
            RetrievalChunk(
                scope="common",
                provider_group_id=None,
                source_type="knowledge_version",
                source_id=UUID("00000000-0000-0000-0000-000000000003"),
                chunk_no=1,
                content="General financing policy.",
                token_count=3,
                embedding=[0.0] * service.EMBEDDING_DIMENSIONS,
                metadata_json={},
            )
        )
        db.commit()

        hits = service._retrieve_retrieval_chunk_hits(
            db,
            provider_group_id="group-a@g.us",
            query="financing",
            limit=10,
        )

    provider_message_ids = {hit.provider_message_id for hit in hits}
    assert "msg-a" in provider_message_ids
    assert "msg-b" not in provider_message_ids
    assert all(hit.source_type != "knowledge_version" for hit in hits)
