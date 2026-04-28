"""add agent run, todo, retrieval chunk, and link tables

Revision ID: 0014_agent_state
Revises: 0013_runtime_runs
Create Date: 2026-04-27

"""

from collections.abc import Sequence

from alembic import op
from pgvector.sqlalchemy import Vector
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0014_agent_state"
down_revision: str | Sequence[str] | None = "0013_runtime_runs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("agent_instances", sa.Column("runtime_container_name", sa.String(length=255), nullable=True))
    op.add_column("agent_instances", sa.Column("runtime_base_url", sa.String(length=512), nullable=True))
    op.add_column("agent_instances", sa.Column("secrets_ref", sa.String(length=512), nullable=True))

    agent_run_status = postgresql.ENUM("running", "succeeded", "failed", name="agent_run_status")
    todo_status = postgresql.ENUM("open", "in_progress", "done", "cancelled", name="todo_status")
    todo_priority = postgresql.ENUM("low", "normal", "high", "urgent", name="todo_priority")
    agent_run_status.create(op.get_bind(), checkfirst=True)
    todo_status.create(op.get_bind(), checkfirst=True)
    todo_priority.create(op.get_bind(), checkfirst=True)
    agent_run_status_column = postgresql.ENUM(
        "running",
        "succeeded",
        "failed",
        name="agent_run_status",
        create_type=False,
    )
    todo_status_column = postgresql.ENUM(
        "open",
        "in_progress",
        "done",
        "cancelled",
        name="todo_status",
        create_type=False,
    )
    todo_priority_column = postgresql.ENUM(
        "low",
        "normal",
        "high",
        "urgent",
        name="todo_priority",
        create_type=False,
    )

    op.create_table(
        "message_decisions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider_group_id", sa.String(length=255), nullable=False),
        sa.Column("decision_type", sa.String(length=64), nullable=False),
        sa.Column("reason", sa.String(length=255), nullable=True),
        sa.Column("should_execute", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_message_decisions_provider_group_id_created_at",
        "message_decisions",
        ["provider_group_id", "created_at"],
    )
    op.create_index("ix_message_decisions_message_id", "message_decisions", ["message_id"])

    op.create_table(
        "agent_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("provider_group_id", sa.String(length=255), nullable=False),
        sa.Column("trace_id", sa.String(length=255), nullable=True),
        sa.Column("status", agent_run_status_column, nullable=False, server_default=sa.text("'running'")),
        sa.Column("model_path", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("model_used", sa.String(length=128), nullable=True),
        sa.Column("reasoning_effort", sa.String(length=32), nullable=False, server_default="medium"),
        sa.Column("allowed_tools", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("retrieval_refs", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("response_text", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_agent_runs_provider_group_id_started_at", "agent_runs", ["provider_group_id", "started_at"])
    op.create_index("ix_agent_runs_message_id", "agent_runs", ["message_id"])

    op.create_table(
        "tool_invocations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("agent_run_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("provider_group_id", sa.String(length=255), nullable=False),
        sa.Column("tool_name", sa.String(length=128), nullable=False),
        sa.Column("ok", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("stdout", sa.Text(), nullable=False, server_default=""),
        sa.Column("stderr", sa.Text(), nullable=False, server_default=""),
        sa.Column("timed_out", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("duration_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["agent_run_id"], ["agent_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tool_invocations_agent_run_id", "tool_invocations", ["agent_run_id"])
    op.create_index(
        "ix_tool_invocations_provider_group_id_created_at",
        "tool_invocations",
        ["provider_group_id", "created_at"],
    )

    op.create_table(
        "todos",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("provider_group_id", sa.String(length=255), nullable=False),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("agent_run_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", todo_status_column, nullable=False, server_default=sa.text("'open'")),
        sa.Column("priority", todo_priority_column, nullable=False, server_default=sa.text("'normal'")),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("exported_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("export_attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("external_ref", sa.String(length=255), nullable=True),
        sa.Column("last_export_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["agent_run_id"], ["agent_runs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_todos_provider_group_id_status_updated_at", "todos", ["provider_group_id", "status", "updated_at"])
    op.create_index("ix_todos_message_id", "todos", ["message_id"])

    op.create_table(
        "retrieval_chunks",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("scope", sa.String(length=32), nullable=False),
        sa.Column("provider_group_id", sa.String(length=255), nullable=True),
        sa.Column("source_type", sa.String(length=64), nullable=False),
        sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("chunk_no", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("token_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("embedding", Vector(1536), nullable=True),
        sa.Column("metadata_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_type", "source_id", "chunk_no", name="uq_retrieval_chunks_source_chunk"),
    )
    op.create_index("ix_retrieval_chunks_scope_provider_group_id", "retrieval_chunks", ["scope", "provider_group_id"])
    op.create_index("ix_retrieval_chunks_source_type_source_id", "retrieval_chunks", ["source_type", "source_id"])

    op.create_table(
        "message_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider_group_id", sa.String(length=255), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("normalized_url", sa.Text(), nullable=False),
        sa.Column("title", sa.String(length=512), nullable=True),
        sa.Column("metadata_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("message_id", "normalized_url", name="uq_message_links_message_id_normalized_url"),
    )
    op.create_index("ix_message_links_provider_group_id_created_at", "message_links", ["provider_group_id", "created_at"])
    _enable_group_rls()


def downgrade() -> None:
    _disable_group_rls()
    op.drop_index("ix_message_links_provider_group_id_created_at", table_name="message_links")
    op.drop_table("message_links")
    op.drop_index("ix_retrieval_chunks_source_type_source_id", table_name="retrieval_chunks")
    op.drop_index("ix_retrieval_chunks_scope_provider_group_id", table_name="retrieval_chunks")
    op.drop_table("retrieval_chunks")
    op.drop_index("ix_todos_message_id", table_name="todos")
    op.drop_index("ix_todos_provider_group_id_status_updated_at", table_name="todos")
    op.drop_table("todos")
    op.drop_index("ix_tool_invocations_provider_group_id_created_at", table_name="tool_invocations")
    op.drop_index("ix_tool_invocations_agent_run_id", table_name="tool_invocations")
    op.drop_table("tool_invocations")
    op.drop_index("ix_agent_runs_message_id", table_name="agent_runs")
    op.drop_index("ix_agent_runs_provider_group_id_started_at", table_name="agent_runs")
    op.drop_table("agent_runs")
    op.drop_index("ix_message_decisions_message_id", table_name="message_decisions")
    op.drop_index("ix_message_decisions_provider_group_id_created_at", table_name="message_decisions")
    op.drop_table("message_decisions")

    postgresql.ENUM(name="todo_priority").drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="todo_status").drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="agent_run_status").drop(op.get_bind(), checkfirst=True)
    op.drop_column("agent_instances", "secrets_ref")
    op.drop_column("agent_instances", "runtime_base_url")
    op.drop_column("agent_instances", "runtime_container_name")


def _enable_group_rls() -> None:
    group_tables = (
        "message_decisions",
        "agent_runs",
        "tool_invocations",
        "todos",
        "message_links",
    )
    for table_name in group_tables:
        op.execute(f"ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"""
            CREATE POLICY {table_name}_staff_scope ON {table_name}
            USING (
                current_setting('app.role', true) IN ('owner', 'admin')
                OR provider_group_id = ANY (
                    string_to_array(current_setting('app.group_scope', true), ',')
                )
            )
            """
        )

    op.execute("ALTER TABLE retrieval_chunks ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY retrieval_chunks_staff_scope ON retrieval_chunks
        USING (
            provider_group_id IS NULL
            OR current_setting('app.role', true) IN ('owner', 'admin')
            OR provider_group_id = ANY (
                string_to_array(current_setting('app.group_scope', true), ',')
            )
        )
        """
    )


def _disable_group_rls() -> None:
    for table_name in (
        "retrieval_chunks",
        "message_links",
        "todos",
        "tool_invocations",
        "agent_runs",
        "message_decisions",
    ):
        op.execute(f"DROP POLICY IF EXISTS {table_name}_staff_scope ON {table_name}")
        op.execute(f"ALTER TABLE {table_name} DISABLE ROW LEVEL SECURITY")
