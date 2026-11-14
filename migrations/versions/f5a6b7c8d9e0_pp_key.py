"""PP (top-level Jira ticket) key

Revision ID: f5a6b7c8d9e0
Revises: e4f5a6b7c8d9
Create Date: 2026-11-14

"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f5a6b7c8d9e0"
down_revision: Union[str, Sequence[str], None] = "e4f5a6b7c8d9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("use_cases", sa.Column("pp_key", sa.String(length=20), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("use_cases") as batch:
        batch.drop_column("pp_key")
