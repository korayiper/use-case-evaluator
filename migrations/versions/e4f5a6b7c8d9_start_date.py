"""store start_date instead of golive_date

The use case manager now enters the project start; go-live is derived from
it (start + development_time) in db._enrich(). Existing rows are converted
with the same rule the app used to derive the start before
(golive - months * 30 days), so every non-backlog bar stays exactly where it
was on the timeline.

Revision ID: e4f5a6b7c8d9
Revises: d3e4f5a6b7c8
Create Date: 2026-11-14

"""
from datetime import date, timedelta
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e4f5a6b7c8d9"
down_revision: Union[str, Sequence[str], None] = "d3e4f5a6b7c8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Frozen copy of scoring.DEVELOPMENT_TIME's months - a migration must not
# change meaning if scoring.py is edited later.
_MONTHS = {"24 months": 24, "12 months": 12, "9 months": 9, "6 months": 6, "3 months": 3}


def _shift_dates(column: str, sign: int) -> None:
    conn = op.get_bind()
    rows = conn.execute(sa.text(f"SELECT id, development_time, {column} FROM use_cases")).fetchall()
    for uc_id, development_time, value in rows:
        shifted = date.fromisoformat(value) + sign * timedelta(days=_MONTHS[development_time] * 30)
        conn.execute(
            sa.text(f"UPDATE use_cases SET {column} = :v WHERE id = :id"),
            {"v": shifted.isoformat(), "id": uc_id},
        )


def upgrade() -> None:
    with op.batch_alter_table("use_cases") as batch:
        batch.alter_column(
            "golive_date", new_column_name="start_date", existing_type=sa.String(length=10), existing_nullable=False
        )
    _shift_dates("start_date", -1)


def downgrade() -> None:
    _shift_dates("start_date", +1)
    with op.batch_alter_table("use_cases") as batch:
        batch.alter_column(
            "start_date", new_column_name="golive_date", existing_type=sa.String(length=10), existing_nullable=False
        )
