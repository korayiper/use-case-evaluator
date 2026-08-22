import sqlite3
import uuid
from datetime import date, timedelta
from pathlib import Path

import scoring
from config import settings

# "sqlite" (default, used in dev) or "mssql" (prod) - see settings.toml /
# .secrets.toml.example. Everything below this point is written against the
# DB-API surface both sqlite3 and pyodbc share (conn.execute(sql, params),
# cursor.description, cursor.fetchall/fetchone, "?" placeholders,
# connection-as-transaction-context-manager), so the CRUD functions never
# need to know which backend is active.
DB_BACKEND = settings.get("db_backend", "sqlite").lower()

SQLITE_PATH = Path(settings.get("sqlite_path", Path(__file__).parent / "usecases.db"))

if DB_BACKEND == "mssql":
    import pyodbc  # only required when db_backend=mssql - not installed for dev/sqlite


def _mssql_connection_string() -> str:
    explicit = settings.get("mssql_connection_string")
    if explicit:
        return explicit
    driver = settings.get("mssql_driver", "ODBC Driver 18 for SQL Server")
    server = settings["mssql_server"]
    database = settings["mssql_database"]
    user = settings["mssql_user"]
    password = settings["mssql_password"]
    return (
        f"DRIVER={{{driver}}};SERVER={server};DATABASE={database};"
        f"UID={user};PWD={password};Encrypt=yes;TrustServerCertificate=yes;"
    )


