from __future__ import annotations

from uuid import UUID

import pytest
from sqlalchemy.orm import Session, sessionmaker

from kuuna_backend.db.models import KnowledgeScope, TemplateVersionStatus
from kuuna_backend.domain.knowledge.service import (
    KnowledgeConflictError,
    KnowledgeDocNotFoundError,
    KnowledgeLifecycleError,
    KnowledgeVersionNotFoundError,
    create_common_doc,
    create_group_doc,
    create_knowledge_version_draft,
    publish_knowledge_version,
    rollback_knowledge_version,
)


def test_create_docs_conflict(test_session_factory: sessionmaker[Session]) -> None:
    with test_session_factory() as db:
        common = create_common_doc(db, doc_key="policy", title="Policy")
        assert common.doc_key == "policy"

        with pytest.raises(KnowledgeConflictError):
            create_common_doc(db, doc_key="policy", title="Duplicate")

        group = create_group_doc(db, provider_group_id="group-1@g.us", doc_key="faq", title="FAQ")
        assert group.doc_key == "faq"

        with pytest.raises(KnowledgeConflictError):
            create_group_doc(db, provider_group_id="group-1@g.us", doc_key="faq", title="Duplicate")


def test_create_draft_increments_version(test_session_factory: sessionmaker[Session]) -> None:
    with test_session_factory() as db:
        doc = create_common_doc(db, doc_key="runbook", title="Runbook")

        v1 = create_knowledge_version_draft(
            db,
            scope=KnowledgeScope.COMMON,
            doc_ref_id=doc.id,
            content_markdown="# v1",
        )
        v2 = create_knowledge_version_draft(
            db,
            scope=KnowledgeScope.COMMON,
            doc_ref_id=doc.id,
            content_markdown="# v2",
        )

        assert v1.version_no == 1
        assert v2.version_no == 2


def test_publish_archives_previous_and_enqueues(
    test_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with test_session_factory() as db:
        doc = create_group_doc(db, provider_group_id="group-2@g.us", doc_key="kb", title="KB")

        v1 = create_knowledge_version_draft(
            db,
            scope=KnowledgeScope.GROUP,
            doc_ref_id=doc.id,
            content_markdown="# one",
        )
        v2 = create_knowledge_version_draft(
            db,
            scope=KnowledgeScope.GROUP,
            doc_ref_id=doc.id,
            content_markdown="# two",
        )

        enqueued: list[str] = []
        monkeypatch.setattr(
            "kuuna_backend.domain.knowledge.service.enqueue_knowledge_indexing",
            lambda version_id: enqueued.append(version_id),
        )

        publish_knowledge_version(db, scope=KnowledgeScope.GROUP, doc_ref_id=doc.id, version_id=v1.id)
        published_v2 = publish_knowledge_version(
            db,
            scope=KnowledgeScope.GROUP,
            doc_ref_id=doc.id,
            version_id=v2.id,
        )

        assert published_v2.status == TemplateVersionStatus.PUBLISHED
        assert len(enqueued) == 2

        rolled_back_v1 = rollback_knowledge_version(
            db,
            scope=KnowledgeScope.GROUP,
            doc_ref_id=doc.id,
            version_id=v1.id,
        )
        assert rolled_back_v1.status == TemplateVersionStatus.PUBLISHED

        # Rollback also enqueues indexing.
        assert len(enqueued) == 3


def test_lifecycle_and_not_found_errors(test_session_factory: sessionmaker[Session]) -> None:
    missing_id = UUID("00000000-0000-0000-0000-000000000000")

    with test_session_factory() as db:
        with pytest.raises(KnowledgeDocNotFoundError):
            create_knowledge_version_draft(
                db,
                scope=KnowledgeScope.COMMON,
                doc_ref_id=missing_id,
                content_markdown="# missing",
            )

        common_doc = create_common_doc(db, doc_key="errors", title="Errors")
        draft = create_knowledge_version_draft(
            db,
            scope=KnowledgeScope.COMMON,
            doc_ref_id=common_doc.id,
            content_markdown="# draft",
        )

        with pytest.raises(KnowledgeVersionNotFoundError):
            publish_knowledge_version(
                db,
                scope=KnowledgeScope.COMMON,
                doc_ref_id=common_doc.id,
                version_id=missing_id,
            )

        with pytest.raises(KnowledgeLifecycleError):
            rollback_knowledge_version(
                db,
                scope=KnowledgeScope.COMMON,
                doc_ref_id=common_doc.id,
                version_id=draft.id,
            )
