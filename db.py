import uuid
from datetime import date, datetime, timezone, timedelta
from pathlib import Path

from sqlalchemy import create_engine, delete, event, insert, or_, select, text, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.engine import URL

import scoring
from config import settings
from models import board_state, economic_value_votes, use_case_dependencies, use_cases

# "sqlite" (default, used in dev) or "mssql" (prod) - see settings.toml /
# .secrets.toml.example. Everything below is written against SQLAlchemy Core
# (select/insert/update/delete constructs against the Table objects in
# models.py), so the CRUD functions never need to know which backend is
# active - SQLAlchemy's dialect layer handles that.
DB_BACKEND = settings.get("db_backend", "sqlite").lower()

SQLITE_PATH = Path(settings.get("sqlite_path", Path(__file__).parent / "usecases.db"))


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


def _engine_url():
    if DB_BACKEND == "mssql":
        return URL.create("mssql+pyodbc", query={"odbc_connect": _mssql_connection_string()})
    return f"sqlite:///{SQLITE_PATH}"


ENGINE = create_engine(_engine_url(), future=True)

if DB_BACKEND != "mssql":
    # sqlite defaults foreign-key enforcement to OFF per-connection; since
    # the engine pools/reuses DBAPI connections, this has to fire on every
    # new one, not just once at import time - the standard SQLAlchemy recipe
    # for this (replaces the old get_connection()'s per-call PRAGMA).
    @event.listens_for(ENGINE, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys = ON")
        cursor.close()


def _all(conn, stmt) -> list[dict]:
    return [dict(row) for row in conn.execute(stmt).mappings()]


def _one(conn, stmt) -> dict | None:
    row = conn.execute(stmt).mappings().first()
    return dict(row) if row is not None else None


def existing_ids() -> set[str]:
    with ENGINE.connect() as conn:
        return {r["id"] for r in _all(conn, select(use_cases.c.id))}


def _set_dependencies(conn, use_case_id: str, depends_on_ids: list[str]) -> None:
    """Replace use_case_id's outgoing dependency edges. Runs on the caller's
    open connection so it's atomic with the row insert/update."""
    conn.execute(delete(use_case_dependencies).where(use_case_dependencies.c.use_case_id == use_case_id))
    if depends_on_ids:
        conn.execute(
            insert(use_case_dependencies),
            [{"use_case_id": use_case_id, "depends_on_id": dep_id} for dep_id in depends_on_ids],
        )


def _all_dependencies() -> dict[str, list[str]]:
    """use_case_id -> list of its prerequisite ids, for every use case."""
    with ENGINE.connect() as conn:
        rows = _all(conn, select(use_case_dependencies.c.use_case_id, use_case_dependencies.c.depends_on_id))
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
    with ENGINE.begin() as conn:
        conn.execute(
            insert(use_cases),
            {
                "id": use_case_id,
                "name": name,
                "idea_initiator": idea_initiator,
                "description": description,
                "value_added_description": value_added_description,
                "use_category": use_category,
                "ai_feasibility": ai_feasibility,
                "value_added": value_added,
                "development_time": development_time,
                "process_criticality": process_criticality,
                "process_dependency": process_dependency,
                "economic_value": economic_value,
                "golive_date": golive_date,
            },
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
    with ENGINE.begin() as conn:
        conn.execute(
            update(use_cases)
            .where(use_cases.c.id == use_case_id)
            .values(
                name=name,
                idea_initiator=idea_initiator,
                description=description,
                value_added_description=value_added_description,
                use_category=use_category,
                ai_feasibility=ai_feasibility,
                value_added=value_added,
                development_time=development_time,
                process_criticality=process_criticality,
                process_dependency=process_dependency,
                economic_value=economic_value,
                golive_date=golive_date,
            )
        )
        _set_dependencies(conn, use_case_id, depends_on_ids or [])


def get_use_case(use_case_id: str) -> dict | None:
    with ENGINE.connect() as conn:
        row = _one(conn, select(use_cases).where(use_cases.c.id == use_case_id))
        if not row:
            return None
        dep_rows = _all(
            conn,
            select(use_case_dependencies.c.depends_on_id, use_cases.c.name)
            .select_from(
                use_case_dependencies.join(use_cases, use_cases.c.id == use_case_dependencies.c.depends_on_id)
            )
            .where(use_case_dependencies.c.use_case_id == use_case_id)
            .order_by(use_cases.c.name),
        )
        vote_rows = _all(
            conn, select(economic_value_votes.c.value).where(economic_value_votes.c.use_case_id == use_case_id)
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
    with ENGINE.connect() as conn:
        return _all(
            conn,
            select(use_cases.c.id, use_cases.c.name)
            .select_from(use_case_dependencies.join(use_cases, use_cases.c.id == use_case_dependencies.c.use_case_id))
            .where(use_case_dependencies.c.depends_on_id == use_case_id)
            .order_by(use_cases.c.name),
        )


def delete_use_case(use_case_id: str) -> None:
    with ENGINE.begin() as conn:
        conn.execute(
            delete(use_case_dependencies).where(
                or_(
                    use_case_dependencies.c.use_case_id == use_case_id,
                    use_case_dependencies.c.depends_on_id == use_case_id,
                )
            )
        )
        conn.execute(delete(use_cases).where(use_cases.c.id == use_case_id))


def _enrich(
    row: dict, depends_on_ids: list[str], depends_on_names: list[str], vote_values: list[str] | None = None
) -> dict:
    d = dict(row)
    vote_values = vote_values or []
    # economic_value is never entered directly (see use_cases.economic_value
    # in models.py) - it's purely the median of department votes. Before the
    # first vote, it's genuinely unscored: 0 points (a real, visible,
    # sortable provisional score, not hidden) and "Ausstehend" for display,
    # regardless of any leftover value from before this field stopped being
    # writer-editable.
    if vote_values:
        median = scoring.economic_value_median(vote_values)
        d["economic_value"] = scoring.economic_value_nearest_label(median)
        economic_value_points = median
    else:
        d["economic_value"] = None
        economic_value_points = 0
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
    with ENGINE.connect() as conn:
        rows = _all(conn, select(use_cases).order_by(use_cases.c.golive_date))
        dep_rows = _all(
            conn,
            select(use_case_dependencies.c.use_case_id, use_case_dependencies.c.depends_on_id, use_cases.c.name)
            .select_from(
                use_case_dependencies.join(use_cases, use_cases.c.id == use_case_dependencies.c.depends_on_id)
            )
            .order_by(use_cases.c.name),
        )
        vote_rows = _all(conn, select(economic_value_votes.c.use_case_id, economic_value_votes.c.value))
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
# one deliberate backend-specific exception to the shared-query convention
# documented at the top of this file. Keyed on (use_case_id, department), not
# voter - a second person from the same department overwrites that
# department's one vote rather than creating a second one.
def upsert_vote(use_case_id: str, department: str, voter: str, value: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with ENGINE.begin() as conn:
        if DB_BACKEND == "mssql":
            conn.execute(
                text(
                    """
                    MERGE dbo.economic_value_votes AS target
                    USING (
                        SELECT :use_case_id AS use_case_id, :department AS department, :voter AS voter,
                               :value AS value
                    ) AS src
                    ON target.use_case_id = src.use_case_id AND target.department = src.department
                    WHEN MATCHED THEN UPDATE SET voter = src.voter, value = src.value, updated_at = :updated_at
                    WHEN NOT MATCHED THEN INSERT (use_case_id, department, voter, value, updated_at)
                        VALUES (src.use_case_id, src.department, src.voter, src.value, :updated_at);
                    """
                ),
                {
                    "use_case_id": use_case_id,
                    "department": department,
                    "voter": voter,
                    "value": value,
                    "updated_at": now,
                },
            )
        else:
            stmt = sqlite_insert(economic_value_votes).values(
                use_case_id=use_case_id, department=department, voter=voter, value=value, updated_at=now
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=[economic_value_votes.c.use_case_id, economic_value_votes.c.department],
                set_={"voter": stmt.excluded.voter, "value": stmt.excluded.value, "updated_at": stmt.excluded.updated_at},
            )
            conn.execute(stmt)


def get_votes(use_case_id: str) -> list[dict]:
    with ENGINE.connect() as conn:
        return _all(
            conn,
            select(
                economic_value_votes.c.department,
                economic_value_votes.c.voter,
                economic_value_votes.c.value,
                economic_value_votes.c.updated_at,
            )
            .where(economic_value_votes.c.use_case_id == use_case_id)
            .order_by(economic_value_votes.c.department),
        )


def set_manual_rank(ordered_ids: list[str]) -> None:
    """Full replace: persists ordered_ids' order as 1-based manual_rank.
    Callers always pass the complete current board list."""
    with ENGINE.begin() as conn:
        for i, use_case_id in enumerate(ordered_ids, start=1):
            conn.execute(update(use_cases).where(use_cases.c.id == use_case_id).values(manual_rank=i))


def set_session_candidate(use_case_id: str, candidate: bool) -> None:
    """Writer-curated flag: is this use case in scope for the upcoming
    twice-yearly prioritization session? This - not an automatic score
    cutoff - is what determines board_candidates()'s contents."""
    with ENGINE.begin() as conn:
        conn.execute(update(use_cases).where(use_cases.c.id == use_case_id).values(is_session_candidate=candidate))


def set_status(use_case_id: str, status: str) -> None:
    with ENGINE.begin() as conn:
        conn.execute(update(use_cases).where(use_cases.c.id == use_case_id).values(status=status))


def board_candidates() -> list[dict]:
    """Board contents: exactly the use cases the writer has curated as
    session candidates (use_cases.is_session_candidate) - not an automatic
    top-N cutoff. Order: manual_rank ascending first (sticky - never dropped
    just because computed priority later shifts), un-ranked candidates by
    priority descending appended after."""
    all_cases = [uc for uc in list_use_cases() if uc["is_session_candidate"]]
    ranked = sorted((uc for uc in all_cases if uc["manual_rank"] is not None), key=lambda uc: uc["manual_rank"])
    unranked = sorted((uc for uc in all_cases if uc["manual_rank"] is None), key=lambda uc: uc["priority"], reverse=True)
    return ranked + unranked


def get_board_stage() -> str:
    with ENGINE.connect() as conn:
        row = _one(conn, select(board_state.c.stage).where(board_state.c.id == 1))
    return row["stage"]


def set_board_stage(stage: str) -> None:
    with ENGINE.begin() as conn:
        conn.execute(update(board_state).where(board_state.c.id == 1).values(stage=stage))


def finalize_board() -> None:
    """Director action closing out a prioritization session: every current
    candidate is stamped 'priorisiert' (unless already further along, i.e.
    'in_umsetzung' - never downgrade), then the candidate/rank state is
    cleared so the next twice-yearly cycle starts from an empty, freshly
    curated slate. One transaction."""
    with ENGINE.begin() as conn:
        candidate_ids = [
            r["id"] for r in _all(conn, select(use_cases.c.id).where(use_cases.c.is_session_candidate.is_(True)))
        ]
        if candidate_ids:
            conn.execute(
                update(use_cases)
                .where(use_cases.c.id.in_(candidate_ids), use_cases.c.status != "in_umsetzung")
                .values(status="priorisiert")
            )
            conn.execute(
                update(use_cases)
                .where(use_cases.c.id.in_(candidate_ids))
                .values(is_session_candidate=False, manual_rank=None)
            )
        conn.execute(update(board_state).where(board_state.c.id == 1).values(stage="prioboard"))