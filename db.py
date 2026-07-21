import sqlite3
from datetime import date, timedelta
from pathlib import Path

import scoring

DB_PATH = Path(__file__).parent / "usecases.db"

SCHEMA = """
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
);
"""


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with get_connection() as conn:
        conn.execute(SCHEMA)


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
):
    with get_connection() as conn:
        conn.execute(
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


def get_use_case(use_case_id: int) -> dict | None:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM use_cases WHERE id = ?", (use_case_id,)).fetchone()
    return _enrich(row) if row else None


def delete_use_case(use_case_id: int) -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM use_cases WHERE id = ?", (use_case_id,))


def _enrich(row: sqlite3.Row) -> dict:
    d = dict(row)
    months = scoring.development_months(d["development_time"])
    golive = date.fromisoformat(d["golive_date"])
    start = golive - timedelta(days=months * 30)  # approximate month length
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
    d["start_date"] = start.isoformat()
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
        rows = conn.execute("SELECT * FROM use_cases ORDER BY golive_date").fetchall()
    return [_enrich(row) for row in rows]