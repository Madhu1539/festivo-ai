"""Budget engine tests (§20.2)."""

from __future__ import annotations

import pytest

from app.schemas import AIBudgetCategory
from app.services.budget import _looks_like_reserve, build_budget, progress_percent


def cats(*pairs):
    return [
        AIBudgetCategory(
            category=name,
            estimated_amount=amount,
            is_reserve="reserve" in name.lower(),
        )
        for name, amount in pairs
    ]


def test_exact_allocation_matches_spec_example(event_input, ai_categories):
    """§9.4 — the worked example must reproduce exactly."""
    budget, warnings = build_budget(event_input(), ai_categories)

    assert budget.planned_expenditure == 12000.0
    assert budget.emergency_reserve == 3000.0
    assert budget.total_allocated == 15000.0
    assert budget.unallocated == 0.0
    assert budget.budget_per_guest == 500.0
    assert budget.is_valid is True
    assert budget.is_over_budget is False
    assert budget.was_rescaled is False
    assert warnings == []


def test_reserve_is_separated_from_planned_expenditure(event_input, ai_categories):
    """P and R must never be conflated (§9.3)."""
    budget, _ = build_budget(event_input(), ai_categories)

    reserves = [c for c in budget.categories if c.is_reserve]
    assert len(reserves) == 1
    assert reserves[0].estimated_amount == 3000.0
    assert sum(
        c.estimated_amount for c in budget.categories if not c.is_reserve
    ) == budget.planned_expenditure


def test_unallocated_budget_is_reported(event_input):
    budget, warnings = build_budget(
        event_input(), cats(("Food", 5000), ("Cake", 1000))
    )

    assert budget.planned_expenditure == 6000.0
    assert budget.unallocated == 9000.0
    assert budget.is_valid is True
    assert any("unallocated" in w for w in warnings)


def test_over_budget_is_rescaled_to_fit_exactly(event_input):
    """§9.5 — revised allocation, user budget untouched."""
    budget, warnings = build_budget(
        event_input(),
        cats(("Venue", 20000), ("Food", 10000), ("Emergency reserve", 1500)),
    )

    assert budget.total_budget == 15000.0  # B is never changed
    assert budget.total_allocated == 15000.0
    assert budget.unallocated == 0.0
    assert budget.was_rescaled is True
    assert budget.is_over_budget is False
    assert any("over your budget" in w for w in warnings)
    assert any("not changed" in w for w in warnings)


def test_rescale_sums_exactly_with_awkward_rounding(event_input):
    """Rounding residue must land deterministically (§9.2)."""
    budget, _ = build_budget(
        event_input(budget=101, guest_count=7), cats(("A", 50), ("B", 50), ("C", 50))
    )

    assert budget.planned_expenditure == 101.0
    assert sum(c.estimated_amount for c in budget.categories) == 101.0
    assert budget.unallocated == 0.0


def test_negative_and_zero_amounts_are_dropped(event_input):
    budget, warnings = build_budget(
        event_input(),
        cats(("Food", 5000), ("Zero", 0), ("Negative", -200)),
    )

    assert [c.category for c in budget.categories] == ["Food"]
    assert budget.planned_expenditure == 5000.0
    assert any("ignored" in w for w in warnings)


def test_unnamed_category_is_dropped(event_input):
    budget, _ = build_budget(event_input(), cats(("", 500), ("Food", 5000)))
    assert [c.category for c in budget.categories] == ["Food"]


def test_empty_expense_list(event_input):
    """§20.2 — empty expense lists must not crash."""
    budget, warnings = build_budget(event_input(), [])

    assert budget.categories == []
    assert budget.planned_expenditure == 0.0
    assert budget.unallocated == 15000.0
    assert budget.budget_per_guest == 500.0
    assert budget.is_valid is True
    assert any("No usable budget categories" in w for w in warnings)


