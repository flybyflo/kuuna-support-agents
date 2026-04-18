"""add tool catalog entries

Revision ID: 0011_tool_catalog_entries
Revises: 0010_auth_hardening
Create Date: 2026-04-18

"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0011_tool_catalog_entries"
down_revision: str | Sequence[str] | None = "0010_auth_hardening"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    tool_risk_class = postgresql.ENUM("read", "write", "admin", name="tool_risk_class")
    tool_risk_class.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "tool_catalog_entries",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tool_key", sa.String(length=128), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("risk_class", tool_risk_class, nullable=False),
        sa.Column("category", sa.String(length=64), nullable=False, server_default="runtime"),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tool_key", name="uq_tool_catalog_entries_tool_key"),
    )

    op.alter_column("tool_catalog_entries", "category", server_default=None)
    op.alter_column("tool_catalog_entries", "is_enabled", server_default=None)


def downgrade() -> None:
    op.drop_table("tool_catalog_entries")
    tool_risk_class = postgresql.ENUM("read", "write", "admin", name="tool_risk_class")
    tool_risk_class.drop(op.get_bind(), checkfirst=True)
