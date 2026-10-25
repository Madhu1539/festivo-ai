"""Budget planning engine (§9).

Every figure shown to the user is computed here, in application code.
AI-generated arithmetic is never trusted (§9.2, §13.2).

Definitions (§9.3):
    B = total user budget        P = planned expenditure (non-reserve)
    R = emergency reserve        U = B - P - R
Valid when P + R <= B.
"""

from __future__ import annotations

import re
from decimal import ROUND_HALF_UP, Decimal

from ..models import new_id
from ..schemas import (
    AIBudgetCategory,
    BudgetCategoryOut,
    BudgetOverviewOut,
    EventInput,
)
from .money import CENTS, to_decimal, to_float

# Reserve is clamped to this share of the budget if the model proposes an
# unusable reserve (e.g. larger than the budget itself).
MAX_RESERVE_SHARE = Decimal("0.15")

# Leaving more than this share of the budget unspent is worth telling the user
# about; below it, the remainder is rounding rather than a planning gap.
UNALLOCATED_WARNING_SHARE = Decimal("0.05")


_RESERVE_WORDS = frozenset(
    {"reserve", "contingency", "buffer", "emergency", "unforeseen", "rainy"}
)

# Words that commonly pad a reserve label without naming an actual expense.
_RESERVE_FILLER = frozenset(
    {
        "a",
        "allowance",
        "amount",
        "and",
        "cost",
        "costs",
        "day",
        "expense",
        "expenses",
        "extra",
        "for",
        "fund",
        "funds",
        "margin",
        "miscellaneous",
        "money",
        "or",
        "provision",
        "the",
    }
)


def _looks_like_reserve(name: str) -> bool:
    """Whether a category name denotes the emergency reserve itself.

    A substring test is not enough here. "Emergency lighting" and "Buffer
    seating" are real expenses a community-event plan might well contain, and
    treating them as the reserve would move genuine spend out of planned
    expenditure and misstate both P and R.

    So a name only counts as the reserve when every word in it is either a
    reserve word or harmless filler — the moment a word names something you
    actually buy, it is planned expenditure.
    """
    words = re.findall(r"[a-z]+", name.lower())
    if not words:
        return False
    if not any(word in _RESERVE_WORDS for word in words):
        return False
    return all(word in _RESERVE_WORDS or word in _RESERVE_FILLER for word in words)


def derive_overview(
    *,
    currency: str,
    budget: Decimal,
    guest_count: int,
    categories: list[BudgetCategoryOut],
    was_rescaled: bool = False,
) -> BudgetOverviewOut:
    """Derive the §9.3 figures (B, P, R, U) from a finished category list.

    This is the single place the money identities are computed. Both the
    generation path and the read-back-from-storage path call it, because they
    must agree: the plan a user sees after saving has to show the same totals
    as the plan they just generated.

    Percentages are recomputed here rather than taken from the caller, so the
    two paths cannot disagree about rounding either.
    """
    planned = sum(
        (to_decimal(c.estimated_amount) for c in categories if not c.is_reserve),
        Decimal("0"),
    )
    reserve = sum(
        (to_decimal(c.estimated_amount) for c in categories if c.is_reserve),
        Decimal("0"),
    )

    allocated = planned + reserve
    unallocated = budget - allocated
    is_over = allocated > budget

    def pct(amount: Decimal) -> float:
        return round(float(amount / budget * 100), 1) if budget > 0 else 0.0

    for category in categories:
        category.percent_of_budget = pct(to_decimal(category.estimated_amount))

    return BudgetOverviewOut(
        currency=currency,
        total_budget=to_float(budget),
        planned_expenditure=to_float(planned),
        emergency_reserve=to_float(reserve),
        unallocated=to_float(unallocated),
        total_allocated=to_float(allocated),
        budget_per_guest=to_float(budget / Decimal(max(1, guest_count))),
        is_valid=not is_over,
        is_over_budget=is_over,
        # Clamped at zero: a negative "overage" is not a thing, and letting a
        # float rounding artefact through here would display as a tiny debt.
        overage=to_float(max(Decimal("0"), allocated - budget)) if is_over else 0.0,
        was_rescaled=was_rescaled,
        categories=categories,
    )


# A cleaned category before it becomes a BudgetCategoryOut: (name, amount,
# description). Kept as a tuple because it only exists inside this module.
CategoryRow = tuple[str, Decimal, "str | None"]


def _total(rows: list[CategoryRow]) -> Decimal:
    """Sum the amounts of cleaned category rows."""
    return sum((amount for _, amount, _ in rows), Decimal("0"))


