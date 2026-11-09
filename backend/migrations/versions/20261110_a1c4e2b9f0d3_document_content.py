"""documents.content: file bytes for hosts without a shared disk

Revision ID: a1c4e2b9f0d3
Revises: d95720672f56
Create Date: 2026-11-10 00:00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a1c4e2b9f0d3"
down_revision: str | None = "d95720672f56"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("content", sa.LargeBinary(), nullable=True))


def downgrade() -> None:
    op.drop_column("documents", "content")
