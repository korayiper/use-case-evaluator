"""department "important" marks

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-09-01

"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d3e4f5a6b7c8"
down_revision: Union[str, Sequence[str], None] = "c2d3e4f5a6b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "use_case_important_marks",
        sa.Column("use_case_id", sa.String(length=36), sa.ForeignKey("use_cases.id"), primary_key=True),
        sa.Column("department", sa.String(length=10), primary_key=True),
        sa.Column("marked_by", sa.String(length=200), nullable=False),
        sa.Column("updated_at", sa.String(length=32), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("use_case_important_marks")
