"""Input validation (§19.2) and AI output handling (§20.4)."""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from pydantic import ValidationError

from app.schemas import AIPlan, EventInput, EventPlan


def base(**overrides):
    payload = {
        "event_type": "birthday",
        "event_date": (date.today() + timedelta(days=30)).isoformat(),
        "budget": 15000,
        "guest_count": 30,
        "location": "Bhopal",
    }
    payload.update(overrides)
    return payload


# --- Input validation ------------------------------------------------------


def test_minimal_valid_input():
    event = EventInput(**base())
    assert event.currency == "INR"
    assert event.preferences == []
    assert event.display_name == "Birthday Plan"


@pytest.mark.parametrize("budget", [0, -1, -15000])
def test_non_positive_budget_is_rejected(budget):
    with pytest.raises(ValidationError):
        EventInput(**base(budget=budget))


@pytest.mark.parametrize("guests", [0, -5])
def test_non_positive_guest_count_is_rejected(guests):
    with pytest.raises(ValidationError):
        EventInput(**base(guest_count=guests))


def test_fractional_guest_count_is_rejected():
    with pytest.raises(ValidationError):
        EventInput(**base(guest_count=2.5))


def test_past_event_date_is_rejected():
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    with pytest.raises(ValidationError) as exc:
        EventInput(**base(event_date=yesterday))
    assert "cannot be in the past" in str(exc.value)


def test_today_is_accepted():
    event = EventInput(**base(event_date=date.today().isoformat()))
    assert event.days_until_event == 0


def test_far_future_date_is_rejected():
    far = date.today().replace(year=date.today().year + 20).isoformat()
    with pytest.raises(ValidationError):
        EventInput(**base(event_date=far))


def test_invalid_event_type_is_rejected():
    with pytest.raises(ValidationError):
        EventInput(**base(event_type="festival"))


@pytest.mark.parametrize("location", ["", " ", "x"])
def test_short_location_is_rejected(location):
    with pytest.raises(ValidationError):
        EventInput(**base(location=location))


def test_overlong_text_is_rejected():
    with pytest.raises(ValidationError):
        EventInput(**base(event_name="x" * 200))


def test_currency_is_uppercased():
    assert EventInput(**base(currency="inr")).currency == "INR"


def test_preferences_accept_a_string_and_deduplicate():
    event = EventInput(**base(preferences="Budget-friendly, Photo corner, Budget-friendly"))
    assert event.preferences == ["Budget-friendly", "Photo corner"]


def test_blank_optional_fields_become_none():
    event = EventInput(**base(event_name="  ", theme="", food_preference="  "))
    assert event.event_name is None
    assert event.theme is None
    assert event.food_preference is None


def test_unknown_fields_are_ignored():
    event = EventInput(**base(sneaky_field="ignore me"))
    assert not hasattr(event, "sneaky_field")


def test_days_until_event():
    event = EventInput(**base(event_date=(date.today() + timedelta(days=7)).isoformat()))
    assert event.days_until_event == 7


# --- AI output handling (§20.4) -------------------------------------------


def test_missing_sections_default_to_empty_lists():
    """Missing fields must not raise — they are reported as problems instead."""
    plan = AIPlan.model_validate({})
    assert plan.budget_breakdown == []
    assert plan.timeline == []
    assert plan.vendor_checklist == []
    assert plan.personalized_ideas == []
    assert plan.assumptions == []


def test_incorrect_types_are_coerced_or_rejected():
    plan = AIPlan.model_validate(
        {
            "budget_breakdown": [
                {"category": "Food", "estimated_amount": "₹4,500"},
                {"category": "Cake", "estimated_amount": None},
            ]
        }
    )
    assert plan.budget_breakdown[0].estimated_amount == 4500.0
    assert plan.budget_breakdown[1].estimated_amount == 0.0


def test_negative_amounts_are_floored_at_zero():
    plan = AIPlan.model_validate(
        {"budget_breakdown": [{"category": "Food", "estimated_amount": -500}]}
    )
    assert plan.budget_breakdown[0].estimated_amount == 0.0


def test_estimated_cost_placeholder_becomes_none():
    plan = AIPlan.model_validate(
        {
            "personalized_ideas": [
                {"category": "Food", "title": "A", "estimated_cost": "N/A"},
                {"category": "Food", "title": "B", "estimated_cost": 0},
                {"category": "Food", "title": "C", "estimated_cost": "₹1,200"},
            ]
        }
    )
    costs = [idea.estimated_cost for idea in plan.personalized_ideas]
    assert costs == [None, None, 1200.0]


def test_extra_ai_fields_are_ignored():
    plan = AIPlan.model_validate({"unexpected": {"nested": True}, "assumptions": ["a"]})
    assert plan.assumptions == ["a"]


def test_checklist_progress_is_derived_not_trusted(event_input, ai_categories):
    """§11.4 — progress is always recomputed from the items themselves."""
    from app.services.budget import build_budget

    event = event_input()
    budget, _ = build_budget(event, ai_categories)

    plan = EventPlan(
        event_summary={
            "event_type": "birthday",
            "event_type_label": "Birthday",
            "event_name": "Test",
            "event_date": event.event_date,
            "location": event.location,
            "guest_count": event.guest_count,
            "budget": budget.total_budget,
            "currency": "INR",
            "days_until_event": event.days_until_event,
            "budget_per_guest": budget.budget_per_guest,
        },
        budget=budget,
        vendor_checklist=[
            {"id": "a", "category": "X", "title": "A", "priority": "high",
             "is_completed": True},
            {"id": "b", "category": "X", "title": "B", "priority": "low",
             "is_completed": False},
        ],
        generated_at="2026-01-01T00:00:00Z",
    )

    assert plan.checklist_progress.total == 2
    assert plan.checklist_progress.completed == 1
    assert plan.checklist_progress.percent == 50.0


def test_empty_checklist_progress_is_zero(event_input, ai_categories):
    from app.services.budget import build_budget

    event = event_input()
    budget, _ = build_budget(event, ai_categories)
    plan = EventPlan(
        event_summary={
            "event_type": "birthday",
            "event_type_label": "Birthday",
            "event_name": "Test",
            "event_date": event.event_date,
            "location": event.location,
            "guest_count": event.guest_count,
            "budget": budget.total_budget,
            "currency": "INR",
            "days_until_event": event.days_until_event,
            "budget_per_guest": budget.budget_per_guest,
        },
        budget=budget,
        generated_at="2026-01-01T00:00:00Z",
    )

    assert plan.checklist_progress.percent == 0.0
    assert "estimates" in plan.estimate_disclaimer
