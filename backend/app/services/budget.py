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
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from ..models import new_id
from ..schemas import (
    AIBudgetCategory,
    BudgetCategoryOut,
    BudgetOverviewOut,
    EventInput,
)

CENTS = Decimal("0.01")
# Reserve is clamped to this share of the budget if the model proposes an
# unusable reserve (e.g. larger than the budget itself).
MAX_RESERVE_SHARE = Decimal("0.15")


def _dec(value: object) -> Decimal:
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0")
    if amount.is_nan() or amount.is_infinite():
        return Decimal("0")
    return amount.quantize(CENTS, rounding=ROUND_HALF_UP)


def _money(value: Decimal) -> float:
    return float(value.quantize(CENTS, rounding=ROUND_HALF_UP))


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
        (_dec(c.estimated_amount) for c in categories if not c.is_reserve),
        Decimal("0"),
    )
    reserve = sum(
        (_dec(c.estimated_amount) for c in categories if c.is_reserve),
        Decimal("0"),
    )

    allocated = planned + reserve
    unallocated = budget - allocated
    is_over = allocated > budget

    def pct(amount: Decimal) -> float:
        return round(float(amount / budget * 100), 1) if budget > 0 else 0.0

    for category in categories:
        category.percent_of_budget = pct(_dec(category.estimated_amount))

    return BudgetOverviewOut(
        currency=currency,
        total_budget=_money(budget),
        planned_expenditure=_money(planned),
        emergency_reserve=_money(reserve),
        unallocated=_money(unallocated),
        total_allocated=_money(allocated),
        budget_per_guest=_money(budget / Decimal(max(1, guest_count))),
        is_valid=not is_over,
        is_over_budget=is_over,
        # Clamped at zero: a negative "overage" is not a thing, and letting a
        # float rounding artefact through here would display as a tiny debt.
        overage=_money(max(Decimal("0"), allocated - budget)) if is_over else 0.0,
        was_rescaled=was_rescaled,
        categories=categories,
    )


def build_budget(
    event: EventInput, categories: list[AIBudgetCategory]
) -> tuple[BudgetOverviewOut, list[str]]:
    """Turn raw AI categories into a validated budget overview."""
    warnings: list[str] = []
    budget = _dec(event.budget)

    # --- 1. Clean the raw categories ---------------------------------------
    planned: list[tuple[str, Decimal, str | None]] = []
    reserve_total = Decimal("0")
    reserve_description: str | None = None
    dropped = 0

    for raw in categories:
        name = (raw.category or "").strip()
        amount = _dec(raw.estimated_amount)
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
        return (
            _overview(event, budget, [], Decimal("0"), None, False, warnings),
            warnings,
        )

    # --- 2. Clamp an unusable reserve --------------------------------------
    if reserve_total >= budget and budget > 0:
        clamped = (budget * MAX_RESERVE_SHARE).quantize(
            CENTS, rounding=ROUND_HALF_UP
        )
        warnings.append(
            f"The generated emergency reserve ({event.currency} {_money(reserve_total):,.2f}) "
            f"was not usable against a budget of {event.currency} {_money(budget):,.2f}. "
            f"It has been reduced to {event.currency} {_money(clamped):,.2f}."
        )
        reserve_total = clamped

    planned_total = sum((amount for _, amount, _ in planned), Decimal("0"))

    # --- 3. Over-budget handling (§9.5) ------------------------------------
    was_rescaled = False
    allocated = planned_total + reserve_total
    if allocated > budget:
        overage = allocated - budget
        target = budget - reserve_total
        if target > 0 and planned_total > 0:
            planned = _rescale(planned, target)
            planned_total = sum((amount for _, amount, _ in planned), Decimal("0"))
            was_rescaled = True
            warnings.append(
                f"The generated allocation came to {event.currency} "
                f"{_money(allocated):,.2f}, which is {event.currency} "
                f"{_money(overage):,.2f} over your budget of {event.currency} "
                f"{_money(budget):,.2f}. Category amounts have been scaled "
                "proportionally to fit. Your budget was not changed."
            )
        else:
            # Cannot rescale — surface the excess clearly instead.
            warnings.append(
                f"The generated allocation exceeds your budget by {event.currency} "
                f"{_money(overage):,.2f}. Please regenerate the plan or raise the budget."
            )

    return (
        _overview(
            event,
            budget,
            planned,
            reserve_total,
            reserve_description,
            was_rescaled,
            warnings,
        ),
        warnings,
    )


def _rescale(
    planned: list[tuple[str, Decimal, str | None]], target: Decimal
) -> list[tuple[str, Decimal, str | None]]:
    """Scale categories to sum to exactly ``target``.

    Rounding residue is applied to the largest category so the total is exact
    and the result is deterministic (§9.2).
    """
    current = sum((amount for _, amount, _ in planned), Decimal("0"))
    if current <= 0:
        return planned

    factor = target / current
    scaled = [
        (name, (amount * factor).quantize(CENTS, rounding=ROUND_HALF_UP), desc)
        for name, amount, desc in planned
    ]

    residual = target - sum((amount for _, amount, _ in scaled), Decimal("0"))
    if residual != 0:
        largest = max(range(len(scaled)), key=lambda i: scaled[i][1])
        name, amount, desc = scaled[largest]
        adjusted = amount + residual
        scaled[largest] = (name, max(Decimal("0"), adjusted), desc)
    return scaled


def _overview(
    event: EventInput,
    budget: Decimal,
    planned: list[tuple[str, Decimal, str | None]],
    reserve: Decimal,
    reserve_description: str | None,
    was_rescaled: bool,
    warnings: list[str],
) -> BudgetOverviewOut:
    categories = [
        BudgetCategoryOut(
            id=new_id(),
            category=name,
            estimated_amount=_money(amount),
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
                estimated_amount=_money(reserve),
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

    unallocated = _dec(overview.unallocated)
    if unallocated > 0 and budget > 0 and unallocated / budget >= Decimal("0.05"):
        share = round(float(unallocated / budget * 100), 1)
        warnings.append(
            f"{event.currency} {overview.unallocated:,.2f} of your budget "
            f"({share:.1f}%) is still unallocated."
        )

    return overview


def progress_percent(completed: int, total: int) -> float:
    """§11.4 — safe against an empty checklist."""
    if total <= 0:
        return 0.0
    return round(completed / total * 100, 1)
