"""create outbound and audit tables

Revision ID: 0006_oa
Revises: 0005_kve
Create Date: 2026-04-18

"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0006_oa"
down_revision: str | Sequence[str] | None = "0005_kve"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


outbound_status = sa.Enum("pending", "sending", "sent", "failed", name="outbound_status")


def upgrade() -> None:
    op.create_table(
        "outbound_intents",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("outbound_intent_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider_group_id", sa.String(length=255), nullable=False),
        sa.Column("status", outbound_status, nullable=False, server_default=sa.text("'pending'")),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("payload", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_outbound_intents"),
        sa.UniqueConstraint("outbound_intent_id", name="uq_outbound_intents_outbound_intent_id"),
    )
    op.create_index(
        "ix_outbound_intents_provider_group_id_created_at",
        "outbound_intents",
        ["provider_group_id", "created_at"],
    )

    op.create_table(
        "audit_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("event_type", sa.String(length=120), nullable=False),
        sa.Column("entity_type", sa.String(length=120), nullable=False),
        sa.Column("entity_id", sa.String(length=255), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], name="fk_audit_events_actor_user_id_users", ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name="pk_audit_events"),
    )


def downgrade() -> None:
    op.drop_table("audit_events")
    op.drop_index("ix_outbound_intents_provider_group_id_created_at", table_name="outbound_intents")
    op.drop_table("outbound_intents")