def get_connection():
    if DB_BACKEND == "mssql":
        return pyodbc.connect(_mssql_connection_string())
    conn = sqlite3.connect(SQLITE_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


# ids are client-generated UUIDs (str(uuid.uuid4())), not DB auto-increment/
# IDENTITY. This sidesteps retrieving a DB-generated id after INSERT
# entirely (no lastrowid/SCOPE_IDENTITY()/OUTPUT-clause dance, no
# backend-specific code for it) - the id is known before the INSERT even
# runs, identically on every backend.
#
# No ON DELETE CASCADE here on purpose: use_case_dependencies references
# use_cases twice (use_case_id and depends_on_id). SQL Server refuses to
# create two cascading FKs to the same table from the same table ("may cause
# cycles or multiple cascade paths"). delete_use_case() below cleans up both
# directions explicitly instead, which works identically on both backends
# rather than relying on DB-level cascade semantics that differ between them.
#
# economic_value is a fixed 5-class attribute (like value_added etc.),
# stored as its string key and scored via scoring.py.
SQLITE_SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS use_cases (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        idea_initiator TEXT NOT NULL,
        description TEXT,
        value_added_description TEXT,
        use_category TEXT NOT NULL,
        ai_feasibility TEXT NOT NULL,
        value_added TEXT NOT NULL,
        development_time TEXT NOT NULL,
        process_criticality TEXT NOT NULL,
        process_dependency TEXT NOT NULL,
        economic_value TEXT NOT NULL,
        golive_date TEXT NOT NULL,
        manual_rank INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS use_case_dependencies (
        use_case_id TEXT NOT NULL,
        depends_on_id TEXT NOT NULL,
        PRIMARY KEY (use_case_id, depends_on_id),
        FOREIGN KEY (use_case_id) REFERENCES use_cases(id),
        FOREIGN KEY (depends_on_id) REFERENCES use_cases(id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS economic_value_votes (
        use_case_id TEXT NOT NULL,
        voter TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (use_case_id, voter),
        FOREIGN KEY (use_case_id) REFERENCES use_cases(id)
    )
    """,
]

MSSQL_SCHEMA = [
    """
    IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.use_cases') AND type = N'U')
    CREATE TABLE dbo.use_cases (
        id NVARCHAR(36) PRIMARY KEY,
        name NVARCHAR(200) NOT NULL,
        idea_initiator NVARCHAR(200) NOT NULL,
        description NVARCHAR(MAX),
        value_added_description NVARCHAR(MAX),
        use_category NVARCHAR(50) NOT NULL,
        ai_feasibility NVARCHAR(50) NOT NULL,
        value_added NVARCHAR(50) NOT NULL,
        development_time NVARCHAR(50) NOT NULL,
        process_criticality NVARCHAR(50) NOT NULL,
        process_dependency NVARCHAR(50) NOT NULL,
        economic_value NVARCHAR(50) NOT NULL,
        golive_date NVARCHAR(10) NOT NULL,
        manual_rank INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT (SYSUTCDATETIME())
    )
    """,
    """
    IF NOT EXISTS (
        SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.use_case_dependencies') AND type = N'U'
    )
    CREATE TABLE dbo.use_case_dependencies (
        use_case_id NVARCHAR(36) NOT NULL,
        depends_on_id NVARCHAR(36) NOT NULL,
        CONSTRAINT PK_use_case_dependencies PRIMARY KEY (use_case_id, depends_on_id),
        CONSTRAINT FK_use_case_dependencies_use_case FOREIGN KEY (use_case_id) REFERENCES dbo.use_cases(id),
        CONSTRAINT FK_use_case_dependencies_depends_on FOREIGN KEY (depends_on_id) REFERENCES dbo.use_cases(id)
    )
    """,
    """
    IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.economic_value_votes') AND type = N'U')
    CREATE TABLE dbo.economic_value_votes (
        use_case_id NVARCHAR(36) NOT NULL,
        voter NVARCHAR(200) NOT NULL,
        value NVARCHAR(50) NOT NULL,
        updated_at DATETIME2 NOT NULL DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_economic_value_votes PRIMARY KEY (use_case_id, voter),
        CONSTRAINT FK_economic_value_votes_use_case FOREIGN KEY (use_case_id) REFERENCES dbo.use_cases(id)
    )
    """,
]


def init_db() -> None:
    statements = MSSQL_SCHEMA if DB_BACKEND == "mssql" else SQLITE_SCHEMA
    with get_connection() as conn:
        for statement in statements:
            conn.execute(statement)


def _rows_as_dicts(cursor) -> list[dict]:
    columns = [col[0] for col in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def _row_as_dict(cursor) -> dict | None:
    columns = [col[0] for col in cursor.description]
    row = cursor.fetchone()
    return dict(zip(columns, row)) if row else None


def existing_ids() -> set[str]:
    with get_connection() as conn:
        rows = _rows_as_dicts(conn.execute("SELECT id FROM use_cases"))
    return {r["id"] for r in rows}


def _set_dependencies(conn, use_case_id: str, depends_on_ids: list[str]) -> None:
    """Replace use_case_id's outgoing dependency edges. Runs on the caller's
    open connection so it's atomic with the row insert/update."""
    conn.execute("DELETE FROM use_case_dependencies WHERE use_case_id = ?", (use_case_id,))
    for dep_id in depends_on_ids:
        conn.execute(
            "INSERT INTO use_case_dependencies (use_case_id, depends_on_id) VALUES (?, ?)",
            (use_case_id, dep_id),
        )


def _all_dependencies() -> dict[str, list[str]]:
    """use_case_id -> list of its prerequisite ids, for every use case."""
    with get_connection() as conn:
        rows = _rows_as_dicts(conn.execute("SELECT use_case_id, depends_on_id FROM use_case_dependencies"))
    graph: dict[str, list[str]] = {}
    for r in rows:
        graph.setdefault(r["use_case_id"], []).append(r["depends_on_id"])
    return graph


def has_cycle(use_case_id: str | None, depends_on_ids: list[str]) -> bool:
    """True if replacing use_case_id's outgoing edges with depends_on_ids would
    create a cycle. use_case_id is None for a not-yet-created use case (which
    can never be part of an existing cycle, since nothing can already
    reference an id that doesn't exist yet)."""
    graph = _all_dependencies()
    graph[use_case_id] = list(depends_on_ids)
    visited: set = set()

    def visit(node) -> bool:
        if node == use_case_id:
            return True
        if node in visited:
            return False
        visited.add(node)
        return any(visit(nxt) for nxt in graph.get(node, []))

    return any(visit(dep_id) for dep_id in depends_on_ids)


def add_use_case(
    name,
    idea_initiator,
    description,
    value_added_description,
    use_category,
    ai_feasibility,
    value_added,
    development_time,
    process_criticality,
    process_dependency,
    economic_value,
    golive_date,
    depends_on_ids=None,
) -> str:
    use_case_id = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO use_cases
                (id, name, idea_initiator, description, value_added_description, use_category, ai_feasibility,
                 value_added, development_time, process_criticality, process_dependency, economic_value,
                 golive_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                use_case_id,
                name,
                idea_initiator,
                description,
                value_added_description,
                use_category,
                ai_feasibility,
                value_added,
                development_time,
                process_criticality,
                process_dependency,
                economic_value,
                golive_date,
            ),
        )
        _set_dependencies(conn, use_case_id, depends_on_ids or [])
    return use_case_id


def update_use_case(
    use_case_id,
    name,
    idea_initiator,
    description,
    value_added_description,
    use_category,
    ai_feasibility,
    value_added,
    development_time,
    process_criticality,
    process_dependency,
    economic_value,
    golive_date,
    depends_on_ids=None,
):
    with get_connection() as conn:
        conn.execute(
            """
            UPDATE use_cases SET
                name = ?, idea_initiator = ?, description = ?, value_added_description = ?, use_category = ?,
                ai_feasibility = ?, value_added = ?, development_time = ?, process_criticality = ?,
                process_dependency = ?, economic_value = ?, golive_date = ?
            WHERE id = ?
            """,
            (
                name,
                idea_initiator,
                description,
                value_added_description,
                use_category,
                ai_feasibility,
                value_added,
                development_time,
                process_criticality,
                process_dependency,
                economic_value,
                golive_date,
                use_case_id,
            ),
        )
        _set_dependencies(conn, use_case_id, depends_on_ids or [])


def get_use_case(use_case_id: str) -> dict | None:
    with get_connection() as conn:
        row = _row_as_dict(conn.execute("SELECT * FROM use_cases WHERE id = ?", (use_case_id,)))
        if not row:
            return None
        dep_rows = _rows_as_dicts(
            conn.execute(
                """
                SELECT d.depends_on_id, u.name
                FROM use_case_dependencies d
                JOIN use_cases u ON u.id = d.depends_on_id
                WHERE d.use_case_id = ?
                ORDER BY u.name
                """,
                (use_case_id,),
            )
        )
        vote_rows = _rows_as_dicts(
            conn.execute("SELECT value FROM economic_value_votes WHERE use_case_id = ?", (use_case_id,))
        )
    return _enrich(
        row,
        [r["depends_on_id"] for r in dep_rows],
        [r["name"] for r in dep_rows],
        [r["value"] for r in vote_rows],
    )


def get_dependents(use_case_id: str) -> list[dict]:
    """Use cases that declare use_case_id as a prerequisite - the reverse
    of depends_on."""
    with get_connection() as conn:
        rows = _rows_as_dicts(
            conn.execute(
                """
                SELECT u.id, u.name
                FROM use_case_dependencies d
                JOIN use_cases u ON u.id = d.use_case_id
                WHERE d.depends_on_id = ?
                ORDER BY u.name
                """,
                (use_case_id,),
            )
        )
    return rows


def delete_use_case(use_case_id: str) -> None:
    with get_connection() as conn:
        conn.execute(
            "DELETE FROM use_case_dependencies WHERE use_case_id = ? OR depends_on_id = ?",
            (use_case_id, use_case_id),
        )
        conn.execute("DELETE FROM use_cases WHERE id = ?", (use_case_id,))


def _enrich(
    row: dict, depends_on_ids: list[str], depends_on_names: list[str], vote_values: list[str] | None = None
) -> dict:
    d = dict(row)
    vote_values = vote_values or []
    # Once a use case has board votes, their median silently supersedes the
    # manually-entered economic_value for every downstream consumer (the
    # priority sum, the economic_value filter, chip colors, labels) - not
    # just an extra parallel field. Otherwise those would keep showing the
    # stale pre-vote value for anything already on the prio board.
    if vote_values:
        median = scoring.economic_value_median(vote_values)
        d["economic_value"] = scoring.economic_value_nearest_label(median)
        economic_value_points = median
    else:
        economic_value_points = scoring.ECONOMIC_VALUE[d["economic_value"]]
    months = scoring.development_months(d["development_time"])
    golive = date.fromisoformat(d["golive_date"])
    backlog = scoring.is_backlog(d["value_added"], d["ai_feasibility"])
    start = scoring.BACKLOG_START_DATE if backlog else golive - timedelta(days=months * 30)
    d["priority"] = scoring.points(
        d["value_added"],
        d["development_time"],
        d["process_criticality"],
        d["process_dependency"],
        economic_value_points,
    )
    d["value_added_points"] = scoring.VALUE_ADDED[d["value_added"]]
    d["development_time_points"] = scoring.DEVELOPMENT_TIME[d["development_time"]][0]
    d["development_time_months"] = months
    d["process_criticality_points"] = scoring.PROCESS_CRITICALITY[d["process_criticality"]]
    d["process_dependency_points"] = scoring.PROCESS_DEPENDENCY[d["process_dependency"]]
    d["ai_feasibility_points"] = scoring.AI_FEASIBILITY[d["ai_feasibility"]]
    d["ai_feasibility_rank"] = scoring.AI_FEASIBILITY_RANK[d["ai_feasibility"]]
    d["economic_value_points"] = economic_value_points
    d["vote_count"] = len(vote_values)
    d["is_backlog"] = backlog
    d["start_date"] = start.isoformat()
    d["depends_on"] = depends_on_ids
    d["depends_on_names"] = depends_on_names
    d.update(
        scoring.labels_for(
            d["value_added"],
            d["development_time"],
            d["process_criticality"],
            d["process_dependency"],
            d["use_category"],
            d["ai_feasibility"],
            d["economic_value"],
        )
    )
    return d


def list_use_cases() -> list[dict]:
    with get_connection() as conn:
        rows = _rows_as_dicts(conn.execute("SELECT * FROM use_cases ORDER BY golive_date"))
        dep_rows = _rows_as_dicts(
            conn.execute(
                """
                SELECT d.use_case_id, d.depends_on_id, u.name
                FROM use_case_dependencies d
                JOIN use_cases u ON u.id = d.depends_on_id
                ORDER BY u.name
                """
            )
        )
        vote_rows = _rows_as_dicts(conn.execute("SELECT use_case_id, value FROM economic_value_votes"))
    ids_map: dict[str, list[str]] = {}
    names_map: dict[str, list[str]] = {}
    for r in dep_rows:
        ids_map.setdefault(r["use_case_id"], []).append(r["depends_on_id"])
        names_map.setdefault(r["use_case_id"], []).append(r["name"])
    votes_map: dict[str, list[str]] = {}
    for r in vote_rows:
        votes_map.setdefault(r["use_case_id"], []).append(r["value"])
    return [
        _enrich(row, ids_map.get(row["id"], []), names_map.get(row["id"], []), votes_map.get(row["id"], []))
        for row in rows
    ]


# Upsert syntax genuinely isn't portable across sqlite/mssql - this is the
# one deliberate backend-specific exception to the shared DB-API convention
# documented at the top of this file.
def upsert_vote(use_case_id: str, voter: str, value: str) -> None:
    with get_connection() as conn:
        if DB_BACKEND == "mssql":
            conn.execute(
                """
                MERGE dbo.economic_value_votes AS target
                USING (SELECT ? AS use_case_id, ? AS voter, ? AS value) AS src
                ON target.use_case_id = src.use_case_id AND target.voter = src.voter
                WHEN MATCHED THEN UPDATE SET value = src.value, updated_at = SYSUTCDATETIME()
                WHEN NOT MATCHED THEN INSERT (use_case_id, voter, value) VALUES (src.use_case_id, src.voter, src.value);
                """,
                (use_case_id, voter, value),
            )
        else:
            conn.execute(
                """
                INSERT INTO economic_value_votes (use_case_id, voter, value, updated_at)
                VALUES (?, ?, ?, datetime('now'))
                ON CONFLICT (use_case_id, voter) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                """,
                (use_case_id, voter, value),
            )


def get_votes(use_case_id: str) -> list[dict]:
    with get_connection() as conn:
        return _rows_as_dicts(
            conn.execute(
                "SELECT voter, value, updated_at FROM economic_value_votes WHERE use_case_id = ? ORDER BY voter",
                (use_case_id,),
            )
        )


def _votes_for_ids(ids: list[str]) -> dict[str, list[dict]]:
    """use_case_id -> [{voter, value}, ...] for a set of ids - used by
    board_candidates() to show each board member their own current vote."""
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    with get_connection() as conn:
        rows = _rows_as_dicts(
            conn.execute(
                f"SELECT use_case_id, voter, value FROM economic_value_votes WHERE use_case_id IN ({placeholders})",
                ids,
            )
        )
    out: dict[str, list[dict]] = {}
    for r in rows:
        out.setdefault(r["use_case_id"], []).append({"voter": r["voter"], "value": r["value"]})
    return out


def set_manual_rank(ordered_ids: list[str]) -> None:
    """Full replace: persists ordered_ids' order as 1-based manual_rank.
    Callers always pass the complete current board list."""
    with get_connection() as conn:
        for i, use_case_id in enumerate(ordered_ids, start=1):
            conn.execute("UPDATE use_cases SET manual_rank = ? WHERE id = ?", (i, use_case_id))


def board_candidates(top_n: int) -> list[dict]:
    """Board contents: everyone already manually ranked (sticky - never
    dropped just because computed priority later shifts) unioned with
    however many more are needed to reach top_n, chosen by highest computed
    priority among the rest. Order: manual_rank ascending first, newcomers
    by priority descending appended after."""
    all_cases = list_use_cases()
    ranked = sorted((uc for uc in all_cases if uc["manual_rank"] is not None), key=lambda uc: uc["manual_rank"])
    unranked = sorted((uc for uc in all_cases if uc["manual_rank"] is None), key=lambda uc: uc["priority"], reverse=True)
    board = ranked + unranked[: max(0, top_n - len(ranked))]
    detail = _votes_for_ids([uc["id"] for uc in board])
    for uc in board:
        uc["votes"] = detail.get(uc["id"], [])
    return board
