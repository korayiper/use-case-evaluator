"""process support: department votes, lifecycle status, session candidates, board stage

Revision ID: b1c2d3e4f5a6
Revises: 8a53f247ce08
Create Date: 2026-08-30

Before running this against a database that already has vote data (i.e.
production): update settings.toml's prioboard_users to the new
{user, department} shape FIRST, including every username that has ever cast
a vote - this migration resolves each existing vote's department from that
config and fails loudly (RuntimeError) if a voter isn't listed. If the same
department historically had more than one voter on the same use case, only
the most-recently-updated vote is kept (the others are, by definition,
superseded - a department has exactly one vote going forward).
"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b1c2d3e4f5a6"
down_revision: Union[str, Sequence[str], None] = "8a53f247ce08"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # --- economic_value_votes: voter-keyed -> department-keyed ---
    from config import settings

    dept_by_user = {entry["user"]: entry["department"] for entry in settings.get("prioboard_users", [])}

    old_votes = sa.table(
        "economic_value_votes",
        sa.column("use_case_id", sa.String),
        sa.column("voter", sa.String),
        sa.column("value", sa.String),
        sa.column("updated_at", sa.String),
    )
    existing_rows = conn.execute(sa.select(old_votes)).mappings().all()

    resolved: dict[tuple[str, str], dict] = {}
    for row in existing_rows:
        department = dept_by_user.get(row["voter"])
        if department is None:
            raise RuntimeError(
                f"No department configured for voter {row['voter']!r} in prioboard_users - "
                "update settings.toml before running this migration."
            )
        key = (row["use_case_id"], department)
        if key not in resolved or row["updated_at"] > resolved[key]["updated_at"]:
            resolved[key] = {
                "use_case_id": row["use_case_id"],
                "department": department,
                "voter": row["voter"],
                "value": row["value"],
                "updated_at": row["updated_at"],
            }

    op.drop_table("economic_value_votes")
    op.create_table(
        "economic_value_votes",
        sa.Column("use_case_id", sa.String(length=36), sa.ForeignKey("use_cases.id"), primary_key=True),
        sa.Column("department", sa.String(length=10), primary_key=True),
        sa.Column("voter", sa.String(length=200), nullable=False),
        sa.Column("value", sa.String(length=50), nullable=False),
        sa.Column("updated_at", sa.String(length=32), nullable=False),
    )
    if resolved:
        new_votes = sa.table(
            "economic_value_votes",
            sa.column("use_case_id", sa.String),
            sa.column("department", sa.String),
            sa.column("voter", sa.String),
            sa.column("value", sa.String),
            sa.column("updated_at", sa.String),
        )
        op.bulk_insert(new_votes, list(resolved.values()))

    # --- use_cases: economic_value nullable, + status, + is_session_candidate ---
    with op.batch_alter_table("use_cases") as batch_op:
        batch_op.alter_column("economic_value", existing_type=sa.String(length=50), nullable=True)
        batch_op.add_column(sa.Column("status", sa.String(length=20), nullable=False, server_default="neu"))
        batch_op.add_column(
            sa.Column("is_session_candidate", sa.Boolean(), nullable=False, server_default=sa.false())
        )

    # --- board_state: single-row stage tracker for the twice-yearly handoff ---
    op.create_table(
        "board_state",
        # autoincrement=False: id is always 1, never generated - without
        # this, mssql infers IDENTITY for a lone integer PK and rejects the
        # seed row's explicit id=1 ("IDENTITY_INSERT is set to OFF").
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column("stage", sa.String(length=30), nullable=False),
    )
    op.bulk_insert(
        sa.table("board_state", sa.column("id", sa.Integer), sa.column("stage", sa.String)),
        [{"id": 1, "stage": "prioboard"}],
    )


def downgrade() -> None:
    # Not a lossless round-trip: collapsing multiple historical per-user
    # votes onto one vote per department is a real, deliberate data
    # narrowing (see upgrade() above) - downgrading restores the *shape* of
    # the old schema, not the discarded duplicate vote rows.
    op.drop_table("board_state")

    with op.batch_alter_table("use_cases") as batch_op:
        batch_op.drop_column("is_session_candidate")
        batch_op.drop_column("status")
        batch_op.alter_column("economic_value", existing_type=sa.String(length=50), nullable=False)

    conn = op.get_bind()
    dept_votes = sa.table(
        "economic_value_votes",
        sa.column("use_case_id", sa.String),
        sa.column("department", sa.String),
        sa.column("voter", sa.String),
        sa.column("value", sa.String),
        sa.column("updated_at", sa.String),
    )
    existing_rows = conn.execute(sa.select(dept_votes)).mappings().all()

    op.drop_table("economic_value_votes")
    op.create_table(
        "economic_value_votes",
        sa.Column("use_case_id", sa.String(length=36), sa.ForeignKey("use_cases.id"), primary_key=True),
        sa.Column("voter", sa.String(length=200), primary_key=True),
        sa.Column("value", sa.String(length=50), nullable=False),
        sa.Column("updated_at", sa.String(length=32), nullable=False),
    )
    if existing_rows:
        old_votes = sa.table(
            "economic_value_votes",
            sa.column("use_case_id", sa.String),
            sa.column("voter", sa.String),
            sa.column("value", sa.String),
            sa.column("updated_at", sa.String),
        )
        op.bulk_insert(
            old_votes,
            [
                {
                    "use_case_id": r["use_case_id"],
                    "voter": r["voter"],
                    "value": r["value"],
                    "updated_at": r["updated_at"],
                }
                for r in existing_rows
            ],
        )