def build_budget(
    event: EventInput, categories: list[AIBudgetCategory]
) -> tuple[BudgetOverviewOut, list[str]]:
    """Turn raw AI categories into a validated budget overview."""
    warnings: list[str] = []
    budget = to_decimal(event.budget)

    # --- 1. Clean the raw categories ---------------------------------------
    planned: list[CategoryRow] = []
    reserve_total = Decimal("0")
    reserve_description: str | None = None
    dropped = 0

    for raw in categories:
        name = (raw.category or "").strip()
        amount = to_decimal(raw.estimated_amount)
        if not name or amount <= 0:
            dropped += 1
            continue
        if raw.is_reserve or _looks_like_reserve(name):
            reserve_total += amount
            reserve_description = reserve_description or raw.description
            continue
        planned.append((name, amount, raw.description))

    if dropped:
        warnings.append(
            f"{dropped} budget {'category was' if dropped == 1 else 'categories were'} "
            "ignored because the amount was missing or not positive."
        )

    if not planned and reserve_total <= 0:
        warnings.append(
            "No usable budget categories were generated. Try regenerating the plan."
        )
        overview, overview_warnings = _assemble_overview(
            event, budget, [], Decimal("0"), None, False
        )
        warnings.extend(overview_warnings)
        return overview, warnings

    # --- 2. Clamp an unusable reserve --------------------------------------
    if reserve_total >= budget and budget > 0:
        clamped = (budget * MAX_RESERVE_SHARE).quantize(
            CENTS, rounding=ROUND_HALF_UP
        )
        warnings.append(
            f"The generated emergency reserve ({event.currency} {to_float(reserve_total):,.2f}) "
            f"was not usable against a budget of {event.currency} {to_float(budget):,.2f}. "
            f"It has been reduced to {event.currency} {to_float(clamped):,.2f}."
        )
        reserve_total = clamped

    planned_total = _total(planned)

    # --- 3. Over-budget handling (§9.5) ------------------------------------
    was_rescaled = False
    allocated = planned_total + reserve_total
    if allocated > budget:
        overage = allocated - budget
        target = budget - reserve_total
        if target > 0 and planned_total > 0:
            planned = _rescale(planned, target)
            planned_total = _total(planned)
            was_rescaled = True
            warnings.append(
                f"The generated allocation came to {event.currency} "
                f"{to_float(allocated):,.2f}, which is {event.currency} "
                f"{to_float(overage):,.2f} over your budget of {event.currency} "
                f"{to_float(budget):,.2f}. Category amounts have been scaled "
                "proportionally to fit. Your budget was not changed."
            )
        else:
            # Cannot rescale — surface the excess clearly instead.
            warnings.append(
                f"The generated allocation exceeds your budget by {event.currency} "
                f"{to_float(overage):,.2f}. Please regenerate the plan or raise the budget."
            )

    overview, overview_warnings = _assemble_overview(
        event,
        budget,
        planned,
        reserve_total,
        reserve_description,
        was_rescaled,
    )
    warnings.extend(overview_warnings)
    return overview, warnings


def _rescale(planned: list[CategoryRow], target: Decimal) -> list[CategoryRow]:
    """Scale categories to sum to exactly ``target``.

    Rounding residue is applied to the largest category so the total is exact
    and the result is deterministic (§9.2).
    """
    current = _total(planned)
    if current <= 0:
        return planned

    factor = target / current
    scaled = [
        (name, (amount * factor).quantize(CENTS, rounding=ROUND_HALF_UP), desc)
        for name, amount, desc in planned
    ]

    residual = target - _total(scaled)
    if residual != 0:
        largest = max(range(len(scaled)), key=lambda i: scaled[i][1])
        name, amount, desc = scaled[largest]
        adjusted = amount + residual
        scaled[largest] = (name, max(Decimal("0"), adjusted), desc)
    return scaled


def _assemble_overview(
    event: EventInput,
    budget: Decimal,
    planned: list[CategoryRow],
    reserve: Decimal,
    reserve_description: str | None,
    was_rescaled: bool,
) -> tuple[BudgetOverviewOut, list[str]]:
    """Build the overview, plus any warnings the finished figures reveal.

    Returns the warnings rather than appending to a caller-owned list, so
    `build_budget`'s result is assembled entirely in `build_budget`.
    """
    categories = [
        BudgetCategoryOut(
            id=new_id(),
            category=name,
            estimated_amount=to_float(amount),
            description=desc,
            is_reserve=False,
            # Set by derive_overview, which owns the arithmetic.
            percent_of_budget=0.0,
        )
        for name, amount, desc in sorted(planned, key=lambda c: c[1], reverse=True)
    ]

    if reserve > 0:
        categories.append(
            BudgetCategoryOut(
                id=new_id(),
                category="Emergency reserve",
                estimated_amount=to_float(reserve),
                description=reserve_description
                or "Set aside for last-minute or unforeseen costs.",
                is_reserve=True,
                percent_of_budget=0.0,
            )
        )

    overview = derive_overview(
        currency=event.currency,
        budget=budget,
        guest_count=event.guest_count,
        categories=categories,
        was_rescaled=was_rescaled,
    )

    unallocated = to_decimal(overview.unallocated)
    overview_warnings: list[str] = []
    if (
        unallocated > 0
        and budget > 0
        and unallocated / budget >= UNALLOCATED_WARNING_SHARE
    ):
        share = round(float(unallocated / budget * 100), 1)
        overview_warnings.append(
            f"{event.currency} {overview.unallocated:,.2f} of your budget "
            f"({share:.1f}%) is still unallocated."
        )

    return overview, overview_warnings


def progress_percent(completed: int, total: int) -> float:
    """§11.4 — safe against an empty checklist.

    Lives here rather than in schemas.py, which would be its natural home,
    because schemas.py must not import from services: the services import
    schemas, and reversing that would create a cycle.
    """
    if total <= 0:
        return 0.0
    return round(completed / total * 100, 1)
