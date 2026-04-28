from __future__ import annotations

from datetime import datetime
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
    TemplateBuild,
    TemplateBuildStatus,
    TemplateVersion,
    TemplateVersionStatus,
)
from kuuna_backend.domain.bindings.service import (
    ActiveBindingConflictError,
    BindingNotFoundError,
    RuntimeProvisioningFailedError,
    TemplateVersionNotFoundError,
    TemplateVersionNotPublishedError,
    create_binding,
    get_binding,
    list_bindings,
    unbind,
    _latest_successful_template_runtime_image,
    _safe_container_suffix,
)
from kuuna_backend.domain.runtime.provisioning import (
    RuntimeProvisioningError,
    RuntimeProvisioningResult,
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
        model_config={"provider": "openai", "model_name": "gpt-5.5", "reasoning_effort": "medium"},
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
        expected_suffix = _safe_container_suffix("group-a@g.us")
        assert view.agent_instance.runtime_container_name == f"kuuna-runtime-{expected_suffix}"
        assert view.agent_instance.secrets_ref == f"runtime/{expected_suffix}"
        assert len(enqueued) == 1

        outbound_intents = db.scalars(select(OutboundIntent)).all()
        assert len(outbound_intents) == 1
        assert outbound_intents[0].provider_group_id == "group-a@g.us"


def test_create_binding_provisions_runtime_container_when_enabled(
    test_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with test_session_factory() as db:
        version = _create_template_version(db, key="provision-bind", status=TemplateVersionStatus.PUBLISHED)

        monkeypatch.setattr(
            "kuuna_backend.domain.bindings.service._enqueue_activation_dispatch_job",
            lambda *args, **kwargs: None,
        )
        monkeypatch.setattr(
            "kuuna_backend.domain.bindings.service.runtime_provisioning_enabled",
            lambda: True,
        )

        provisioned: list[str] = []

        def _fake_provision(
            agent_instance: AgentInstance,
            *,
            provider_group_id: str,
            image: str | None = None,
        ) -> RuntimeProvisioningResult:
            provisioned.append(f"{provider_group_id}:{agent_instance.runtime_container_name}")
            return RuntimeProvisioningResult(
                container_id="container-1",
                container_name=agent_instance.runtime_container_name or "",
                runtime_base_url=f"http://{agent_instance.runtime_container_name}:8100",
                docker_network="kuuna-dev_default",
            )

        monkeypatch.setattr(
            "kuuna_backend.domain.bindings.service.provision_runtime_container",
            _fake_provision,
        )

        view = create_binding(
            db,
            provider_group_id="group-a@g.us",
            template_version_id=version.id,
        )

        assert view.binding.status == BindingStatus.ACTIVE
        assert view.agent_instance is not None
        assert view.agent_instance.status == RuntimeStatus.HEALTHY
        expected_suffix = _safe_container_suffix("group-a@g.us")
        assert view.agent_instance.runtime_base_url == f"http://kuuna-runtime-{expected_suffix}:8100"
        assert provisioned == [f"group-a@g.us:kuuna-runtime-{expected_suffix}"]


def test_create_binding_uses_latest_successful_template_runtime_image(
    test_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with test_session_factory() as db:
        version = _create_template_version(db, key="provision-image", status=TemplateVersionStatus.PUBLISHED)
        db.add_all(
            [
                TemplateBuild(
                    template_id=version.template_id,
                    template_version_id=version.id,
                    status=TemplateBuildStatus.FAILED,
                    image_ref="kuuna/template-provision-image:failed",
                    build_inputs={"base_image": "node:22-bookworm"},
                    created_at=datetime(2026, 1, 1, 12, 0, 0),
                ),
                TemplateBuild(
                    template_id=version.template_id,
                    template_version_id=version.id,
                    status=TemplateBuildStatus.SUCCEEDED,
                    image_ref="kuuna/template-provision-image:old",
                    build_inputs={"base_image": "node:22-bookworm"},
                    created_at=datetime(2026, 1, 1, 12, 1, 0),
                ),
                TemplateBuild(
                    template_id=version.template_id,
                    template_version_id=version.id,
                    status=TemplateBuildStatus.SUCCEEDED,
                    image_ref="kuuna/template-provision-image:new",
                    build_inputs={"base_image": "node:22-bookworm"},
                    created_at=datetime(2026, 1, 1, 12, 2, 0),
                ),
            ]
        )
        db.commit()

        selected_image = _latest_successful_template_runtime_image(db, version.id)
        assert selected_image == "kuuna/template-provision-image:new"

        monkeypatch.setattr(
            "kuuna_backend.domain.bindings.service._enqueue_activation_dispatch_job",
            lambda *args, **kwargs: None,
        )
        monkeypatch.setattr(
            "kuuna_backend.domain.bindings.service.runtime_provisioning_enabled",
            lambda: True,
        )

        images: list[str | None] = []

        def _fake_provision(
            agent_instance: AgentInstance,
            *,
            provider_group_id: str,
            image: str | None = None,
        ) -> RuntimeProvisioningResult:
            images.append(image)
            return RuntimeProvisioningResult(
                container_id="container-1",
                container_name=agent_instance.runtime_container_name or "",
                runtime_base_url=f"http://{agent_instance.runtime_container_name}:8100",
                docker_network="kuuna-dev_default",
            )

        monkeypatch.setattr(
            "kuuna_backend.domain.bindings.service.provision_runtime_container",
            _fake_provision,
        )

        create_binding(
            db,
            provider_group_id="group-image@g.us",
            template_version_id=version.id,
        )

        assert images == [selected_image]


def test_create_binding_marks_failed_when_runtime_provisioning_fails(
    test_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with test_session_factory() as db:
        version = _create_template_version(db, key="provision-failed", status=TemplateVersionStatus.PUBLISHED)

        monkeypatch.setattr(
            "kuuna_backend.domain.bindings.service.runtime_provisioning_enabled",
            lambda: True,
        )
        monkeypatch.setattr(
            "kuuna_backend.domain.bindings.service.provision_runtime_container",
            lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeProvisioningError("boom")),
        )

        with pytest.raises(RuntimeProvisioningFailedError):
            create_binding(
                db,
                provider_group_id="group-failed@g.us",
                template_version_id=version.id,
            )

        binding = db.scalar(select(GroupBinding).where(GroupBinding.provider_group_id == "group-failed@g.us"))
        assert binding is not None
        agent_instance = db.scalar(
            select(AgentInstance).where(AgentInstance.group_binding_id == binding.id)
        )
        assert binding.status == BindingStatus.FAILED
        assert agent_instance is not None
        assert agent_instance.status == RuntimeStatus.DEGRADED
        assert db.scalars(select(OutboundIntent)).all() == []


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

        monkeypatch.setattr(
            "kuuna_backend.domain.bindings.service.runtime_provisioning_enabled",
            lambda: True,
        )
        stopped: list[str] = []

        def _fake_stop(agent_instance: AgentInstance) -> bool:
            stopped.append(agent_instance.runtime_container_name or "")
            return True

        monkeypatch.setattr(
            "kuuna_backend.domain.bindings.service.stop_runtime_container",
            _fake_stop,
        )

        result = unbind(db, binding_id=created.binding.id)

        assert result.binding.status == BindingStatus.INACTIVE
        assert result.agent_instance is not None
        assert result.agent_instance.status == RuntimeStatus.STOPPED
        assert stopped == [f"kuuna-runtime-{_safe_container_suffix('group-b@g.us')}"]


def test_create_binding_container_names_are_collision_resistant(
    test_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with test_session_factory() as db:
        version = _create_template_version(
            db,
            key="collision-proof-bind",
            status=TemplateVersionStatus.PUBLISHED,
        )

        monkeypatch.setattr(
            "kuuna_backend.domain.bindings.service._enqueue_activation_dispatch_job",
            lambda *args, **kwargs: None,
        )

        shared_prefix = "customer-" + ("a" * 120)
        first = create_binding(
            db,
            provider_group_id=f"{shared_prefix}-one@g.us",
            template_version_id=version.id,
        )
        second = create_binding(
            db,
            provider_group_id=f"{shared_prefix}-two@g.us",
            template_version_id=version.id,
        )

        assert first.agent_instance is not None
        assert second.agent_instance is not None
        assert first.agent_instance.runtime_container_name != second.agent_instance.runtime_container_name
        assert first.agent_instance.secrets_ref != second.agent_instance.secrets_ref


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
