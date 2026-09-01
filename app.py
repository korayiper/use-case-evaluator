import time
from datetime import date
from enum import Enum

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field
from starlette.requests import Request

import auth
import db
import scoring
from config import settings

app = FastAPI(root_path="/ai-use-case-portfolio", title="AI Use Case Evaluator")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")
# Cache-busting query param for every static asset link, stamped once per
# process start - since a deploy is always a restart, this guarantees every
# browser fetches fresh CSS/JS after a deploy instead of serving a stale
# cached copy of a same-named file (what just happened in manual testing).
templates.env.globals["static_version"] = str(int(time.time()))


def _str_enum(name: str, keys) -> type[Enum]:
    members = {k.upper().replace(" ", "_").replace("-", "_"): k for k in keys}
    return Enum(name, members, type=str)


ValueAdded = _str_enum("ValueAdded", scoring.VALUE_ADDED.keys())
DevelopmentTime = _str_enum("DevelopmentTime", scoring.DEVELOPMENT_TIME.keys())
ProcessCriticality = _str_enum("ProcessCriticality", scoring.PROCESS_CRITICALITY.keys())
ProcessDependency = _str_enum("ProcessDependency", scoring.PROCESS_DEPENDENCY.keys())
UseCategory = _str_enum("UseCategory", scoring.USE_CATEGORY.keys())
AiFeasibility = _str_enum("AiFeasibility", scoring.AI_FEASIBILITY.keys())
EconomicValue = _str_enum("EconomicValue", scoring.ECONOMIC_VALUE.keys())


class UseCaseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    idea_initiator: str = Field(min_length=1, max_length=200)
    description: str = ""
    value_added_description: str = ""
    use_category: UseCategory
    ai_feasibility: AiFeasibility
    value_added: ValueAdded
    development_time: DevelopmentTime
    process_criticality: ProcessCriticality
    process_dependency: ProcessDependency
    # Never entered by the use case manager - set only via department votes
    # (see PUT /api/use-cases/{id}/vote). Optional here purely so creation
    # doesn't require it; db._enrich() treats a vote-less use case as
    # unscored (0 points, "Ausstehend") regardless of what's stored here.
    economic_value: EconomicValue | None = None
    golive_date: date
    depends_on: list[str] = Field(default_factory=list)


def _validate_dependencies(use_case_id: str | None, depends_on_ids: list[str]) -> None:
    if use_case_id is not None and use_case_id in depends_on_ids:
        raise HTTPException(status_code=400, detail="Ein Anwendungsfall kann nicht von sich selbst abhängen.")
    if len(set(depends_on_ids)) != len(depends_on_ids):
        raise HTTPException(status_code=400, detail="Abhängigkeiten dürfen nicht doppelt angegeben werden.")
    unknown = set(depends_on_ids) - db.existing_ids()
    if unknown:
        raise HTTPException(
            status_code=400,
            detail=f"Unbekannte Abhängigkeit(en): {', '.join(str(i) for i in sorted(unknown))}",
        )
    if db.has_cycle(use_case_id, depends_on_ids):
        raise HTTPException(status_code=400, detail="Diese Abhängigkeit würde einen Zyklus erzeugen.")


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse(request, "index.html")


@app.get("/use-case/{use_case_id}", response_class=HTMLResponse)
def use_case_detail(request: Request, use_case_id: str):
    if not db.get_use_case(use_case_id):
        raise HTTPException(status_code=404, detail="use case not found")
    return templates.TemplateResponse(request, "use_case.html")


@app.get("/board", response_class=HTMLResponse)
def board_page(request: Request):
    return templates.TemplateResponse(request, "board.html")


@app.get("/prioritized-print", response_class=HTMLResponse)
def prioritized_print_page(request: Request):
    return templates.TemplateResponse(request, "prioritized_print.html")


@app.get("/api/me")
def api_me(request: Request):
    user = auth.get_current_user(request)
    return {
        "user": user,
        "is_writer": auth.is_writer(user),
        "is_prioboard": auth.is_prioboard(user),
        "departments": auth.departments_for(user),
        "is_director": auth.is_director(user),
    }


