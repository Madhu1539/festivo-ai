"""Input and output contracts (§8, §16, §19.2).

Two layers of models:

* ``AI*`` models describe what the GenAI model is asked to return. They are
  deliberately forgiving — model output is untrusted data (§19.4) and is
  repaired where possible instead of rejected outright.
* ``*Out`` models describe what the API returns to the frontend. These are the
  validated, arithmetic-checked values (§13.2).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

EventType = Literal["wedding", "birthday", "community"]
Priority = Literal["high", "medium", "low"]
VenuePreference = Literal["indoor", "outdoor", "either"]

# Bounds for the `*Out` models.
#
# These are not cosmetic. `EventPlan` is also the request body of
# POST /api/events, so every field on it is client-supplied on the save path.
# Without bounds a caller could persist megabytes of text per row, or enough
# list entries to exhaust memory while building the ORM graph.
Id = Annotated[str, Field(min_length=1, max_length=64)]
ShortText = Annotated[str, Field(max_length=200)]
# Location is its own bound so it always matches EventInput.location exactly;
# an output bound tighter than the input bound turns a valid save into a 500.
LocationText = Annotated[str, Field(max_length=240)]
LongText = Annotated[str, Field(max_length=2000)]
CurrencyCode = Annotated[
    str, Field(min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")
]

# Generous against any real plan, restrictive against abuse.
MAX_CATEGORIES = 40
MAX_TIMELINE_ITEMS = 100
MAX_CHECKLIST_ITEMS = 200
MAX_IDEAS = 100
MAX_NOTES = 50

EVENT_TYPE_LABELS: dict[str, str] = {
    "wedding": "Wedding",
    "birthday": "Birthday",
    "community": "Community Event",
}

_PRIORITY_ALIASES = {
    "high": "high",
    "critical": "high",
    "urgent": "high",
    "must": "high",
    "p1": "high",
    "medium": "medium",
    "normal": "medium",
    "moderate": "medium",
    "p2": "medium",
    "low": "low",
    "optional": "low",
    "nice to have": "low",
    "p3": "low",
}


def normalize_priority(value: Any) -> Priority:
    if isinstance(value, str):
        return _PRIORITY_ALIASES.get(value.strip().lower(), "medium")
    return "medium"


# ---------------------------------------------------------------------------
# Input (§8.1)
# ---------------------------------------------------------------------------


class EventInput(BaseModel):
    """Normalized event details submitted from the Create Event form (§7.4)."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")

    event_type: EventType
    event_name: Annotated[str | None, Field(max_length=160)] = None
    event_date: date
    budget: Annotated[float, Field(gt=0, le=1_000_000_000)]
    currency: CurrencyCode = "INR"
    guest_count: Annotated[int, Field(ge=1, le=100_000)]
    location: Annotated[str, Field(min_length=2, max_length=240)]
    theme: Annotated[str | None, Field(max_length=120)] = None
    preferences: Annotated[list[Annotated[str, Field(max_length=200)]], Field(
        max_length=25
    )] = []

    # Additional optional inputs (§7.4)
    venue_preference: VenuePreference | None = None
    food_preference: Annotated[str | None, Field(max_length=300)] = None
    accessibility_needs: Annotated[str | None, Field(max_length=300)] = None
    cultural_preferences: Annotated[str | None, Field(max_length=300)] = None
    must_have_activities: Annotated[str | None, Field(max_length=400)] = None
    constraints: Annotated[str | None, Field(max_length=400)] = None

    @field_validator("event_date")
    @classmethod
    def _date_not_in_past(cls, value: date) -> date:
        today = date.today()
        if value < today:
            raise ValueError("Event date cannot be in the past.")
        if value.year > today.year + 10:
            raise ValueError("Event date is too far in the future.")
        return value

    @field_validator("currency", mode="before")
    @classmethod
    def _upper_currency(cls, value: Any) -> Any:
        # Normalise before the pattern check so "inr" is accepted and anything
        # that is not a 3-letter code is rejected here, with a field-level 422,
        # rather than blowing up later while building the response.
        return value.strip().upper() if isinstance(value, str) else value

    @field_validator("preferences", mode="before")
    @classmethod
    def _clean_preferences(cls, value: Any) -> Any:
        if value is None:
            return []
        if isinstance(value, str):
            # Accept a single textarea value as well as a list: both newlines
            # and commas separate entries.
            value = value.replace("\n", ",").split(",")
        if isinstance(value, list):
            cleaned: list[str] = []
            for item in value:
                text = str(item).strip()
                if text and text not in cleaned:
                    cleaned.append(text)
            return cleaned
        return value

    @field_validator(
        "event_name",
        "theme",
        "food_preference",
        "accessibility_needs",
        "cultural_preferences",
        "must_have_activities",
        "constraints",
        mode="after",
    )
    @classmethod
    def _blank_to_none(cls, value: str | None) -> str | None:
        return value or None

    @property
    def display_name(self) -> str:
        return self.event_name or f"{EVENT_TYPE_LABELS[self.event_type]} Plan"

    @property
    def days_until_event(self) -> int:
        return (self.event_date - date.today()).days


