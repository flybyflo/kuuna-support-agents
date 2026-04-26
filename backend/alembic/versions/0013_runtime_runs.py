"""add runtime runs table

Revision ID: 0013_runtime_runs
Revises: 0012_template_builds
Create Date: 2026-04-26

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0013_runtime_runs"
down_revision: str | Sequence[str] | None = "0012_template_builds"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


runtime_run_status = sa.Enum(
    "started",
    "succeeded",
    "failed",
    "timeout",
    name="runtime_run_status",
)


def upgrade() -> None:
    op.create_table(
        "runtime_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("provider_group_id", sa.String(length=255), nullable=False),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("binding_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("template_version_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("template_build_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("image_ref", sa.String(length=512), nullable=False),
        sa.Column("status", runtime_run_status, nullable=False, server_default=sa.text("'started'")),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("error", sa.String(length=1024), nullable=True),
        sa.Column("execution", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(
            ["message_id"],
            ["messages.id"],
            name="fk_runtime_runs_message_id_messages",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["binding_id"],
            ["group_bindings.id"],
            name="fk_runtime_runs_binding_id_group_bindings",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["template_version_id"],
            ["template_versions.id"],
            name="fk_runtime_runs_template_version_id_template_versions",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["template_build_id"],
            ["template_builds.id"],
            name="fk_runtime_runs_template_build_id_template_builds",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_runtime_runs"),
    )

    op.create_index(
        "ix_runtime_runs_provider_group_id_started_at",
        "runtime_runs",
        ["provider_group_id", "started_at"],
    )
    op.create_index(
        "ix_runtime_runs_message_id_started_at",
        "runtime_runs",
        ["message_id", "started_at"],
    )
    op.create_index(
        "ix_runtime_runs_binding_id_started_at",
        "runtime_runs",
        ["binding_id", "started_at"],
    )
    op.create_index(
        "ix_runtime_runs_template_version_id_started_at",
        "runtime_runs",
        ["template_version_id", "started_at"],
    )

    op.alter_column("runtime_runs", "status", server_default=None)
    op.alter_column("runtime_runs", "execution", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_runtime_runs_template_version_id_started_at", table_name="runtime_runs")
    op.drop_index("ix_runtime_runs_binding_id_started_at", table_name="runtime_runs")
    op.drop_index("ix_runtime_runs_message_id_started_at", table_name="runtime_runs")
    op.drop_index("ix_runtime_runs_provider_group_id_started_at", table_name="runtime_runs")
    op.drop_table("runtime_runs")
    runtime_run_status.drop(op.get_bind(), checkfirst=True)

