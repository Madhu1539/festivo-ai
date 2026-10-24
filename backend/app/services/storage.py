"""Saved-event persistence (§15.4-15.6, §16).

Stored amounts are re-totalled on read so the figures the user sees are always
produced by application code, never replayed from AI output (§13.2).
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..errors import NotFound
from ..models import (
    BudgetItem,
    ChecklistItem,
    Event,
    PersonalizedIdea,
    TimelineItem,
    new_id,
)
from ..schemas import (
    EVENT_TYPE_LABELS,
    BudgetCategoryOut,
    ChecklistItemOut,
    ChecklistProgressOut,
    EventInput,
    EventPlan,
    EventSummaryOut,
    EventType,
    IdeaOut,
    PlanningOverviewOut,
    SavedEventListItemOut,
    SavedEventOut,
    TimelineItemOut,
)
from .budget import derive_overview, progress_percent
from .timeline import ACCELERATED_THRESHOLD_DAYS

CENTS = Decimal("0.01")

_OPTIONAL_INPUT_FIELDS = (
    "venue_preference",
    "food_preference",
    "accessibility_needs",
    "cultural_preferences",
    "must_have_activities",
    "constraints",
)


def _dec(value: object) -> Decimal:
    try:
        return Decimal(str(value or 0)).quantize(CENTS, rounding=ROUND_HALF_UP)
    except Exception:
        return Decimal("0")


def _money(value: Decimal) -> float:
    return float(value.quantize(CENTS, rounding=ROUND_HALF_UP))


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------


def save_event(session: Session, event_input: EventInput, plan: EventPlan) -> Event:
    row = Event(
        id=new_id(),
        event_type=event_input.event_type,
        event_name=plan.event_summary.event_name,
        event_date=event_input.event_date,
        budget=_dec(plan.budget.total_budget),
        currency=event_input.currency,
        guest_count=event_input.guest_count,
        location=event_input.location,
        theme=event_input.theme,
        preferences=list(event_input.preferences),
        assumptions=list(plan.assumptions),
        warnings=list(plan.warnings),
        emergency_reserve=_dec(plan.budget.emergency_reserve),
        extra_inputs={
            **{
                field: getattr(event_input, field)
                for field in _OPTIONAL_INPUT_FIELDS
            },
            # Kept so reopening the plan still tells the user their category
            # amounts were fitted to the budget, rather than quietly presenting
            # rescaled figures as what the model proposed.
            "was_rescaled": bool(plan.budget.was_rescaled),
        },
    )

    for order, category in enumerate(plan.budget.categories):
        row.budget_items.append(
            BudgetItem(
                id=category.id or new_id(),
                category=category.category,
                estimated_amount=_dec(category.estimated_amount),
                description=category.description,
                is_reserve=category.is_reserve,
                sort_order=order,
            )
        )

    for item in plan.timeline:
        row.timeline_items.append(
            TimelineItem(
                id=item.id or new_id(),
                title=item.title,
                description=item.description,
                due_date=item.due_date,
                priority=item.priority,
                is_completed=item.is_completed,
                is_follow_up=item.is_follow_up,
            )
        )

    for order, item in enumerate(plan.vendor_checklist):
        row.checklist_items.append(
            ChecklistItem(
                id=item.id or new_id(),
                category=item.category,
                title=item.title,
                description=item.description,
                priority=item.priority,
                is_completed=item.is_completed,
                sort_order=order,
            )
        )

    for order, idea in enumerate(plan.personalized_ideas):
        row.ideas.append(
            PersonalizedIdea(
                id=idea.id or new_id(),
                category=idea.category,
                title=idea.title,
                description=idea.description,
                estimated_cost=(
                    _dec(idea.estimated_cost)
                    if idea.estimated_cost is not None
                    else None
                ),
                sort_order=order,
            )
        )

    session.add(row)
    # Commit before the response is produced, so the client is never told a
    # write succeeded before it is durable.
    session.commit()
    session.refresh(row)
    return row


def delete_event(session: Session, event_id: str) -> None:
    row = session.get(Event, event_id)
    if row is None:
        raise NotFound("That saved event no longer exists.")
    session.delete(row)
    session.commit()


def set_checklist_completion(
    session: Session, event_id: str, item_id: str, is_completed: bool
) -> ChecklistItemOut:
    item = session.get(ChecklistItem, item_id)
    if item is None or item.event_id != event_id:
        raise NotFound("That checklist item could not be found for this event.")
    item.is_completed = is_completed
    item.event.updated_at = datetime.now(UTC)
    session.commit()
    return _checklist_out(item)


def set_timeline_completion(
    session: Session, event_id: str, item_id: str, is_completed: bool
) -> TimelineItemOut:
    item = session.get(TimelineItem, item_id)
    if item is None or item.event_id != event_id:
        raise NotFound("That timeline task could not be found for this event.")
    item.is_completed = is_completed
    item.event.updated_at = datetime.now(UTC)
    session.commit()
    return _timeline_out(item)


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


def get_saved_event(session: Session, event_id: str) -> SavedEventOut:
    row = session.get(Event, event_id)
    if row is None:
        raise NotFound("That saved event no longer exists.")
    return SavedEventOut(
        id=row.id,
        created_at=row.created_at,
        updated_at=row.updated_at,
        plan=plan_from_row(row),
    )


def list_saved_events(session: Session) -> list[SavedEventListItemOut]:
    rows = session.scalars(select(Event).order_by(Event.created_at.desc())).all()
    today = date.today()
    items: list[SavedEventListItemOut] = []
    for row in rows:
        total = len(row.checklist_items)
        completed = sum(1 for i in row.checklist_items if i.is_completed)
        items.append(
            SavedEventListItemOut(
                id=row.id,
                event_type=_event_type(row.event_type),
                event_type_label=EVENT_TYPE_LABELS.get(
                    row.event_type, row.event_type.title()
                ),
                event_name=row.event_name or "Untitled event",
                event_date=row.event_date,
                location=row.location,
                budget=_money(_dec(row.budget)),
                currency=row.currency,
                guest_count=row.guest_count,
                days_until_event=(row.event_date - today).days,
                is_past=row.event_date < today,
                checklist_progress=ChecklistProgressOut(
                    total=total,
                    completed=completed,
                    percent=progress_percent(completed, total),
                ),
                created_at=row.created_at,
            )
        )
    return items


def planning_overview(session: Session) -> PlanningOverviewOut:
    today = date.today()
    total = session.scalar(select(func.count()).select_from(Event)) or 0
    if total == 0:
        return PlanningOverviewOut(persistence_enabled=True)

    upcoming = (
        session.scalar(
            select(func.count()).select_from(Event).where(Event.event_date >= today)
        )
        or 0
    )
    budget_sum = session.scalar(select(func.sum(Event.budget))) or 0

    currency = (
        session.scalar(select(Event.currency).order_by(Event.created_at.desc()).limit(1))
        or "INR"
    )

    checklist_total = (
        session.scalar(select(func.count()).select_from(ChecklistItem)) or 0
    )
    checklist_done = (
        session.scalar(
            select(func.count())
            .select_from(ChecklistItem)
            .where(ChecklistItem.is_completed.is_(True))
        )
        or 0
    )

    return PlanningOverviewOut(
        persistence_enabled=True,
        total_events=int(total),
        upcoming_events=int(upcoming),
        total_planned_budget=_money(_dec(budget_sum)),
        currency=currency,
        average_progress=progress_percent(int(checklist_done), int(checklist_total)),
    )


def event_input_from_row(row: Event) -> EventInput:
    """Rebuild the original input so a saved plan can be regenerated (§15.3)."""
    extra = row.extra_inputs or {}
    return EventInput(
        event_type=_event_type(row.event_type),
        event_name=row.event_name,
        # A saved event may now be in the past; clamp so input validation passes.
        event_date=max(row.event_date, date.today()),
        budget=_money(_dec(row.budget)),
        currency=row.currency,
        guest_count=row.guest_count,
        location=row.location,
        theme=row.theme,
        preferences=list(row.preferences or []),
        **{
            field: extra.get(field)
            for field in _OPTIONAL_INPUT_FIELDS
            if extra.get(field)
        },
    )


def plan_from_row(row: Event) -> EventPlan:
    """Reconstruct a plan, re-deriving every total locally."""
    today = date.today()
    budget_total = _dec(row.budget)

    # Categories are rebuilt from the stored rows; every total is then derived
    # by the same function the generation path uses, so a saved plan can never
    # show different figures from the plan that was just generated.
    categories = [
        BudgetCategoryOut(
            id=item.id,
            category=item.category,
            estimated_amount=_money(_dec(item.estimated_amount)),
            description=item.description,
            is_reserve=item.is_reserve,
            percent_of_budget=0.0,  # Set by derive_overview.
        )
        for item in sorted(
            row.budget_items, key=lambda b: (b.is_reserve, b.sort_order)
        )
    ]

    budget = derive_overview(
        currency=row.currency,
        budget=budget_total,
        guest_count=row.guest_count,
        categories=categories,
        # Any rescaling happened before the plan was stored; the stored
        # amounts are already the final ones.
        was_rescaled=bool(row.extra_inputs and row.extra_inputs.get("was_rescaled")),
    )

    timeline = sorted(
        (_timeline_out(i) for i in row.timeline_items),
        key=lambda i: (i.is_follow_up, i.due_date, i.title),
    )
    checklist = [
        _checklist_out(i)
        for i in sorted(row.checklist_items, key=lambda i: i.sort_order)
    ]
    ideas = [
        IdeaOut(
            id=i.id,
            category=i.category,
            title=i.title,
            description=i.description,
            estimated_cost=(
                _money(_dec(i.estimated_cost)) if i.estimated_cost is not None else None
            ),
        )
        for i in sorted(row.ideas, key=lambda i: i.sort_order)
    ]

    days_until = (row.event_date - today).days
    stored_extra = row.extra_inputs or {}
    summary = EventSummaryOut(
        event_type=_event_type(row.event_type),
        event_type_label=EVENT_TYPE_LABELS.get(row.event_type, row.event_type.title()),
        event_name=row.event_name or "Untitled event",
        event_date=row.event_date,
        location=row.location,
        guest_count=row.guest_count,
        budget=_money(budget_total),
        currency=row.currency,
        theme=row.theme,
        preferences=list(row.preferences or []),
        days_until_event=days_until,
        budget_per_guest=budget.budget_per_guest,
        is_accelerated=0 <= days_until <= ACCELERATED_THRESHOLD_DAYS,
        # Echo the stored optional requirements so the client can offer an
        # accurate edit/regenerate without silently dropping them.
        **{field: stored_extra.get(field) for field in _OPTIONAL_INPUT_FIELDS},
    )

    return EventPlan(
        event_summary=summary,
        budget=budget,
        timeline=timeline,
        vendor_checklist=checklist,
        personalized_ideas=ideas,
        assumptions=list(row.assumptions or []),
        warnings=list(row.warnings or []),
        generated_at=row.created_at,
    )


def _timeline_out(item: TimelineItem) -> TimelineItemOut:
    return TimelineItemOut(
        id=item.id,
        title=item.title,
        description=item.description,
        due_date=item.due_date,
        priority=item.priority,  # type: ignore[arg-type]
        is_completed=item.is_completed,
        is_overdue=(not item.is_completed) and item.due_date < date.today(),
        is_follow_up=item.is_follow_up,
    )


def _checklist_out(item: ChecklistItem) -> ChecklistItemOut:
    return ChecklistItemOut(
        id=item.id,
        category=item.category,
        title=item.title,
        description=item.description,
        priority=item.priority,  # type: ignore[arg-type]
        is_completed=item.is_completed,
    )


def _event_type(value: str) -> EventType:
    return value if value in EVENT_TYPE_LABELS else "community"  # type: ignore[return-value]