class GeneratePlanRequest(EventInput):
    """POST /api/events/generate-plan (§15.2)."""


class RegeneratePlanRequest(EventInput):
    """POST /api/events/regenerate-plan (§15.3)."""

    # Optional nudge so a regeneration can differ from the previous attempt.
    regeneration_note: Annotated[str | None, Field(max_length=400)] = None


class SaveEventRequest(BaseModel):
    """POST /api/events (§15.4)."""

    model_config = ConfigDict(extra="ignore")

    event: EventInput
    plan: EventPlan


class ChecklistItemUpdate(BaseModel):
    """PATCH /api/events/{event_id}/checklist/{item_id} (§15.6)."""

    is_completed: bool


class TimelineItemUpdate(BaseModel):
    is_completed: bool


# ---------------------------------------------------------------------------
# Raw AI output (untrusted — §13.2, §19.4)
# ---------------------------------------------------------------------------


class AIBudgetCategory(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")

    category: Annotated[str, Field(max_length=120)]
    estimated_amount: float = 0.0
    description: Annotated[str | None, Field(max_length=400)] = None
    is_reserve: bool = False

    @field_validator("estimated_amount", mode="before")
    @classmethod
    def _coerce_amount(cls, value: Any) -> float:
        return _coerce_money(value)


class AITimelineItem(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")

    title: Annotated[str, Field(max_length=200)]
    description: Annotated[str | None, Field(max_length=600)] = None
    due_date: str
    priority: Priority = "medium"
    is_follow_up: bool = False

    @field_validator("priority", mode="before")
    @classmethod
    def _priority(cls, value: Any) -> Priority:
        return normalize_priority(value)


class AIChecklistItem(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")

    category: Annotated[str, Field(max_length=120)]
    title: Annotated[str, Field(max_length=200)]
    description: Annotated[str | None, Field(max_length=600)] = None
    priority: Priority = "medium"

    @field_validator("priority", mode="before")
    @classmethod
    def _priority(cls, value: Any) -> Priority:
        return normalize_priority(value)


class AIIdea(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")

    category: Annotated[str, Field(max_length=120)]
    title: Annotated[str, Field(max_length=200)]
    description: Annotated[str | None, Field(max_length=800)] = None
    estimated_cost: float | None = None

    @field_validator("estimated_cost", mode="before")
    @classmethod
    def _coerce_cost(cls, value: Any) -> float | None:
        if value in (None, "", "null", "N/A", "n/a"):
            return None
        amount = _coerce_money(value)
        return amount if amount > 0 else None


class AIPlan(BaseModel):
    """The structured object requested from Gemini."""

    model_config = ConfigDict(extra="ignore")

    budget_breakdown: list[AIBudgetCategory] = []
    timeline: list[AITimelineItem] = []
    vendor_checklist: list[AIChecklistItem] = []
    personalized_ideas: list[AIIdea] = []
    assumptions: list[Annotated[str, Field(max_length=400)]] = []
    warnings: list[Annotated[str, Field(max_length=400)]] = []


def _coerce_money(value: Any) -> float:
    """Accept '₹4,500', '4500 INR', 4500.0 → 4500.0. Never negative."""
    if value is None or value is True or value is False:
        return 0.0
    if isinstance(value, (int, float)):
        return max(0.0, float(value))
    text = str(value)
    cleaned = "".join(ch for ch in text if ch.isdigit() or ch in ".-")
    # Drop a trailing/duplicate separator mess like "4.500.00"
    if cleaned.count(".") > 1:
        head, _, tail = cleaned.rpartition(".")
        cleaned = head.replace(".", "") + "." + tail
    try:
        return max(0.0, float(cleaned))
    except ValueError:
        return 0.0


# ---------------------------------------------------------------------------
# Validated API output (§8.2)
# ---------------------------------------------------------------------------


class EventSummaryOut(BaseModel):
    event_type: EventType
    event_type_label: ShortText
    event_name: ShortText
    event_date: date
    location: LocationText
    guest_count: int
    budget: float
    currency: CurrencyCode
    theme: ShortText | None = None
    preferences: list[ShortText] = Field(default=[], max_length=MAX_NOTES)
    days_until_event: int
    budget_per_guest: float
    is_accelerated: bool = Field(
        default=False,
        description="True when the event is too close for a normal planning schedule.",
    )

    # The optional requirements the user supplied, echoed back verbatim.
    #
    # These are carried on the summary so a saved plan can be reopened,
    # edited, and regenerated without losing them. Dropping, say, an
    # accessibility need on regenerate would not just lose a preference: it
    # would produce a plan that contradicts a stated requirement.
    venue_preference: VenuePreference | None = None
    food_preference: LongText | None = None
    accessibility_needs: LongText | None = None
    cultural_preferences: LongText | None = None
    must_have_activities: LongText | None = None
    constraints: LongText | None = None


class BudgetCategoryOut(BaseModel):
    id: Id
    category: ShortText
    estimated_amount: float
    description: LongText | None = None
    is_reserve: bool = False
    percent_of_budget: float


class BudgetOverviewOut(BaseModel):
    """All figures recomputed by application code (§9.2, §13.2)."""

    currency: CurrencyCode
    total_budget: float = Field(description="B — the user's budget, never modified.")
    planned_expenditure: float = Field(description="P — sum of non-reserve categories.")
    emergency_reserve: float = Field(description="R — reserve allocation.")
    unallocated: float = Field(description="U = B - P - R.")
    total_allocated: float = Field(description="P + R.")
    budget_per_guest: float
    is_valid: bool = Field(description="True when P + R <= B.")
    is_over_budget: bool
    overage: float = Field(default=0.0, description="How much P + R exceeds B.")
    was_rescaled: bool = Field(
        default=False,
        description="True when category amounts were proportionally fitted to B.",
    )
    categories: list[BudgetCategoryOut] = Field(
        default=[], max_length=MAX_CATEGORIES
    )


class TimelineItemOut(BaseModel):
    id: Id
    title: ShortText
    description: LongText | None = None
    due_date: date
    priority: Priority
    is_completed: bool = False
    is_overdue: bool = False
    is_follow_up: bool = False


class ChecklistItemOut(BaseModel):
    id: Id
    category: ShortText
    title: ShortText
    description: LongText | None = None
    priority: Priority
    is_completed: bool = False


class IdeaOut(BaseModel):
    id: Id
    category: ShortText
    title: ShortText
    description: LongText | None = None
    estimated_cost: float | None = None


class ChecklistProgressOut(BaseModel):
    """§11.4 — guarded against division by zero."""

    total: int = 0
    completed: int = 0
    percent: float = 0.0


class EventPlan(BaseModel):
    """The full response of POST /api/events/generate-plan (§8.2)."""

    event_summary: EventSummaryOut
    budget: BudgetOverviewOut
    timeline: list[TimelineItemOut] = Field(default=[], max_length=MAX_TIMELINE_ITEMS)
    vendor_checklist: list[ChecklistItemOut] = Field(
        default=[], max_length=MAX_CHECKLIST_ITEMS
    )
    personalized_ideas: list[IdeaOut] = Field(default=[], max_length=MAX_IDEAS)
    assumptions: list[LongText] = Field(default=[], max_length=MAX_NOTES)
    warnings: list[LongText] = Field(default=[], max_length=MAX_NOTES)
    checklist_progress: ChecklistProgressOut = ChecklistProgressOut()
    estimate_disclaimer: LongText = (
        "All amounts are AI-generated estimates, not verified local quotations. "
        "No vendor has been contacted, booked, or price-checked."
    )
    generated_at: datetime
    model: ShortText | None = None

    @model_validator(mode="after")
    def _sync_progress(self) -> EventPlan:
        total = len(self.vendor_checklist)
        completed = sum(1 for i in self.vendor_checklist if i.is_completed)
        self.checklist_progress = ChecklistProgressOut(
            total=total,
            completed=completed,
            percent=round(completed / total * 100, 1) if total else 0.0,
        )
        return self


class SavedEventOut(BaseModel):
    """A persisted event plus its plan (§15.5)."""

    id: str
    created_at: datetime
    updated_at: datetime
    plan: EventPlan


class SavedEventListItemOut(BaseModel):
    """Card data for the Saved Events screen (§7.6)."""

    id: Id
    event_type: EventType
    event_type_label: ShortText
    event_name: ShortText
    event_date: date
    location: LocationText
    budget: float
    currency: CurrencyCode
    guest_count: int
    days_until_event: int
    is_past: bool
    checklist_progress: ChecklistProgressOut
    created_at: datetime


class PlanningOverviewOut(BaseModel):
    """Dashboard statistics — real data only, never fabricated (§7.3)."""

    persistence_enabled: bool
    total_events: int = 0
    upcoming_events: int = 0
    total_planned_budget: float = 0.0
    currency: str = "INR"
    average_progress: float = 0.0


SaveEventRequest.model_rebuild()


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------

# Long enough to resist guessing, capped so a megabyte password cannot be used
# to burn CPU in the key-derivation function on every attempt.
Password = Annotated[str, Field(min_length=10, max_length=128)]


class CredentialsIn(BaseModel):
    """Sign-up and sign-in share one shape."""

    model_config = ConfigDict(extra="forbid")

    # EmailStr is avoided on purpose: it would pull in an extra dependency for
    # a check that cannot establish the address is real anyway. A single @ with
    # text either side rejects obvious mistakes, which is all format
    # validation can honestly promise.
    email: Annotated[
        str,
        Field(min_length=3, max_length=320, pattern=r"^[^@\s]+@[^@\s]+$"),
    ]
    password: Password


class UserOut(BaseModel):
    """The account, as the client is allowed to see it. No hash, ever."""

    id: str
    email: str
    created_at: datetime


class AuthOut(BaseModel):
    """A successful sign-up or sign-in."""

    user: UserOut
    token: str

