"""SQLAlchemy Core table definitions - the single source of truth for the
schema. Alembic's migrations/env.py autogenerates against this MetaData;
db.py builds its queries against these Table objects instead of embedding
raw, backend-specific SQL column lists, so the two can't drift apart.

Generic column types (String/Text/Integer) compile to the right DDL per
dialect automatically (e.g. Text -> NVARCHAR(MAX) on mssql, TEXT on sqlite),
which is why this file replaces the old parallel SQLITE_SCHEMA/MSSQL_SCHEMA
lists in db.py - one definition, not two kept in sync by hand.
"""

from datetime import datetime, timezone

from sqlalchemy import Column, ForeignKey, Integer, MetaData, String, Table, Text

metadata = MetaData()

# ids are client-generated UUIDs (str(uuid.uuid4())), not DB auto-increment/
# IDENTITY - see db.py for why. created_at is write-only (nothing in the app
# ever reads it back), so it gets a plain Python-side default rather than a
# dialect-specific server_default expression.
use_cases = Table(
    "use_cases",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("name", String(200), nullable=False),
    Column("idea_initiator", String(200), nullable=False),
    Column("description", Text),
    Column("value_added_description", Text),
    Column("use_category", String(50), nullable=False),
    Column("ai_feasibility", String(50), nullable=False),
    Column("value_added", String(50), nullable=False),
    Column("development_time", String(50), nullable=False),
    Column("process_criticality", String(50), nullable=False),
    Column("process_dependency", String(50), nullable=False),
    Column("economic_value", String(50), nullable=False),
    Column("golive_date", String(10), nullable=False),
    Column("manual_rank", Integer),
    Column(
        "created_at",
        String(32),
        nullable=False,
        default=lambda: datetime.now(timezone.utc).isoformat(),
    ),
)

# No ON DELETE CASCADE on purpose: this table references use_cases twice
# (use_case_id and depends_on_id). SQL Server refuses to create two cascading
# FKs to the same table from the same table ("may cause cycles or multiple
# cascade paths"). db.delete_use_case() cleans up both directions explicitly
# instead, which works identically on both backends rather than relying on
# DB-level cascade semantics that differ between them.
use_case_dependencies = Table(
    "use_case_dependencies",
    metadata,
    Column("use_case_id", String(36), ForeignKey("use_cases.id"), primary_key=True),
    Column("depends_on_id", String(36), ForeignKey("use_cases.id"), primary_key=True),
)

economic_value_votes = Table(
    "economic_value_votes",
    metadata,
    Column("use_case_id", String(36), ForeignKey("use_cases.id"), primary_key=True),
    Column("voter", String(200), primary_key=True),
    Column("value", String(50), nullable=False),
    # Set explicitly by db.upsert_vote() on every write, not a column default.
    Column("updated_at", String(32), nullable=False),
)