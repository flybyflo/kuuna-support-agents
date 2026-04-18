from __future__ import annotations

from uuid import UUID

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from kuuna_backend.db.models import (
    AgentInstance,
    BindingStatus,
    GroupBinding,
    GroupTemplate,
    OutboundIntent,
    RuntimeStatus,
    TemplateVersion,
    TemplateVersionStatus,
)
from kuuna_backend.domain.bindings.service import (
    ActiveBindingConflictError,
    BindingNotFoundError,
    TemplateVersionNotFoundError,
    TemplateVersionNotPublishedError,
    create_binding,
    get_binding,
    list_bindings,
    unbind,
)


def _create_template_version(
    db: Session,
    *,
    key: str,
    status: TemplateVersionStatus,
) -> TemplateVersion:
    template = GroupTemplate(key=key, display_name=key)
    db.add(template)
    db.flush()

    version = TemplateVersion(
        template_id=template.id,
        version_no=1,
        status=status,
        system_prompt="prompt",
        model_config={"provider": "openai", "model_name": "gpt-4.1-mini"},
        tools_config={},
        egress_policy={},
    )
    db.add(version)
    db.commit()
    db.refresh(version)
    return version


def test_create_binding_requires_published_version(test_session_factory: sessionmaker[Session]) -> None:
    with test_session_factory() as db:
        draft_version = _create_template_version(db, key="draft-bind", status=TemplateVersionStatus.DRAFT)

        with pytest.raises(TemplateVersionNotPublishedError):
            create_binding(
                db,
                provider_group_id="group-a@g.us",
                template_version_id=draft_version.id,
            )


def test_create_binding_not_found_version(test_session_factory: sessionmaker[Session]) -> None:
    with test_session_factory() as db:
        with pytest.raises(TemplateVersionNotFoundError):
            create_binding(
                db,
                provider_group_id="group-a@g.us",
                template_version_id=UUID("00000000-0000-0000-0000-000000000000"),
            )


def test_create_binding_sets_active_and_agent_healthy(
    test_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with test_session_factory() as db:
        version = _create_template_version(db, key="published-bind", status=TemplateVersionStatus.PUBLISHED)

        enqueued: list[str] = []

        def _fake_enqueue(outbound_intent_id: UUID, *, provider_group_id: str) -> None:
            enqueued.append(f"{provider_group_id}:{outbound_intent_id}")

        monkeypatch.setattr(
            "kuuna_backend.domain.bindings.service._enqueue_activation_dispatch_job",
            _fake_enqueue,
        )

        view = create_binding(
            db,
            provider_group_id="group-a@g.us",
            template_version_id=version.id,
        )

        assert view.binding.status == BindingStatus.ACTIVE
        assert view.agent_instance is not None
        assert view.agent_instance.status == RuntimeStatus.HEALTHY
        assert len(enqueued) == 1

        outbound_intents = db.scalars(select(OutboundIntent)).all()
        assert len(outbound_intents) == 1
        assert outbound_intents[0].provider_group_id == "group-a@g.us"


def test_create_binding_active_conflict(
    test_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with test_session_factory() as db:
        version = _create_template_version(db, key="conflict-bind", status=TemplateVersionStatus.PUBLISHED)

        monkeypatch.setattr(
            "kuuna_backend.domain.bindings.service._enqueue_activation_dispatch_job",
            lambda *args, **kwargs: None,
        )

        create_binding(db, provider_group_id="group-a@g.us", template_version_id=version.id)

        with pytest.raises(ActiveBindingConflictError):
            create_binding(db, provider_group_id="group-a@g.us", template_version_id=version.id)


def test_unbind_sets_inactive_and_agent_stopped(
    test_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with test_session_factory() as db:
        version = _create_template_version(db, key="unbind-bind", status=TemplateVersionStatus.PUBLISHED)

        monkeypatch.setattr(
            "kuuna_backend.domain.bindings.service._enqueue_activation_dispatch_job",
            lambda *args, **kwargs: None,
        )

        created = create_binding(db, provider_group_id="group-b@g.us", template_version_id=version.id)
        result = unbind(db, binding_id=created.binding.id)

        assert result.binding.status == BindingStatus.INACTIVE
        assert result.agent_instance is not None
        assert result.agent_instance.status == RuntimeStatus.STOPPED


def test_get_and_list_bindings(test_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> None:
    with test_session_factory() as db:
        version = _create_template_version(db, key="list-bind", status=TemplateVersionStatus.PUBLISHED)

        monkeypatch.setattr(
            "kuuna_backend.domain.bindings.service._enqueue_activation_dispatch_job",
            lambda *args, **kwargs: None,
        )

        created = create_binding(db, provider_group_id="group-c@g.us", template_version_id=version.id)

        fetched = get_binding(db, created.binding.id)
        assert fetched.binding.id == created.binding.id

        listed = list_bindings(db)
        assert any(item.binding.id == created.binding.id for item in listed)

        with pytest.raises(BindingNotFoundError):
            get_binding(db, UUID("00000000-0000-0000-0000-000000000000"))

        with pytest.raises(BindingNotFoundError):
            unbind(db, binding_id=UUID("00000000-0000-0000-0000-000000000000"))

        bindings_in_db = db.scalars(select(GroupBinding)).all()
        agents_in_db = db.scalars(select(AgentInstance)).all()
        assert len(bindings_in_db) == 1
        assert len(agents_in_db) == 1