@app.get("/api/options")
def api_options():
    return scoring.options_payload()


@app.get("/api/use-cases")
def api_list_use_cases():
    return db.list_use_cases()


@app.get("/api/use-cases/{use_case_id}")
def api_get_use_case(use_case_id: str):
    uc = db.get_use_case(use_case_id)
    if not uc:
        raise HTTPException(status_code=404, detail="use case not found")
    dependents = db.get_dependents(use_case_id)
    uc["dependent_ids"] = [d["id"] for d in dependents]
    uc["dependent_names"] = [d["name"] for d in dependents]
    return uc


@app.get("/api/use-cases/{use_case_id}/votes")
def api_get_votes(use_case_id: str):
    if not db.get_use_case(use_case_id):
        raise HTTPException(status_code=404, detail="use case not found")
    votes = db.get_votes(use_case_id)
    voted_departments = {v["department"] for v in votes}
    return {
        "votes": votes,
        "missing_departments": [d for d in auth.DEPARTMENTS if d not in voted_departments],
    }


class VoteCreate(BaseModel):
    value: EconomicValue
    # Required, not inferred: a user may represent more than one department
    # (auth.departments_for), so the client has to say which seat this vote
    # is being cast for.
    department: str


# auth.require_prioboard is referenced twice below (once as the route gate,
# once to retrieve *who* voted) - FastAPI caches dependency results within a
# request, so it only runs once per request.
@app.put("/api/use-cases/{use_case_id}/vote", dependencies=[Depends(auth.require_prioboard)])
def api_submit_vote(use_case_id: str, payload: VoteCreate, user: str = Depends(auth.require_prioboard)):
    if not db.get_use_case(use_case_id):
        raise HTTPException(status_code=404, detail="use case not found")
    if payload.department not in auth.departments_for(user):
        raise HTTPException(status_code=403, detail="Sie vertreten diese Abteilung nicht.")
    db.upsert_vote(use_case_id, payload.department, user, payload.value.value)
    return {"status": "voted"}


class ImportantUpdate(BaseModel):
    department: str
    important: bool


@app.put("/api/use-cases/{use_case_id}/important", dependencies=[Depends(auth.require_prioboard)])
def api_set_important(use_case_id: str, payload: ImportantUpdate, user: str = Depends(auth.require_prioboard)):
    if not db.get_use_case(use_case_id):
        raise HTTPException(status_code=404, detail="use case not found")
    if payload.department not in auth.departments_for(user):
        raise HTTPException(status_code=403, detail="Sie vertreten diese Abteilung nicht.")
    limit = settings.get("important_limit", 15)
    if (
        payload.important
        and not db.is_marked_important(use_case_id, payload.department)
        and db.count_important_marks(payload.department) >= limit
    ):
        raise HTTPException(
            status_code=400,
            detail=f"Maximal {limit} wichtige Anwendungsfälle pro Abteilung - bitte zuerst einen anderen entfernen.",
        )
    db.set_important(use_case_id, payload.department, payload.important, user)
    return {"status": "updated"}


@app.get("/api/board")
def api_board():
    return {"stage": db.get_board_stage(), "use_cases": db.board_candidates()}


class SessionCandidateUpdate(BaseModel):
    candidate: bool


@app.put("/api/use-cases/{use_case_id}/session-candidate", dependencies=[Depends(auth.require_writer)])
def api_set_session_candidate(use_case_id: str, payload: SessionCandidateUpdate):
    if not db.get_use_case(use_case_id):
        raise HTTPException(status_code=404, detail="use case not found")
    db.set_session_candidate(use_case_id, payload.candidate)
    return {"status": "updated"}


class StatusUpdate(BaseModel):
    status: str


