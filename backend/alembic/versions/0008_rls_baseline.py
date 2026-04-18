"""add baseline row-level-security policies

Revision ID: 0008_rls
Revises: 0007_hardening
Create Date: 2026-04-18

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0008_rls"
down_revision: str | Sequence[str] | None = "0007_hardening"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE group_bindings ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE messages ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE knowledge_group_docs ENABLE ROW LEVEL SECURITY")

    # NOTE: Session variables are expected from API middleware.
    op.execute(
        """
        CREATE POLICY group_bindings_staff_scope ON group_bindings
        USING (
            current_setting('app.role', true) IN ('owner', 'admin')
            OR provider_group_id = ANY (
                string_to_array(current_setting('app.group_scope', true), ',')
            )
        )
        """
    )

    op.execute(
        """
        CREATE POLICY messages_staff_scope ON messages
        USING (
            current_setting('app.role', true) IN ('owner', 'admin')
            OR provider_group_id = ANY (
                string_to_array(current_setting('app.group_scope', true), ',')
            )
        )
        """
    )

    op.execute(
        """
        CREATE POLICY knowledge_group_docs_staff_scope ON knowledge_group_docs
        USING (
            current_setting('app.role', true) IN ('owner', 'admin')
            OR provider_group_id = ANY (
                string_to_array(current_setting('app.group_scope', true), ',')
            )
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS knowledge_group_docs_staff_scope ON knowledge_group_docs")
    op.execute("DROP POLICY IF EXISTS messages_staff_scope ON messages")
    op.execute("DROP POLICY IF EXISTS group_bindings_staff_scope ON group_bindings")

    op.execute("ALTER TABLE knowledge_group_docs DISABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE messages DISABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE group_bindings DISABLE ROW LEVEL SECURITY")
