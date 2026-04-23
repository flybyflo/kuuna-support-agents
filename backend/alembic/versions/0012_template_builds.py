"""add template builds table

Revision ID: 0012_template_builds
Revises: 0011_tool_catalog_entries
Create Date: 2026-04-23

"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0012_template_builds"
down_revision: str | Sequence[str] | None = "0011_tool_catalog_entries"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


template_build_status = sa.Enum(
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    name="template_build_status",
)


def upgrade() -> None:
    op.create_table(
        "template_builds",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("template_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("template_version_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", template_build_status, nullable=False, server_default=sa.text("'queued'")),
        sa.Column("image_ref", sa.String(length=512), nullable=True),
        sa.Column("image_tag", sa.String(length=255), nullable=True),
        sa.Column("build_inputs", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("logs_ref", sa.String(length=1024), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(
            ["template_id"], ["group_templates.id"], name="fk_template_builds_template_id_group_templates", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["template_version_id"],
            ["template_versions.id"],
            name="fk_template_builds_template_version_id_template_versions",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_template_builds"),
    )

    op.create_index(
        "ix_template_builds_template_version_id_created_at",
        "template_builds",
        ["template_version_id", "created_at"],
    )
    op.create_index(
        "ix_template_builds_latest_succeeded",
        "template_builds",
        ["template_version_id", "created_at"],
        postgresql_where=sa.text("status = 'succeeded'"),
    )

    op.alter_column("template_builds", "status", server_default=None)
    op.alter_column("template_builds", "build_inputs", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_template_builds_latest_succeeded", table_name="template_builds")
    op.drop_index("ix_template_builds_template_version_id_created_at", table_name="template_builds")
    op.drop_table("template_builds")
    template_build_status.drop(op.get_bind(), checkfirst=True)

