"""Saved-event persistence (§15.4-15.6, §16).

Stored amounts are re-totalled on read so the figures the user sees are always
produced by application code, never replayed from AI output (§13.2).
"""

from __future__ import annotations

from datetime import UTC, date, datetime

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
    BudgetOverviewOut,
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
from .money import to_decimal, to_float
from .timeline import is_accelerated_in

_OPTIONAL_INPUT_FIELDS = (
    "venue_preference",
    "food_preference",
    "accessibility_needs",
    "cultural_preferences",
    "must_have_activities",
    "constraints",
)


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------


def _event_row(event_input: EventInput, plan: EventPlan) -> Event:
    """The parent row. Child collections are attached by the builders below."""
    return Event(
        id=new_id(),
        event_type=event_input.event_type,
        event_name=plan.event_summary.event_name,
        event_date=event_input.event_date,
        budget=to_decimal(plan.budget.total_budget),
        currency=event_input.currency,
        guest_count=event_input.guest_count,
        location=event_input.location,
        theme=event_input.theme,
        preferences=list(event_input.preferences),
        assumptions=list(plan.assumptions),
        warnings=list(plan.warnings),
        emergency_reserve=to_decimal(plan.budget.emergency_reserve),
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


def _budget_rows(plan: EventPlan) -> list[BudgetItem]:
    return [
        BudgetItem(
            id=category.id or new_id(),
            category=category.category,
            estimated_amount=to_decimal(category.estimated_amount),
            description=category.description,
            is_reserve=category.is_reserve,
            sort_order=order,
        )
        for order, category in enumerate(plan.budget.categories)
    ]


def _timeline_rows(plan: EventPlan) -> list[TimelineItem]:
    # No sort_order: timeline items are ordered by due_date on read, not by
    # their position in the generated list.
    return [
        TimelineItem(
            id=item.id or new_id(),
            title=item.title,
            description=item.description,
            due_date=item.due_date,
            priority=item.priority,
            is_completed=item.is_completed,
            is_follow_up=item.is_follow_up,
        )
        for item in plan.timeline
    ]


def _checklist_rows(plan: EventPlan) -> list[ChecklistItem]:
    return [
        ChecklistItem(
            id=item.id or new_id(),
            category=item.category,
            title=item.title,
            description=item.description,
            priority=item.priority,
            is_completed=item.is_completed,
            sort_order=order,
        )
        for order, item in enumerate(plan.vendor_checklist)
    ]


def _idea_rows(plan: EventPlan) -> list[PersonalizedIdea]:
    return [
        PersonalizedIdea(
            id=idea.id or new_id(),
            category=idea.category,
            title=idea.title,
            description=idea.description,
            estimated_cost=(
                to_decimal(idea.estimated_cost)
                if idea.estimated_cost is not None
                else None
            ),
            sort_order=order,
        )
        for order, idea in enumerate(plan.personalized_ideas)
    ]


def save_event(
    session: Session, event_input: EventInput, plan: EventPlan, user_id: str
) -> Event:
    row = _event_row(event_input, plan)
    row.user_id = user_id
    row.budget_items.extend(_budget_rows(plan))
    row.timeline_items.extend(_timeline_rows(plan))
    row.checklist_items.extend(_checklist_rows(plan))
    row.ideas.extend(_idea_rows(plan))

    session.add(row)
    # Commit before the response is produced, so the client is never told a
    # write succeeded before it is durable.
    session.commit()
    session.refresh(row)
    return row


def _owned_event(session: Session, event_id: str, user_id: str) -> Event:
    """Fetch an event the caller owns, or raise NotFound.

    The single place ownership is decided, so no endpoint can forget it.

    Someone else's event raises NotFound rather than a 403 on purpose: a 403
    confirms the id exists, which turns a failed guess into a positive signal
    and makes the id space worth probing. "Not found" is also simply true from
    the caller's position - it is not an event they have.
    """
    row = session.get(Event, event_id)
    if row is None or row.user_id != user_id:
        raise NotFound("That saved event no longer exists.")
    return row


def delete_event(session: Session, event_id: str, user_id: str) -> None:
    session.delete(_owned_event(session, event_id, user_id))
    session.commit()


def set_checklist_completion(
    session: Session,
    event_id: str,
    item_id: str,
    is_completed: bool,
    user_id: str,
) -> ChecklistItemOut:
    # Ownership is checked on the parent event first, so an item id belonging
    # to someone else's event cannot be toggled by guessing it.
    _owned_event(session, event_id, user_id)
    item = session.get(ChecklistItem, item_id)
    if item is None or item.event_id != event_id:
        raise NotFound("That checklist item could not be found for this event.")
    item.is_completed = is_completed
    item.event.updated_at = datetime.now(UTC)
    session.commit()
    return _checklist_out(item)


def set_timeline_completion(
    session: Session,
    event_id: str,
    item_id: str,
    is_completed: bool,
    user_id: str,
) -> TimelineItemOut:
    _owned_event(session, event_id, user_id)
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


def get_saved_event(session: Session, event_id: str, user_id: str) -> SavedEventOut:
    row = _owned_event(session, event_id, user_id)
    return SavedEventOut(
        id=row.id,
        created_at=row.created_at,
        updated_at=row.updated_at,
        plan=plan_from_row(row),
    )


def list_saved_events(
    session: Session, user_id: str
) -> list[SavedEventListItemOut]:
    rows = session.scalars(
        select(Event)
        .where(Event.user_id == user_id)
        .order_by(Event.created_at.desc())
    ).all()
    today = date.today()
    items: list[SavedEventListItemOut] = []
    for row in rows:
        total = len(row.checklist_items)
        completed = sum(1 for i in row.checklist_items if i.is_completed)
        items.append(
            SavedEventListItemOut(
                id=row.id,
                event_type=_event_type(row.event_type),
                event_type_label=_event_type_label(row.event_type),
                event_name=row.event_name or "Untitled event",
                event_date=row.event_date,
                location=row.location,
                budget=to_float(to_decimal(row.budget)),
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


def planning_overview(session: Session, user_id: str) -> PlanningOverviewOut:
    """Dashboard figures for one account.

    Every aggregate here is owner-scoped. The checklist counts have to reach
    the owner through a join, because `checklist_items` only knows its
    `event_id` - filtering it directly is not possible, and omitting the join
    would total up every account's checklists into one number.
    """
    today = date.today()
    mine = Event.user_id == user_id

    total = session.scalar(select(func.count()).select_from(Event).where(mine)) or 0
    if total == 0:
        return PlanningOverviewOut(persistence_enabled=True)

    upcoming = (
        session.scalar(
            select(func.count())
            .select_from(Event)
            .where(mine, Event.event_date >= today)
        )
        or 0
    )
    budget_sum = session.scalar(select(func.sum(Event.budget)).where(mine)) or 0

    currency = (
        session.scalar(
            select(Event.currency)
            .where(mine)
            .order_by(Event.created_at.desc())
            .limit(1)
        )
        or "INR"
    )

    owned_checklist = (
        select(func.count())
        .select_from(ChecklistItem)
        .join(Event, ChecklistItem.event_id == Event.id)
        .where(mine)
    )
    checklist_total = session.scalar(owned_checklist) or 0
    checklist_done = (
        session.scalar(owned_checklist.where(ChecklistItem.is_completed.is_(True))) or 0
    )

    return PlanningOverviewOut(
        persistence_enabled=True,
        total_events=int(total),
        upcoming_events=int(upcoming),
        total_planned_budget=to_float(to_decimal(budget_sum)),
        currency=currency,
        average_progress=progress_percent(int(checklist_done), int(checklist_total)),
    )


def plan_from_row(row: Event) -> EventPlan:
    """Reconstruct a plan, re-deriving every total locally."""
    today = date.today()
    budget_total = to_decimal(row.budget)

    # Categories are rebuilt from the stored rows; every total is then derived
    # by the same function the generation path uses, so a saved plan can never
    # show different figures from the plan that was just generated.
    categories = [
        BudgetCategoryOut(
            id=item.id,
            category=item.category,
            estimated_amount=to_float(to_decimal(item.estimated_amount)),
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
        _idea_out(i) for i in sorted(row.ideas, key=lambda i: i.sort_order)
    ]

    days_until = (row.event_date - today).days
    summary = _summary_from_row(row, budget, days_until)

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


def _summary_from_row(
    row: Event, budget: BudgetOverviewOut, days_until: int
) -> EventSummaryOut:
    stored_extra = row.extra_inputs or {}
    return EventSummaryOut(
        event_type=_event_type(row.event_type),
        event_type_label=_event_type_label(row.event_type),
        event_name=row.event_name or "Untitled event",
        event_date=row.event_date,
        location=row.location,
        guest_count=row.guest_count,
        budget=budget.total_budget,
        currency=row.currency,
        theme=row.theme,
        preferences=list(row.preferences or []),
        days_until_event=days_until,
        budget_per_guest=budget.budget_per_guest,
        is_accelerated=is_accelerated_in(days_until),
        # Echo the stored optional requirements so the client can offer an
        # accurate edit/regenerate without silently dropping them.
        **{field: stored_extra.get(field) for field in _OPTIONAL_INPUT_FIELDS},
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


def _idea_out(item: PersonalizedIdea) -> IdeaOut:
    return IdeaOut(
        id=item.id,
        category=item.category,
        title=item.title,
        description=item.description,
        # None and zero are different things here: None means the model gave no
        # estimate, which the UI renders differently from "free".
        estimated_cost=(
            to_float(to_decimal(item.estimated_cost))
            if item.estimated_cost is not None
            else None
        ),
    )


def _event_type(value: str) -> EventType:
    return value if value in EVENT_TYPE_LABELS else "community"  # type: ignore[return-value]


def _event_type_label(value: str) -> str:
    """The label for a stored event type, derived from the coerced type.

    Going through `_event_type` matters: labelling the raw column instead
    would let a row come back as type "community" labelled "Gala", which is
    self-contradicting output rather than a graceful fallback.
    """
    return EVENT_TYPE_LABELS[_event_type(value)]
