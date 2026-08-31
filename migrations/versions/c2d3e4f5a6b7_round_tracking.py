"""round tracking: prioritized_at, prioritized_round

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-09-01

"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c2d3e4f5a6b7"
down_revision: Union[str, Sequence[str], None] = "b1c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("use_cases") as batch_op:
        batch_op.add_column(sa.Column("prioritized_at", sa.String(length=32), nullable=True))
        batch_op.add_column(sa.Column("prioritized_round", sa.String(length=20), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("use_cases") as batch_op:
        batch_op.drop_column("prioritized_round")
        batch_op.drop_column("prioritized_at")