# Any writer may set any status in any direction, including backward (e.g.
# undoing "in Umsetzung", or un-prioritizing something) - matches the same
# "trust the writer's judgment" stance already used for session-candidate
# curation elsewhere. "priorisiert" is still normally reached only via
# /api/board/finalize; this is the manual-correction escape hatch, not the
# intended everyday path there.
@app.put("/api/use-cases/{use_case_id}/status", dependencies=[Depends(auth.require_writer)])
def api_set_status(use_case_id: str, payload: StatusUpdate):
    if not db.get_use_case(use_case_id):
        raise HTTPException(status_code=404, detail="use case not found")
    if payload.status not in scoring.STATUS_LABELS:
        raise HTTPException(status_code=400, detail="Ungültiger Status.")
    db.set_status(use_case_id, payload.status)
    return {"status": "updated"}


class ReorderRequest(BaseModel):
    ordered_ids: list[str] = Field(min_length=1)


@app.put("/api/board/reorder", dependencies=[Depends(auth.require_board_reorder)])
def api_reorder_board(payload: ReorderRequest):
    unknown = set(payload.ordered_ids) - db.existing_ids()
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unbekannte ID(en): {', '.join(sorted(unknown))}")
    db.set_manual_rank(payload.ordered_ids)
    return {"status": "reordered"}


@app.put("/api/board/handoff", dependencies=[Depends(auth.require_prioboard)])
def api_board_handoff():
    if db.get_board_stage() != "prioboard":
        raise HTTPException(status_code=400, detail="Die Priorisierung wurde bereits an die GL übergeben.")
    db.set_board_stage("board_of_management")
    return {"status": "handed_off"}


@app.put("/api/board/finalize", dependencies=[Depends(auth.require_director)])
def api_board_finalize():
    if db.get_board_stage() != "board_of_management":
        raise HTTPException(status_code=400, detail="Das Prio-Board muss zuerst übergeben, bevor final entschieden werden kann.")
    db.finalize_board()
    return {"status": "finalized"}


@app.post("/api/use-cases", status_code=201, dependencies=[Depends(auth.require_writer)])
def api_create_use_case(payload: UseCaseCreate):
    _validate_dependencies(None, payload.depends_on)
    db.add_use_case(
        name=payload.name,
        idea_initiator=payload.idea_initiator,
        description=payload.description,
        value_added_description=payload.value_added_description,
        use_category=payload.use_category.value,
        ai_feasibility=payload.ai_feasibility.value,
        value_added=payload.value_added.value,
        development_time=payload.development_time.value,
        process_criticality=payload.process_criticality.value,
        process_dependency=payload.process_dependency.value,
        economic_value=payload.economic_value.value if payload.economic_value else None,
        golive_date=payload.golive_date.isoformat(),
        depends_on_ids=payload.depends_on,
    )
    return {"status": "created"}


@app.put("/api/use-cases/{use_case_id}", dependencies=[Depends(auth.require_writer)])
def api_update_use_case(use_case_id: str, payload: UseCaseCreate):
    if not db.get_use_case(use_case_id):
        raise HTTPException(status_code=404, detail="use case not found")
    _validate_dependencies(use_case_id, payload.depends_on)
    db.update_use_case(
        use_case_id,
        name=payload.name,
        idea_initiator=payload.idea_initiator,
        description=payload.description,
        value_added_description=payload.value_added_description,
        use_category=payload.use_category.value,
        ai_feasibility=payload.ai_feasibility.value,
        value_added=payload.value_added.value,
        development_time=payload.development_time.value,
        process_criticality=payload.process_criticality.value,
        process_dependency=payload.process_dependency.value,
        economic_value=payload.economic_value.value if payload.economic_value else None,
        golive_date=payload.golive_date.isoformat(),
        depends_on_ids=payload.depends_on,
    )
    return {"status": "updated"}


@app.delete("/api/use-cases/{use_case_id}", dependencies=[Depends(auth.require_writer)])
def api_delete_use_case(use_case_id: str):
    if not db.get_use_case(use_case_id):
        raise HTTPException(status_code=404, detail="use case not found")
    db.delete_use_case(use_case_id)
    return {"status": "deleted"}