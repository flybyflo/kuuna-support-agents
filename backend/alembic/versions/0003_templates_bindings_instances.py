"""create template binding and instance tables

Revision ID: 0003_templates_bindings_instances
Revises: 0002_auth_rbac
Create Date: 2026-04-18

"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0003_templates_bindings_instances"
down_revision: str | Sequence[str] | None = "0002_auth_rbac"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


template_version_status = sa.Enum("draft", "ready", "published", "archived", name="template_version_status")
binding_status = sa.Enum("draft", "provisioning", "active", "inactive", "failed", name="binding_status")
runtime_mode = sa.Enum("on_demand", "hot", name="runtime_mode")
runtime_status = sa.Enum("provisioning", "healthy", "degraded", "stopped", name="runtime_status")


def upgrade() -> None:
    template_version_status.create(op.get_bind(), checkfirst=True)
    binding_status.create(op.get_bind(), checkfirst=True)
    runtime_mode.create(op.get_bind(), checkfirst=True)
    runtime_status.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "group_templates",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_group_templates"),
        sa.UniqueConstraint("key", name="uq_group_templates_key"),
    )

    op.create_table(
        "template_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("template_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("status", template_version_status, nullable=False, server_default=sa.text("'draft'")),
        sa.Column("system_prompt", sa.Text(), nullable=True),
        sa.Column("model_config", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("tools_config", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("egress_policy", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(
            ["template_id"], ["group_templates.id"], name="fk_template_versions_template_id_group_templates", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_template_versions"),
        sa.UniqueConstraint("template_id", "version_no", name="uq_template_versions_template_id_version_no"),
    )

    op.create_table(
        "group_bindings",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("provider_group_id", sa.String(length=255), nullable=False),
        sa.Column("template_version_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", binding_status, nullable=False, server_default=sa.text("'draft'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(
            ["template_version_id"], ["template_versions.id"], name="fk_group_bindings_template_version_id_template_versions", ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_group_bindings"),
    )
    op.create_index(
        "uq_group_bindings_provider_group_id_active",
        "group_bindings",
        ["provider_group_id"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
    )

    op.create_table(
        "agent_instances",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("group_binding_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("runtime_mode", runtime_mode, nullable=False, server_default=sa.text("'on_demand'")),
        sa.Column("status", runtime_status, nullable=False, server_default=sa.text("'provisioning'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(
            ["group_binding_id"], ["group_bindings.id"], name="fk_agent_instances_group_binding_id_group_bindings", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_agent_instances"),
        sa.UniqueConstraint("group_binding_id", name="uq_agent_instances_group_binding_id"),
    )


def downgrade() -> None:
    op.drop_table("agent_instances")
    op.drop_index("uq_group_bindings_provider_group_id_active", table_name="group_bindings")
    op.drop_table("group_bindings")
    op.drop_table("template_versions")
    op.drop_table("group_templates")

    runtime_status.drop(op.get_bind(), checkfirst=True)
    runtime_mode.drop(op.get_bind(), checkfirst=True)
    binding_status.drop(op.get_bind(), checkfirst=True)
    template_version_status.drop(op.get_bind(), checkfirst=True)
