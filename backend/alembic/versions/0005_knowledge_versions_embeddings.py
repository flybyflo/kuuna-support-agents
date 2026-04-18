"""create knowledge and embedding tables

Revision ID: 0005_knowledge_versions_embeddings
Revises: 0004_messages_media_transcripts
Create Date: 2026-04-18

"""

from collections.abc import Sequence

from alembic import op
from pgvector.sqlalchemy import Vector
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0005_knowledge_versions_embeddings"
down_revision: str | Sequence[str] | None = "0004_messages_media_transcripts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


knowledge_scope = sa.Enum("common", "group", name="knowledge_scope")
knowledge_version_status = sa.Enum(
    "draft", "ready", "published", "archived", name="knowledge_version_status"
)
embedding_scope = sa.Enum("common", "group", name="embedding_scope")


def upgrade() -> None:
    knowledge_scope.create(op.get_bind(), checkfirst=True)
    knowledge_version_status.create(op.get_bind(), checkfirst=True)
    embedding_scope.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "knowledge_common_docs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("doc_key", sa.String(length=255), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_knowledge_common_docs"),
        sa.UniqueConstraint("doc_key", name="uq_knowledge_common_docs_doc_key"),
    )

    op.create_table(
        "knowledge_group_docs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("provider_group_id", sa.String(length=255), nullable=False),
        sa.Column("doc_key", sa.String(length=255), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_knowledge_group_docs"),
        sa.UniqueConstraint(
            "provider_group_id", "doc_key", name="uq_knowledge_group_docs_provider_group_id_doc_key"
        ),
    )

    op.create_table(
        "knowledge_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("scope", knowledge_scope, nullable=False),
        sa.Column("doc_ref_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("status", knowledge_version_status, nullable=False, server_default=sa.text("'draft'")),
        sa.Column("content_markdown", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_knowledge_versions"),
        sa.UniqueConstraint(
            "scope", "doc_ref_id", "version_no", name="uq_knowledge_versions_scope_doc_ref_id_version_no"
        ),
    )
    op.create_index("ix_knowledge_versions_status_scope", "knowledge_versions", ["status", "scope"])

    op.create_table(
        "embeddings",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("scope", embedding_scope, nullable=False),
        sa.Column("source_version_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("chunk_no", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("token_count", sa.Integer(), nullable=False),
        sa.Column("embedding", Vector(1536), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(
            ["source_version_id"],
            ["knowledge_versions.id"],
            name="fk_embeddings_source_version_id_knowledge_versions",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_embeddings"),
    )
    op.create_index("ix_embeddings_source_version_chunk", "embeddings", ["source_version_id", "chunk_no"])


def downgrade() -> None:
    op.drop_index("ix_embeddings_source_version_chunk", table_name="embeddings")
    op.drop_table("embeddings")
    op.drop_index("ix_knowledge_versions_status_scope", table_name="knowledge_versions")
    op.drop_table("knowledge_versions")
    op.drop_table("knowledge_group_docs")
    op.drop_table("knowledge_common_docs")

    embedding_scope.drop(op.get_bind(), checkfirst=True)
    knowledge_version_status.drop(op.get_bind(), checkfirst=True)
    knowledge_scope.drop(op.get_bind(), checkfirst=True)
