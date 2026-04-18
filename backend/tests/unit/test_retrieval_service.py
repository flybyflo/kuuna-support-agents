from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

from kuuna_backend.db.models import TemplateVersionStatus
from kuuna_backend.domain.retrieval import service


def test_retrievable_statuses_are_ready_only() -> None:
    assert service.RETRIEVABLE_KNOWLEDGE_STATUSES == (TemplateVersionStatus.READY,)


def test_scope_priority_orders_group_above_common() -> None:
    assert service._scope_priority("conversation") > service._scope_priority("group")
    assert service._scope_priority("group") > service._scope_priority("common")


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
