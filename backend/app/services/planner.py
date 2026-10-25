"""Plan generation pipeline (§13.3).

    validate input -> build prompt -> call Gemini -> parse structured output
    -> validate schema and dates -> validate budget arithmetic
    -> check constraints -> return plan

If validation fails the model is asked once to correct its own output before an
error is returned (§13.3, §13.5).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from pydantic import ValidationError

from ..config import get_settings
from ..errors import AIInvalidOutput
from ..models import new_id
from ..schemas import (
    EVENT_TYPE_LABELS,
    AIChecklistItem,
    AIIdea,
    AIPlan,
    ChecklistItemOut,
    EventInput,
    EventPlan,
    EventSummaryOut,
    IdeaOut,
)
from .budget import build_budget
from .gemini import GeminiClient
from .prompt import (
    RESPONSE_SCHEMA,
    SYSTEM_INSTRUCTION,
    build_prompt,
    build_repair_prompt,
)
from .timeline import build_timeline, is_accelerated

log = logging.getLogger("festivo.planner")

# How many of each section we ask the model to produce. Distinct from the
# identically-shaped bounds in schemas.py, which are abuse limits on the save
# path rather than generation targets - the two must not be collapsed.
GENERATED_CHECKLIST_LIMIT = 20
GENERATED_IDEA_LIMIT = 14
MAX_ASSUMPTIONS = 6
MAX_WARNINGS = 8


async def generate_plan(
    event: EventInput, regeneration_note: str | None = None
) -> EventPlan:
    settings = get_settings()
    client = GeminiClient()

    prompt = build_prompt(event, regeneration_note)
    contents: list[dict[str, Any]] = [
        {"role": "user", "parts": [{"text": prompt}]}
    ]

    attempts = settings.ai_max_repair_attempts + 1

    for attempt in range(1, attempts + 1):
        raw = await client.generate_json(
            system_instruction=SYSTEM_INSTRUCTION,
            contents=contents,
            response_schema=RESPONSE_SCHEMA,
        )

        ai_plan, problems = _parse_ai_plan(raw)
        if ai_plan is not None:
            plan, hard_problems = _assemble(event, ai_plan, client.model)
            if not hard_problems:
                return plan
            problems = hard_problems
            fallback_plan = plan
        else:
            fallback_plan = None

        log.info(
            "Plan validation issues on attempt %s/%s: %s",
            attempt,
            attempts,
            "; ".join(problems),
        )

        if attempt >= attempts:
            # Out of retries: return the best validated plan if we have one,
            # since every figure in it has already been recomputed locally.
            if fallback_plan is not None:
                fallback_plan.warnings = _trim(
                    [
                        *fallback_plan.warnings,
                        (
                            "Some parts of this plan needed automatic "
                            "correction. Regenerate it if anything looks off."
                        ),
                    ],
                    MAX_WARNINGS,
                )
                return fallback_plan
            raise AIInvalidOutput()

        contents = [
            {"role": "user", "parts": [{"text": prompt}]},
            {"role": "user", "parts": [{"text": build_repair_prompt(problems)}]},
        ]

    raise AIInvalidOutput()  # pragma: no cover - loop always returns or raises


def _parse_ai_plan(raw: dict[str, Any]) -> tuple[AIPlan | None, list[str]]:
    try:
        return AIPlan.model_validate(raw), []
    except ValidationError as exc:
        problems = [
            f"{'.'.join(str(p) for p in err['loc'])}: {err['msg']}"
            for err in exc.errors()[:8]
        ]
        return None, problems or ["The response did not match the required schema."]


def _assemble(
    event: EventInput, ai_plan: AIPlan, model: str
) -> tuple[EventPlan, list[str]]:
    """Build the validated plan and report problems worth a retry."""
    problems: list[str] = []

    budget, budget_warnings = build_budget(event, ai_plan.budget_breakdown)
    timeline, timeline_warnings = build_timeline(event, ai_plan.timeline)
    checklist = _build_checklist(ai_plan.vendor_checklist)
    ideas = _build_ideas(ai_plan.personalized_ideas)

    # --- Constraint checks (§13.3) ----------------------------------------
    if not budget.categories:
        problems.append("budget_breakdown contained no usable categories.")
    if not timeline:
        problems.append("timeline contained no tasks with a valid due date.")
    if not checklist:
        problems.append("vendor_checklist was empty.")
    if not ideas:
        problems.append("personalized_ideas was empty.")

    if budget.is_over_budget:
        problems.append(
            f"The allocation exceeds the budget by {budget.overage:.2f} "
            f"{event.currency}."
        )
    # Rescaling on its own is deliberately NOT a reason to retry. The amounts
    # have already been fitted to the budget and every total recomputed, so the
    # plan is correct; asking the model again would spend another call to
    # arrive at the same place.

    summary = EventSummaryOut(
        event_type=event.event_type,
        event_type_label=EVENT_TYPE_LABELS[event.event_type],
        event_name=event.display_name,
        event_date=event.event_date,
        location=event.location,
        guest_count=event.guest_count,
        budget=budget.total_budget,
        currency=event.currency,
        theme=event.theme,
        preferences=event.preferences,
        days_until_event=event.days_until_event,
        budget_per_guest=budget.budget_per_guest,
        is_accelerated=is_accelerated(event),
        venue_preference=event.venue_preference,
        food_preference=event.food_preference,
        accessibility_needs=event.accessibility_needs,
        cultural_preferences=event.cultural_preferences,
        must_have_activities=event.must_have_activities,
        constraints=event.constraints,
    )

    plan = EventPlan(
        event_summary=summary,
        budget=budget,
        timeline=timeline,
        vendor_checklist=checklist,
        personalized_ideas=ideas,
        assumptions=_trim(ai_plan.assumptions, MAX_ASSUMPTIONS),
        warnings=_trim(
            [
                *ai_plan.warnings,
                *budget_warnings,
                *timeline_warnings,
            ],
            MAX_WARNINGS,
        ),
        generated_at=datetime.now(UTC),
        model=model,
    )
    return plan, problems


def _build_checklist(items: list[AIChecklistItem]) -> list[ChecklistItemOut]:
    out: list[ChecklistItemOut] = []
    seen: set[str] = set()
    for raw in items:
        title = (raw.title or "").strip()
        category = (raw.category or "").strip() or "General"
        if not title:
            continue
        key = title.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(
            ChecklistItemOut(
                id=new_id(),
                category=category,
                title=title,
                description=raw.description,
                priority=raw.priority,
                is_completed=False,
            )
        )
        if len(out) >= GENERATED_CHECKLIST_LIMIT:
            break

    rank = {"high": 0, "medium": 1, "low": 2}
    out.sort(key=lambda i: (rank[i.priority], i.category.lower()))
    return out


def _build_ideas(items: list[AIIdea]) -> list[IdeaOut]:
    out: list[IdeaOut] = []
    seen: set[str] = set()
    for raw in items:
        title = (raw.title or "").strip()
        category = (raw.category or "").strip() or "Ideas"
        if not title:
            continue
        key = title.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(
            IdeaOut(
                id=new_id(),
                category=category,
                title=title,
                description=raw.description,
                estimated_cost=raw.estimated_cost,
            )
        )
        if len(out) >= GENERATED_IDEA_LIMIT:
            break
    return out


def _trim(values: list[str], limit: int) -> list[str]:
    """Strip, drop empties, drop case-insensitive duplicates, cap the length."""
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        key = value.strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(value.strip())
        if len(out) >= limit:
            break
    return out
