"""create messaging media and transcript tables

Revision ID: 0004_mmt
Revises: 0003_tbi
Create Date: 2026-04-18

"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0004_mmt"
down_revision: str | Sequence[str] | None = "0003_tbi"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


message_event_type = sa.Enum(
    "message_created", "message_edited", "message_deleted", name="message_event_type"
)
media_status = sa.Enum("pending", "ready", "failed", name="media_status")
transcript_status = sa.Enum("pending", "ready", "failed", name="transcript_status")


def upgrade() -> None:
    op.create_table(
        "messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("provider_group_id", sa.String(length=255), nullable=False),
        sa.Column("provider_message_id", sa.String(length=255), nullable=False),
        sa.Column("sender_provider_user_id", sa.String(length=255), nullable=True),
        sa.Column("latest_version_no", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_messages"),
        sa.UniqueConstraint(
            "provider_group_id",
            "provider_message_id",
            name="uq_messages_provider_group_id_provider_message_id",
        ),
    )
    op.create_index("ix_messages_provider_group_id_created_at", "messages", ["provider_group_id", "created_at"])

    op.create_table(
        "message_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("event_type", message_event_type, nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("text_content", sa.Text(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], name="fk_message_versions_message_id_messages", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_message_versions"),
        sa.UniqueConstraint("message_id", "version_no", name="uq_message_versions_message_id_version_no"),
    )
    op.create_index("ix_message_versions_message_id_version_no", "message_versions", ["message_id", "version_no"])

    op.create_table(
        "media_assets",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider_media_id", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=255), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=True),
        sa.Column("byte_size", sa.Integer(), nullable=True),
        sa.Column("s3_key", sa.String(length=512), nullable=True),
        sa.Column("status", media_status, nullable=False, server_default=sa.text("'pending'")),
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], name="fk_media_assets_message_id_messages", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_media_assets"),
    )

    op.create_table(
        "transcripts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("media_asset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("text_content", sa.Text(), nullable=True),
        sa.Column("language", sa.String(length=16), nullable=True),
        sa.Column("status", transcript_status, nullable=False, server_default=sa.text("'pending'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["media_asset_id"], ["media_assets.id"], name="fk_transcripts_media_asset_id_media_assets", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_transcripts"),
        sa.UniqueConstraint("media_asset_id", name="uq_transcripts_media_asset_id"),
    )


def downgrade() -> None:
    op.drop_table("transcripts")
    op.drop_table("media_assets")
    op.drop_index("ix_message_versions_message_id_version_no", table_name="message_versions")
    op.drop_table("message_versions")
    op.drop_index("ix_messages_provider_group_id_created_at", table_name="messages")
    op.drop_table("messages")
