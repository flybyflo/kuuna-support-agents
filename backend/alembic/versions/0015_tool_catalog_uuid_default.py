"""add server default for tool catalog ids

Revision ID: 0015_tool_catalog_uuid_default
Revises: 0014_agent_state
Create Date: 2026-04-28

"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0015_tool_catalog_uuid_default"
down_revision: str | Sequence[str] | None = "0014_agent_state"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(sa.text("create extension if not exists pgcrypto"))
    op.alter_column(
        "tool_catalog_entries",
        "id",
        server_default=sa.text("gen_random_uuid()"),
        existing_type=sa.UUID(),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "tool_catalog_entries",
        "id",
        server_default=None,
        existing_type=sa.UUID(),
        existing_nullable=False,
    )
