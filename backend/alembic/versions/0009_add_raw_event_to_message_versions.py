"""add raw event json column to message_versions

Revision ID: 0009_add_raw_event_to_message_versions
Revises: 0008_rls_baseline
Create Date: 2026-04-18

"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0009_add_raw_event_to_message_versions"
down_revision: str | Sequence[str] | None = "0008_rls_baseline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "message_versions",
        sa.Column(
            "raw_event",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("message_versions", "raw_event")
