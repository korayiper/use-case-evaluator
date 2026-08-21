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

app = FastAPI(root_path="/ai-use-case-portfolio", title="AI Use Case Evaluator")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

db.init_db()


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
    economic_value: EconomicValue
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


@app.get("/api/me")
def api_me(request: Request):
    user = auth.get_current_user(request)
    return {"user": user, "is_writer": auth.is_writer(user)}


@app.get("/api/options")
def api_options():
    return scoring.options_payload()


@app.get("/api/use-cases")
def api_list_use_cases():
    return db.list_use_cases()


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
        economic_value=payload.economic_value.value,
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
        economic_value=payload.economic_value.value,
        golive_date=payload.golive_date.isoformat(),
        depends_on_ids=payload.depends_on,
    )
    return {"status": "updated"}


@app.delete("/api/use-cases/{use_case_id}")
def api_delete_use_case(use_case_id: str):
    if not db.get_use_case(use_case_id):
        raise HTTPException(status_code=404, detail="use case not found")
    db.delete_use_case(use_case_id)
    return {"status": "deleted"}