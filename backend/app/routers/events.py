"""Event endpoints (§15)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..schemas import (
    ChecklistItemOut,
    ChecklistItemUpdate,
    EventPlan,
    GeneratePlanRequest,
    PlanningOverviewOut,
    RegeneratePlanRequest,
    SavedEventListItemOut,
    SavedEventOut,
    SaveEventRequest,
    TimelineItemOut,
    TimelineItemUpdate,
)
from ..services import storage
from ..services.planner import generate_plan

router = APIRouter(prefix="/events", tags=["events"])


@router.post("/generate-plan", response_model=EventPlan)
async def generate(payload: GeneratePlanRequest) -> EventPlan:
    """§15.2 — validate, generate, validate output, recompute budget, return."""
    return await generate_plan(payload)


@router.post("/regenerate-plan", response_model=EventPlan)
async def regenerate(payload: RegeneratePlanRequest) -> EventPlan:
    """§15.3 — same pipeline, with an optional revision note."""
    return await generate_plan(payload, regeneration_note=payload.regeneration_note)


@router.get("/overview", response_model=PlanningOverviewOut)
def overview(db: Session = Depends(get_db)) -> PlanningOverviewOut:
    """Dashboard statistics from real saved data only (§7.3)."""
    return storage.planning_overview(db)


@router.post("", response_model=SavedEventOut, status_code=201)
def save(payload: SaveEventRequest, db: Session = Depends(get_db)) -> SavedEventOut:
    """§15.4"""
    row = storage.save_event(db, payload.event, payload.plan)
    return SavedEventOut(
        id=row.id,
        created_at=row.created_at,
        updated_at=row.updated_at,
        plan=storage.plan_from_row(row),
    )


@router.get("", response_model=list[SavedEventListItemOut])
def list_events(db: Session = Depends(get_db)) -> list[SavedEventListItemOut]:
    """§15.5"""
    return storage.list_saved_events(db)


@router.get("/{event_id}", response_model=SavedEventOut)
def get_event(event_id: str, db: Session = Depends(get_db)) -> SavedEventOut:
    return storage.get_saved_event(db, event_id)


@router.delete("/{event_id}", status_code=204)
def remove_event(event_id: str, db: Session = Depends(get_db)) -> None:
    storage.delete_event(db, event_id)


@router.patch(
    "/{event_id}/checklist/{item_id}",
    response_model=ChecklistItemOut,
)
def update_checklist_item(
    event_id: str,
    item_id: str,
    payload: ChecklistItemUpdate,
    db: Session = Depends(get_db),
) -> ChecklistItemOut:
    """§15.6"""
    return storage.set_checklist_completion(
        db, event_id, item_id, payload.is_completed
    )


@router.patch("/{event_id}/timeline/{item_id}", response_model=TimelineItemOut)
def update_timeline_item(
    event_id: str,
    item_id: str,
    payload: TimelineItemUpdate,
    db: Session = Depends(get_db),
) -> TimelineItemOut:
    return storage.set_timeline_completion(db, event_id, item_id, payload.is_completed)
