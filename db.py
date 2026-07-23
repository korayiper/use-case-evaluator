import sqlite3
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
        f"UID={user};PWD={password};Encrypt=yes;TrustServerCertificate=no;"
    )


def get_connection():
    if DB_BACKEND == "mssql":
        return pyodbc.connect(_mssql_connection_string())
    conn = sqlite3.connect(SQLITE_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


# No ON DELETE CASCADE here on purpose: use_case_dependencies references
# use_cases twice (use_case_id and depends_on_id). SQL Server refuses to
# create two cascading FKs to the same table from the same table ("may cause
# cycles or multiple cascade paths"). delete_use_case() below cleans up both
# directions explicitly instead, which works identically on both backends
# rather than relying on DB-level cascade semantics that differ between them.
SQLITE_SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS use_cases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        golive_date TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS use_case_dependencies (
        use_case_id INTEGER NOT NULL,
        depends_on_id INTEGER NOT NULL,
        PRIMARY KEY (use_case_id, depends_on_id),
        FOREIGN KEY (use_case_id) REFERENCES use_cases(id),
        FOREIGN KEY (depends_on_id) REFERENCES use_cases(id)
    )
    """,
]

MSSQL_SCHEMA = [
    """
    IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.use_cases') AND type = N'U')
    CREATE TABLE dbo.use_cases (
        id INT IDENTITY(1,1) PRIMARY KEY,
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
        golive_date NVARCHAR(10) NOT NULL,
        created_at DATETIME2 NOT NULL DEFAULT (SYSUTCDATETIME())
    )
    """,
    """
    IF NOT EXISTS (
        SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.use_case_dependencies') AND type = N'U'
    )
    CREATE TABLE dbo.use_case_dependencies (
        use_case_id INT NOT NULL,
        depends_on_id INT NOT NULL,
        CONSTRAINT PK_use_case_dependencies PRIMARY KEY (use_case_id, depends_on_id),
        CONSTRAINT FK_use_case_dependencies_use_case FOREIGN KEY (use_case_id) REFERENCES dbo.use_cases(id),
        CONSTRAINT FK_use_case_dependencies_depends_on FOREIGN KEY (depends_on_id) REFERENCES dbo.use_cases(id)
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


def _last_insert_id(conn, cursor) -> int:
    if DB_BACKEND == "mssql":
        return int(conn.execute("SELECT SCOPE_IDENTITY() AS id").fetchone()[0])
    return cursor.lastrowid


def existing_ids() -> set[int]:
    with get_connection() as conn:
        rows = _rows_as_dicts(conn.execute("SELECT id FROM use_cases"))
    return {r["id"] for r in rows}


def _set_dependencies(conn, use_case_id: int, depends_on_ids: list[int]) -> None:
    """Replace use_case_id's outgoing dependency edges. Runs on the caller's
    open connection so it's atomic with the row insert/update."""
    conn.execute("DELETE FROM use_case_dependencies WHERE use_case_id = ?", (use_case_id,))
    for dep_id in depends_on_ids:
        conn.execute(
            "INSERT INTO use_case_dependencies (use_case_id, depends_on_id) VALUES (?, ?)",
            (use_case_id, dep_id),
        )


def _all_dependencies() -> dict[int, list[int]]:
    """use_case_id -> list of its prerequisite ids, for every use case."""
    with get_connection() as conn:
        rows = _rows_as_dicts(conn.execute("SELECT use_case_id, depends_on_id FROM use_case_dependencies"))
    graph: dict[int, list[int]] = {}
    for r in rows:
        graph.setdefault(r["use_case_id"], []).append(r["depends_on_id"])
    return graph


def has_cycle(use_case_id: int | None, depends_on_ids: list[int]) -> bool:
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
    golive_date,
    depends_on_ids=None,
):
    with get_connection() as conn:
        cur = conn.execute(
            """
            INSERT INTO use_cases
                (name, idea_initiator, description, value_added_description, use_category, ai_feasibility,
                 value_added, development_time, process_criticality, process_dependency, golive_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                golive_date,
            ),
        )
        use_case_id = _last_insert_id(conn, cur)
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
    golive_date,
    depends_on_ids=None,
):
    with get_connection() as conn:
        conn.execute(
            """
            UPDATE use_cases SET
                name = ?, idea_initiator = ?, description = ?, value_added_description = ?, use_category = ?,
                ai_feasibility = ?, value_added = ?, development_time = ?, process_criticality = ?,
                process_dependency = ?, golive_date = ?
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
                golive_date,
                use_case_id,
            ),
        )
        _set_dependencies(conn, use_case_id, depends_on_ids or [])


def get_use_case(use_case_id: int) -> dict | None:
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
    return _enrich(row, [r["depends_on_id"] for r in dep_rows], [r["name"] for r in dep_rows])


def delete_use_case(use_case_id: int) -> None:
    with get_connection() as conn:
        conn.execute(
            "DELETE FROM use_case_dependencies WHERE use_case_id = ? OR depends_on_id = ?",
            (use_case_id, use_case_id),
        )
        conn.execute("DELETE FROM use_cases WHERE id = ?", (use_case_id,))


def _enrich(row: dict, depends_on_ids: list[int], depends_on_names: list[str]) -> dict:
    d = dict(row)
    months = scoring.development_months(d["development_time"])
    golive = date.fromisoformat(d["golive_date"])
    backlog = scoring.is_backlog(d["value_added"], d["ai_feasibility"])
    start = scoring.BACKLOG_START_DATE if backlog else golive - timedelta(days=months * 30)
    d["priority"] = scoring.points(
        d["value_added"], d["development_time"], d["process_criticality"], d["process_dependency"]
    )
    d["value_added_points"] = scoring.VALUE_ADDED[d["value_added"]]
    d["development_time_points"] = scoring.DEVELOPMENT_TIME[d["development_time"]][0]
    d["development_time_months"] = months
    d["process_criticality_points"] = scoring.PROCESS_CRITICALITY[d["process_criticality"]]
    d["process_dependency_points"] = scoring.PROCESS_DEPENDENCY[d["process_dependency"]]
    d["ai_feasibility_points"] = scoring.AI_FEASIBILITY[d["ai_feasibility"]]
    d["ai_feasibility_rank"] = scoring.AI_FEASIBILITY_RANK[d["ai_feasibility"]]
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
    ids_map: dict[int, list[int]] = {}
    names_map: dict[int, list[str]] = {}
    for r in dep_rows:
        ids_map.setdefault(r["use_case_id"], []).append(r["depends_on_id"])
        names_map.setdefault(r["use_case_id"], []).append(r["name"])
    return [_enrich(row, ids_map.get(row["id"], []), names_map.get(row["id"], [])) for row in rows]