def test_reserve_larger_than_budget_is_clamped(event_input):
    budget, warnings = build_budget(
        event_input(budget=1000),
        cats(("Food", 500), ("Emergency reserve", 5000)),
    )

    assert budget.emergency_reserve == 150.0  # 15% ceiling
    assert budget.is_valid is True
    assert any("not usable" in w for w in warnings)


def test_very_small_budget(event_input):
    budget, _ = build_budget(
        event_input(budget=1, guest_count=1), cats(("Cake", 1))
    )

    assert budget.planned_expenditure == 1.0
    assert budget.unallocated == 0.0
    assert budget.budget_per_guest == 1.0


def test_decimal_amounts_are_quantized(event_input):
    budget, _ = build_budget(
        event_input(), cats(("Food", 4500.555), ("Cake", 1800.444))
    )

    amounts = {c.category: c.estimated_amount for c in budget.categories}
    assert amounts["Food"] == 4500.56
    assert amounts["Cake"] == 1800.44


def test_money_strings_are_coerced():
    """AI output is untrusted and may be formatted text (§19.4)."""
    raw = [
        AIBudgetCategory(category="Food", estimated_amount="₹4,500"),
        AIBudgetCategory(category="Cake", estimated_amount="1800 INR"),
        AIBudgetCategory(category="Junk", estimated_amount="not a number"),
    ]
    assert [c.estimated_amount for c in raw] == [4500.0, 1800.0, 0.0]


def test_implicit_reserve_detected_by_name(event_input):
    """A reserve must be recognised even when is_reserve is omitted."""
    raw = [
        AIBudgetCategory(category="Food", estimated_amount=10000),
        AIBudgetCategory(category="Contingency buffer", estimated_amount=2000),
    ]
    budget, _ = build_budget(event_input(), raw)

    assert budget.emergency_reserve == 2000.0
    assert budget.planned_expenditure == 10000.0


def test_percent_of_budget_adds_up(event_input, ai_categories):
    budget, _ = build_budget(event_input(), ai_categories)
    total = sum(c.percent_of_budget for c in budget.categories)
    assert abs(total - 100.0) < 0.5


def test_progress_percent_handles_empty_checklist():
    """§11.4 — no divide-by-zero."""
    assert progress_percent(0, 0) == 0.0
    assert progress_percent(3, 10) == 30.0
    assert progress_percent(10, 10) == 100.0


# --- Reserve classification ----------------------------------------------


@pytest.mark.parametrize(
    "name",
    [
        "Emergency reserve",
        "Contingency",
        "Contingency fund",
        "Buffer",
        "Reserve fund",
        "Unforeseen costs",
        "Miscellaneous reserve",
        "Rainy day fund",
    ],
)
def test_reserve_labels_are_recognised(name):
    assert _looks_like_reserve(name) is True


@pytest.mark.parametrize(
    "name",
    [
        # Real expenses that a substring test would wrongly swallow into the
        # reserve, understating planned expenditure.
        "Emergency lighting",
        "Emergency exit signage",
        "Buffer seating for extra guests",
        "Miscellaneous",
        "Decoration and flowers",
        "Catering and beverages",
    ],
)
def test_real_expenses_are_not_mistaken_for_the_reserve(name):
    assert _looks_like_reserve(name) is False


def test_an_emergency_expense_stays_in_planned_expenditure(event_input):
    """Regression: 'Emergency lighting' is spend, not the reserve."""
    raw = [
        AIBudgetCategory(category="Stage and sound", estimated_amount=8000),
        AIBudgetCategory(category="Emergency lighting", estimated_amount=4000),
        AIBudgetCategory(
            category="Emergency reserve", estimated_amount=3000, is_reserve=True
        ),
    ]
    budget, _ = build_budget(event_input(), raw)

    assert budget.planned_expenditure == 12000.0
    assert budget.emergency_reserve == 3000.0

    lighting = next(
        c for c in budget.categories if c.category == "Emergency lighting"
    )
    assert lighting.is_reserve is False
