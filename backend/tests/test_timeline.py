"""Timeline engine tests (§20.3)."""

from __future__ import annotations

from datetime import date, timedelta

from app.schemas import AITimelineItem
from app.services.timeline import (
    ACCELERATED_THRESHOLD_DAYS,
    build_timeline,
    is_accelerated,
    is_accelerated_in,
    parse_date,
)


def item(title, due_date, **kwargs):
    return AITimelineItem(title=title, due_date=due_date, **kwargs)


def test_valid_dates_are_sorted_chronologically(event_input):
    event = event_input()
    today = date.today()
    items = [
        item("Third", (today + timedelta(days=30)).isoformat()),
        item("First", (today + timedelta(days=5)).isoformat()),
        item("Second", (today + timedelta(days=12)).isoformat()),
    ]
    timeline, _ = build_timeline(event, items)

    assert [t.title for t in timeline] == ["First", "Second", "Third"]
    assert timeline == sorted(timeline, key=lambda t: (t.is_follow_up, t.due_date, t.title))


def test_invalid_dates_are_dropped_with_a_warning(event_input):
    timeline, warnings = build_timeline(
        event_input(),
        [item("Good", (date.today() + timedelta(days=5)).isoformat()),
         item("Bad", "not a date"),
         item("Also bad", "2026-13-45")],
    )

    assert [t.title for t in timeline] == ["Good"]
    assert any("could not be read" in w for w in warnings)


def test_task_after_event_date_is_clamped(event_input):
    """§10.3 — preparation tasks must not fall after the event."""
    event = event_input()
    timeline, warnings = build_timeline(
        event, [item("Late prep", (event.event_date + timedelta(days=5)).isoformat())]
    )

    assert timeline[0].due_date == event.event_date
    assert timeline[0].is_follow_up is False
    assert any("moved to the event date" in w for w in warnings)


def test_follow_up_task_may_fall_after_the_event(event_input):
    event = event_input()
    due = event.event_date + timedelta(days=3)
    timeline, _ = build_timeline(
        event, [item("Return rentals", due.isoformat(), is_follow_up=True)]
    )

    assert timeline[0].due_date == due
    assert timeline[0].is_follow_up is True


def test_follow_up_tasks_sort_last(event_input):
    event = event_input()
    timeline, _ = build_timeline(
        event,
        [
            item("Thank-you notes", (event.event_date + timedelta(days=2)).isoformat(),
                 is_follow_up=True),
            item("Host the event", event.event_date.isoformat()),
        ],
    )
    assert [t.title for t in timeline] == ["Host the event", "Thank-you notes"]


def test_past_deadline_is_flagged_overdue_not_future(event_input):
    """§10.3 — explain overdue rather than presenting it as upcoming."""
    timeline, warnings = build_timeline(
        event_input(),
        [item("Missed task", (date.today() - timedelta(days=4)).isoformat())],
    )

    assert timeline[0].is_overdue is True
    assert any("overdue" in w for w in warnings)


def test_future_task_is_not_overdue(event_input):
    timeline, _ = build_timeline(
        event_input(), [item("Upcoming", (date.today() + timedelta(days=4)).isoformat())]
    )
    assert timeline[0].is_overdue is False


def test_duplicate_titles_are_removed(event_input):
    today = date.today()
    timeline, _ = build_timeline(
        event_input(),
        [item("Book cake", (today + timedelta(days=4)).isoformat()),
         item("book CAKE", (today + timedelta(days=9)).isoformat())],
    )
    assert len(timeline) == 1


def test_close_event_produces_accelerated_warning(event_input):
    """§10.3 — compressed schedule when there is little time."""
    event = event_input(event_date=date.today() + timedelta(days=3))
    assert is_accelerated(event) is True

    _, warnings = build_timeline(
        event, [item("Rush order", (date.today() + timedelta(days=1)).isoformat())]
    )
    assert any("accelerated" in w for w in warnings)


def test_distant_event_is_not_accelerated(event_input):
    assert is_accelerated(event_input(event_date=date.today() + timedelta(days=90))) is False


def test_same_day_event_is_accelerated(event_input):
    event = event_input(event_date=date.today())
    assert is_accelerated(event) is True

    timeline, _ = build_timeline(event, [item("Set up", date.today().isoformat())])
    assert timeline[0].due_date == date.today()
    assert timeline[0].is_overdue is False


def test_empty_timeline_warns(event_input):
    timeline, warnings = build_timeline(event_input(), [])
    assert timeline == []
    assert any("No valid timeline tasks" in w for w in warnings)


def test_untitled_tasks_are_skipped(event_input):
    timeline, _ = build_timeline(
        event_input(), [item(" ", (date.today() + timedelta(days=2)).isoformat())]
    )
    assert timeline == []


def test_priority_is_normalized(event_input):
    """Unexpected priority values fall back to medium rather than failing."""
    assert AITimelineItem(title="A", due_date="2026-01-01", priority="CRITICAL").priority == "high"
    assert AITimelineItem(title="B", due_date="2026-01-01", priority="whatever").priority == "medium"
    assert AITimelineItem(title="C", due_date="2026-01-01", priority="optional").priority == "low"


def test_parse_date_accepts_common_formats():
    assert parse_date("2026-11-15") == date(2026, 11, 15)
    assert parse_date("15-11-2026") == date(2026, 11, 15)
    assert parse_date("15 November 2026") == date(2026, 11, 15)
    assert parse_date("November 15, 2026") == date(2026, 11, 15)
    assert parse_date("2026-11-15T10:00:00Z") == date(2026, 11, 15)
    assert parse_date("tomorrow") is None
    assert parse_date(None) is None
    assert parse_date(42) is None


# --- The accelerated rule has one definition -----------------------------


def test_accelerated_is_bounded_at_both_ends():
    """An event already past is not "accelerated", it is over.

    This used to be defined twice, with only one of the two definitions
    carrying the lower bound, so a saved event could report one answer on the
    generate path and the opposite on the read path.
    """
    assert is_accelerated_in(0) is True
    assert is_accelerated_in(ACCELERATED_THRESHOLD_DAYS) is True
    assert is_accelerated_in(ACCELERATED_THRESHOLD_DAYS + 1) is False
    assert is_accelerated_in(-1) is False
    assert is_accelerated_in(-500) is False


def test_the_event_wrapper_delegates_to_the_same_rule(event_input):
    """`is_accelerated(event)` must not drift from `is_accelerated_in(days)`."""
    for offset in (0, 3, ACCELERATED_THRESHOLD_DAYS, ACCELERATED_THRESHOLD_DAYS + 1, 90):
        event = event_input(event_date=date.today() + timedelta(days=offset))
        assert is_accelerated(event) is is_accelerated_in(event.days_until_event)
