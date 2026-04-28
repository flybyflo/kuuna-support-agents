from __future__ import annotations

from uuid import UUID

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from kuuna_backend.db.models import BindingStatus, GroupBinding
from kuuna_backend.domain.templates.service import (
    TemplateConflictError,
    TemplateLifecycleError,
    TemplateNotFoundError,
    TemplateVersionNotFoundError,
    create_template,
    create_template_version_draft,
    get_template,
    list_template_versions,
    publish_template_version,
    rollback_template_version,
)


def test_create_template_conflict(test_session_factory: sessionmaker[Session]) -> None:
    with test_session_factory() as db:
        created = create_template(db, key="support", display_name="Support")
        assert created.key == "support"

    with test_session_factory() as db:
        with pytest.raises(TemplateConflictError):
            create_template(db, key="support", display_name="Duplicate")


def test_template_version_draft_increments(test_session_factory: sessionmaker[Session]) -> None:
    with test_session_factory() as db:
        template = create_template(db, key="ops", display_name="Ops")
        v1 = create_template_version_draft(db, template.id, system_prompt="v1")
        v2 = create_template_version_draft(db, template.id, system_prompt="v2")

        assert v1.version_no == 1
        assert v2.version_no == 2


def test_publish_archives_previous_published(test_session_factory: sessionmaker[Session]) -> None:
    with test_session_factory() as db:
        template = create_template(db, key="pub", display_name="Publish")
        v1 = create_template_version_draft(db, template.id)
        v2 = create_template_version_draft(db, template.id)

        publish_template_version(db, template.id, v1.id)
        publish_template_version(db, template.id, v2.id)

        versions = list_template_versions(db, template.id)
        by_no = {version.version_no: version for version in versions}
        assert by_no[2].status.value == "published"
        assert by_no[1].status.value == "archived"


def test_publish_retargets_active_bindings_for_template(
    test_session_factory: sessionmaker[Session],
) -> None:
    with test_session_factory() as db:
        template = create_template(db, key="pub-bindings", display_name="Publish Bindings")
        v1 = create_template_version_draft(db, template.id)
        v2 = create_template_version_draft(db, template.id)
        publish_template_version(db, template.id, v1.id)

        other_template = create_template(db, key="other-bindings", display_name="Other Bindings")
        other_version = create_template_version_draft(db, other_template.id)
        publish_template_version(db, other_template.id, other_version.id)

        active_binding = GroupBinding(
            provider_group_id="active@g.us",
            template_version_id=v1.id,
            status=BindingStatus.ACTIVE,
        )
        inactive_binding = GroupBinding(
            provider_group_id="inactive@g.us",
            template_version_id=v1.id,
            status=BindingStatus.INACTIVE,
        )
        other_binding = GroupBinding(
            provider_group_id="other@g.us",
            template_version_id=other_version.id,
            status=BindingStatus.ACTIVE,
        )
        db.add_all([active_binding, inactive_binding, other_binding])
        db.commit()

        publish_template_version(db, template.id, v2.id)

        bindings = {
            binding.provider_group_id: binding
            for binding in db.scalars(select(GroupBinding)).all()
        }
        assert bindings["active@g.us"].template_version_id == v2.id
        assert bindings["inactive@g.us"].template_version_id == v1.id
        assert bindings["other@g.us"].template_version_id == other_version.id


def test_rollback_retargets_active_bindings_for_template(
    test_session_factory: sessionmaker[Session],
) -> None:
    with test_session_factory() as db:
        template = create_template(db, key="rb-bindings", display_name="Rollback Bindings")
        v1 = create_template_version_draft(db, template.id)
        v2 = create_template_version_draft(db, template.id)
        publish_template_version(db, template.id, v1.id)
        publish_template_version(db, template.id, v2.id)

        binding = GroupBinding(
            provider_group_id="rollback@g.us",
            template_version_id=v2.id,
            status=BindingStatus.ACTIVE,
        )
        db.add(binding)
        db.commit()

        rollback_template_version(db, template.id, v1.id)

        refreshed = db.scalar(select(GroupBinding).where(GroupBinding.provider_group_id == "rollback@g.us"))
        assert refreshed is not None
        assert refreshed.template_version_id == v1.id


def test_rollback_rules(test_session_factory: sessionmaker[Session]) -> None:
    with test_session_factory() as db:
        template = create_template(db, key="rb", display_name="Rollback")
        draft_only = create_template_version_draft(db, template.id)

        with pytest.raises(TemplateLifecycleError):
            rollback_template_version(db, template.id, draft_only.id)

        v1 = publish_template_version(db, template.id, draft_only.id)
        v2 = create_template_version_draft(db, template.id)
        publish_template_version(db, template.id, v2.id)

        rolled = rollback_template_version(db, template.id, v1.id)
        assert rolled.status.value == "published"

        versions = list_template_versions(db, template.id)
        by_no = {version.version_no: version for version in versions}
        assert by_no[1].status.value == "published"
        assert by_no[2].status.value == "archived"


def test_template_not_found_errors(test_session_factory: sessionmaker[Session]) -> None:
    missing_id = UUID("00000000-0000-0000-0000-000000000000")

    with test_session_factory() as db:
        with pytest.raises(TemplateNotFoundError):
            get_template(db, template_id=missing_id)

        template = create_template(db, key="nf", display_name="Not Found")
        version = create_template_version_draft(db, template.id)

        with pytest.raises(TemplateVersionNotFoundError):
            publish_template_version(db, template_id=template.id, version_id=missing_id)

        fetched_versions = list_template_versions(db, template.id)
        assert [v.id for v in fetched_versions] == [version.id]
