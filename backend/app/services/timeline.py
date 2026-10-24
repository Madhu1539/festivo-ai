"""Timeline generation engine (§10).

The model proposes tasks and dates; this module validates them. Dates are
parsed strictly, ordered chronologically, flagged as overdue when their
deadline has passed, and kept at or before the event date unless the model
explicitly marked them as follow-up activities (§10.3).
"""

from __future__ import annotations

from datetime import date, datetime

from ..models import new_id
from ..schemas import AITimelineItem, EventInput, TimelineItemOut

# An event closer than this needs a compressed schedule (§10.3).
ACCELERATED_THRESHOLD_DAYS = 14

_DATE_FORMATS = (
    "%Y-%m-%d",
    "%d-%m-%Y",
    "%d/%m/%Y",
    "%Y/%m/%d",
    "%d %B %Y",
    "%d %b %Y",
    "%B %d, %Y",
    "%b %d, %Y",
)


def is_accelerated(event: EventInput) -> bool:
    return event.days_until_event <= ACCELERATED_THRESHOLD_DAYS


def parse_date(value: object) -> date | None:
    """Parse an AI-supplied date. Returns None when unusable."""
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if not isinstance(value, str):
        return None

    text = value.strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        pass
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def build_timeline(
    event: EventInput, items: list[AITimelineItem]
) -> tuple[list[TimelineItemOut], list[str]]:
    warnings: list[str] = []
    today = date.today()
    event_date = event.event_date

    parsed: list[TimelineItemOut] = []
    invalid_dates = 0
    clamped = 0
    seen_titles: set[str] = set()

    for raw in items:
        title = (raw.title or "").strip()
        if not title:
            continue

        key = title.lower()
        if key in seen_titles:
            continue
        seen_titles.add(key)

        due = parse_date(raw.due_date)
        if due is None:
            invalid_dates += 1
            continue

        is_follow_up = bool(raw.is_follow_up)
        if due > event_date:
            if is_follow_up:
                pass  # Legitimately after the event.
            else:
                # A preparation task must not fall after the event (§10.3).
                due = event_date
                clamped += 1
        elif due < today:
            # Deadline already passed — surfaced as overdue, not as a future date.
            pass

        parsed.append(
            TimelineItemOut(
                id=new_id(),
                title=title,
                description=raw.description,
                due_date=due,
                priority=raw.priority,
                is_completed=False,
                is_overdue=due < today,
                is_follow_up=is_follow_up,
            )
        )

    # Chronological order; follow-up activities always sort last (§10.3).
    parsed.sort(key=lambda i: (i.is_follow_up, i.due_date, i.title))

    if invalid_dates:
        warnings.append(
            f"{invalid_dates} timeline "
            f"{'task was' if invalid_dates == 1 else 'tasks were'} dropped because "
            "the generated due date could not be read."
        )
    if clamped:
        warnings.append(
            f"{clamped} timeline "
            f"{'task was' if clamped == 1 else 'tasks were'} scheduled after the "
            f"event date and {'has' if clamped == 1 else 'have'} been moved to "
            "the event date."
        )

    overdue = sum(1 for i in parsed if i.is_overdue)
    if overdue:
        warnings.append(
            f"{overdue} {'task is' if overdue == 1 else 'tasks are'} already overdue "
            "based on today's date. Treat them as immediate priorities."
        )
    if not parsed:
        warnings.append(
            "No valid timeline tasks were generated. Try regenerating the plan."
        )
    elif is_accelerated(event):
        warnings.append(
            f"Your event is {event.days_until_event} "
            f"{'day' if event.days_until_event == 1 else 'days'} away, so this is an "
            "accelerated schedule with compressed deadlines."
        )

    return parsed, warnings
