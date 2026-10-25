"""Money quantization shared by the budget and storage layers.

Both layers have to turn untrusted values — model output on one side, database
columns on the other — into exact two-decimal amounts, and they must agree
about it. These used to be duplicated in both modules under the same names but
with different bodies: one caught bare ``Exception`` and had no NaN guard, the
other did. A reader who learned one was wrong about the other.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

CENTS = Decimal("0.01")


def to_decimal(value: object) -> Decimal:
    """Coerce anything to an exact 2dp Decimal, defaulting to zero.

    Never raises and never returns NaN or infinity: a value that cannot be
    read as money is treated as absent rather than propagated into an
    arithmetic chain where it would silently poison every total downstream.
    """
    try:
        amount = Decimal(str(value if value is not None else 0))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0")

    if amount.is_nan() or amount.is_infinite():
        return Decimal("0")

    return amount.quantize(CENTS, rounding=ROUND_HALF_UP)


def to_float(value: Decimal) -> float:
    """Render a Decimal amount as the float the API returns.

    Quantized first, so the float is the nearest representation of a 2dp value
    rather than carrying binary noise into the JSON payload.
    """
    return float(value.quantize(CENTS, rounding=ROUND_HALF_UP))
