"""API endpoint tests (§15, §20.1)."""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import planner as planner_module


@pytest.fixture(scope="module")
def anon_client():
    """A client with no credentials, for checking endpoints are protected."""
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="module")
def client():
    """A signed-in client.

    The saved-event endpoints require an account, so these tests register one
    and send its token by default. That keeps each test about the behaviour it
    is checking; authentication itself is covered in test_auth.py.
    """
    with TestClient(app) as test_client:
        registered = test_client.post(
            "/api/auth/register",
            json={"email": "api-tests@example.com", "password": "a-long-enough-pass"},
        )
        assert registered.status_code == 201, registered.text
        token = registered.json()["token"]
        test_client.headers.update({"Authorization": f"Bearer {token}"})
        yield test_client


@pytest.fixture(scope="module")
def other_client():
    """A second signed-in account, for proving data is not shared."""
    with TestClient(app) as test_client:
        registered = test_client.post(
            "/api/auth/register",
            json={"email": "other-user@example.com", "password": "a-long-enough-pass"},
        )
        assert registered.status_code == 201, registered.text
        token = registered.json()["token"]
        test_client.headers.update({"Authorization": f"Bearer {token}"})
        yield test_client


@pytest.fixture
def stub_generation(monkeypatch, ai_plan_payload):
    """Replaces the provider so endpoint tests never hit the network."""

    class FakeClient:
        model = "fake-model"

        def __init__(self, payload):
            self.payload = payload

        async def generate_json(self, **_):
            return self.payload

    def install(payload=None):
        chosen = payload if payload is not None else ai_plan_payload()
        monkeypatch.setattr(
            planner_module, "GeminiClient", lambda: FakeClient(chosen)
        )

    return install


def payload(**overrides):
    body = {
        "event_type": "birthday",
        "event_name": "Pastel Birthday",
        "event_date": (date.today() + timedelta(days=120)).isoformat(),
        "budget": 15000,
        "guest_count": 30,
        "location": "Bhopal, Madhya Pradesh, India",
        "theme": "Elegant and pastel",
        "preferences": ["Budget-friendly", "Photo corner"],
    }
    body.update(overrides)
    return body


# --- Health (§15.1) --------------------------------------------------------


def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200

    body = response.json()
    assert body["status"] == "ok"
    assert body["ai"]["provider"] == "gemini"
    assert body["ai"]["configured"] is True
    assert body["database"]["persistence_enabled"] is True


def test_health_never_exposes_the_api_key(client):
    """§19.1 — the key must never leave the backend."""
    assert "test-key-not-real" not in client.get("/api/health").text


# --- Generate (§15.2) ------------------------------------------------------


def test_generate_plan_returns_all_four_sections(client, stub_generation):
    stub_generation()
    response = client.post("/api/events/generate-plan", json=payload())
    assert response.status_code == 200

    body = response.json()
    assert body["budget"]["categories"]
    assert body["timeline"]
    assert body["vendor_checklist"]
    assert body["personalized_ideas"]
    assert body["assumptions"]
    assert "estimates" in body["estimate_disclaimer"]


def test_generated_budget_totals_are_consistent(client, stub_generation):
    stub_generation()
    budget = client.post("/api/events/generate-plan", json=payload()).json()["budget"]

    planned = sum(
        c["estimated_amount"] for c in budget["categories"] if not c["is_reserve"]
    )
    reserve = sum(
        c["estimated_amount"] for c in budget["categories"] if c["is_reserve"]
    )

    assert planned == pytest.approx(budget["planned_expenditure"])
    assert reserve == pytest.approx(budget["emergency_reserve"])
    assert budget["unallocated"] == pytest.approx(
        budget["total_budget"] - planned - reserve
    )
    assert budget["is_valid"] is True


def test_budget_amounts_are_numeric(client, stub_generation):
    """§8.3 — amounts must be numbers, not formatted strings."""
    stub_generation()
    budget = client.post("/api/events/generate-plan", json=payload()).json()["budget"]

    assert isinstance(budget["total_budget"], (int, float))
    for category in budget["categories"]:
        assert isinstance(category["estimated_amount"], (int, float))
    assert budget["currency"] == "INR"


@pytest.mark.parametrize("event_type", ["wedding", "birthday", "community"])
def test_all_three_event_types_are_supported(client, stub_generation, event_type):
    """§20.1 — every event type can be selected."""
    stub_generation()
    response = client.post(
        "/api/events/generate-plan", json=payload(event_type=event_type)
    )
    assert response.status_code == 200
    assert response.json()["event_summary"]["event_type"] == event_type


def test_regenerate_plan(client, stub_generation):
    stub_generation()
    response = client.post(
        "/api/events/regenerate-plan",
        json=payload(regeneration_note="Keep the decor simpler"),
    )
    assert response.status_code == 200
    assert response.json()["budget"]["is_valid"] is True


# --- Validation errors (§15.7) --------------------------------------------


@pytest.mark.parametrize(
    "overrides",
    [
        {"budget": -100},
        {"budget": 0},
        {"guest_count": 0},
        {"guest_count": -3},
        {"event_type": "festival"},
        {"location": ""},
        {"event_date": (date.today() - timedelta(days=1)).isoformat()},
        {"event_date": "not-a-date"},
    ],
)
def test_invalid_input_returns_the_error_envelope(client, overrides):
    response = client.post("/api/events/generate-plan", json=payload(**overrides))
    assert response.status_code == 422

    error = response.json()["error"]
    assert error["code"] == "INVALID_EVENT_INPUT"
    assert error["message"]
    assert isinstance(error["details"], list)


def test_missing_required_fields_are_reported_per_field(client):
    response = client.post("/api/events/generate-plan", json={"event_type": "birthday"})
    assert response.status_code == 422

    fields = {detail["field"] for detail in response.json()["error"]["details"]}
    assert {"event_date", "budget", "guest_count", "location"} <= fields


def test_validation_happens_before_any_model_call(client, monkeypatch):
    """§14.3, §19.5 — never pay for a call on invalid input."""
    called = False

    def boom():
        nonlocal called
        called = True
        raise AssertionError("The provider must not be constructed.")

    monkeypatch.setattr(planner_module, "GeminiClient", boom)
    response = client.post("/api/events/generate-plan", json=payload(budget=-1))

    assert response.status_code == 422
    assert called is False


def test_unknown_route_uses_json(client):
    assert client.get("/api/events/does-not-exist/nope").status_code == 404


# --- Persistence (§15.4-15.6) ---------------------------------------------


def test_save_list_patch_and_delete_roundtrip(client, stub_generation):
    stub_generation()

    event = payload()
    plan = client.post("/api/events/generate-plan", json=event).json()

    created = client.post("/api/events", json={"event": event, "plan": plan})
    assert created.status_code == 201
    event_id = created.json()["id"]

    # Listed with real progress, not fabricated values (§7.3).
    listing = client.get("/api/events").json()
    entry = next(item for item in listing if item["id"] == event_id)
    assert entry["event_name"] == "Pastel Birthday"
    assert entry["checklist_progress"]["completed"] == 0
    assert entry["checklist_progress"]["percent"] == 0.0

    # Overview reflects saved data.
    overview = client.get("/api/events/overview").json()
    assert overview["persistence_enabled"] is True
    assert overview["total_events"] >= 1
    assert overview["total_planned_budget"] >= 15000.0

    # Complete a checklist item (§15.6).
    item_id = plan["vendor_checklist"][0]["id"]
    patched = client.patch(
        f"/api/events/{event_id}/checklist/{item_id}", json={"is_completed": True}
    )
    assert patched.status_code == 200
    assert patched.json()["is_completed"] is True

    # Progress updates immediately (§11.3).
    reloaded = client.get(f"/api/events/{event_id}").json()["plan"]
    assert reloaded["checklist_progress"]["completed"] == 1
    assert reloaded["checklist_progress"]["percent"] > 0

    # Totals survive the round-trip, recomputed on read (§13.2).
    assert reloaded["budget"]["total_allocated"] == plan["budget"]["total_allocated"]
    assert reloaded["budget"]["unallocated"] == plan["budget"]["unallocated"]
    assert reloaded["budget"]["is_valid"] is True

    # Undo completion.
    client.patch(
        f"/api/events/{event_id}/checklist/{item_id}", json={"is_completed": False}
    )
    assert (
        client.get(f"/api/events/{event_id}").json()["plan"]["checklist_progress"][
            "completed"
        ]
        == 0
    )

    # Timeline completion.
    timeline_id = plan["timeline"][0]["id"]
    assert (
        client.patch(
            f"/api/events/{event_id}/timeline/{timeline_id}",
            json={"is_completed": True},
        ).status_code
        == 200
    )

    assert client.delete(f"/api/events/{event_id}").status_code == 204
    assert client.get(f"/api/events/{event_id}").status_code == 404


def test_missing_event_returns_not_found(client):
    response = client.get("/api/events/0123456789abcdef")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_patching_an_unknown_item_returns_not_found(client, stub_generation):
    stub_generation()
    event = payload()
    plan = client.post("/api/events/generate-plan", json=event).json()
    event_id = client.post("/api/events", json={"event": event, "plan": plan}).json()["id"]

    response = client.patch(
        f"/api/events/{event_id}/checklist/does-not-exist",
        json={"is_completed": True},
    )
    assert response.status_code == 404

    client.delete(f"/api/events/{event_id}")


def test_checklist_item_cannot_be_patched_through_another_event(
    client, stub_generation
):
    """Ownership check — items are scoped to their event (§16.6)."""
    stub_generation()
    event = payload()

    plan_a = client.post("/api/events/generate-plan", json=event).json()
    id_a = client.post("/api/events", json={"event": event, "plan": plan_a}).json()["id"]
    plan_b = client.post("/api/events/generate-plan", json=event).json()
    id_b = client.post("/api/events", json={"event": event, "plan": plan_b}).json()["id"]

    item_of_b = plan_b["vendor_checklist"][0]["id"]
    response = client.patch(
        f"/api/events/{id_a}/checklist/{item_of_b}", json={"is_completed": True}
    )
    assert response.status_code == 404

    client.delete(f"/api/events/{id_a}")
    client.delete(f"/api/events/{id_b}")


def test_writes_are_committed_before_the_response(client, stub_generation):
    """Regression: a yield-dependency commit runs after the response is sent,
    so a client reading immediately after a write could see stale data."""
    from sqlalchemy import text

    from app.db import get_engine

    stub_generation()
    event = payload()
    plan = client.post("/api/events/generate-plan", json=event).json()
    event_id = client.post("/api/events", json={"event": event, "plan": plan}).json()["id"]

    def row_count(table, where):
        with get_engine().connect() as conn:
            return conn.execute(
                text(f"SELECT COUNT(*) FROM {table} WHERE {where}"),
                {"id": event_id},
            ).scalar()

    # Visible to an independent connection straight after the 201.
    assert row_count("events", "id = :id") == 1

    item_id = plan["vendor_checklist"][0]["id"]
    client.patch(
        f"/api/events/{event_id}/checklist/{item_id}", json={"is_completed": True}
    )
    with get_engine().connect() as conn:
        completed = conn.execute(
            text("SELECT is_completed FROM checklist_items WHERE id = :id"),
            {"id": item_id},
        ).scalar()
    assert completed in (True, 1)

    # And the delete is durable before the 204 is returned.
    assert client.delete(f"/api/events/{event_id}").status_code == 204
    assert row_count("events", "id = :id") == 0
    assert row_count("checklist_items", "event_id = :id") == 0


def test_optional_requirements_survive_save_and_reopen(client, stub_generation):
    """Regression (§15.3): the optional free-text requirements must round-trip.

    Losing an accessibility or dietary need on reopen is worse than losing a
    styling preference: regenerating would then produce a plan that
    contradicts what the user explicitly asked for.
    """
    stub_generation()

    event = payload(
        accessibility_needs="Step-free access and a seated area for elders",
        food_preference="Pure vegetarian, no onion or garlic",
        cultural_preferences="Marwari traditions",
        venue_preference="outdoor",
        must_have_activities="Mehndi and sangeet",
        constraints="No loud music after 10pm",
    )
    plan = client.post("/api/events/generate-plan", json=event).json()

    # Present on the freshly generated plan.
    assert plan["event_summary"]["accessibility_needs"] == event["accessibility_needs"]

    event_id = client.post("/api/events", json={"event": event, "plan": plan}).json()[
        "id"
    ]
    try:
        summary = client.get(f"/api/events/{event_id}").json()["plan"]["event_summary"]
        for field in (
            "accessibility_needs",
            "food_preference",
            "cultural_preferences",
            "venue_preference",
            "must_have_activities",
            "constraints",
        ):
            assert summary[field] == event[field], f"{field} was lost on reopen"
    finally:
        client.delete(f"/api/events/{event_id}")


def test_maximum_length_input_survives_the_whole_pipeline(client, stub_generation):
    """Anything EventInput accepts must also be representable on the way out.

    The `*Out` models are length-bounded (they double as the save request
    body), and an output bound tighter than its matching input bound turns a
    perfectly valid submission into a 500 at response time. This pins the two
    sets of limits together.
    """
    from app.schemas import EventInput

    def cap(field: str) -> int:
        meta = EventInput.model_fields[field].metadata
        return next(m.max_length for m in meta if hasattr(m, "max_length"))

    stub_generation()
    event = payload(
        event_name="N" * cap("event_name"),
        location="L" * cap("location"),
        theme="T" * cap("theme"),
        food_preference="F" * cap("food_preference"),
        accessibility_needs="A" * cap("accessibility_needs"),
        cultural_preferences="C" * cap("cultural_preferences"),
        must_have_activities="M" * cap("must_have_activities"),
        constraints="X" * cap("constraints"),
    )

    generated = client.post("/api/events/generate-plan", json=event)
    assert generated.status_code == 200, generated.text
    plan = generated.json()

    created = client.post("/api/events", json={"event": event, "plan": plan})
    assert created.status_code == 201, created.text
    event_id = created.json()["id"]

    try:
        assert client.get(f"/api/events/{event_id}").status_code == 200
        # The list view has its own narrower projection of the same fields.
        assert client.get("/api/events").status_code == 200
    finally:
        client.delete(f"/api/events/{event_id}")


def test_saved_budget_figures_match_the_generated_ones(client, stub_generation):
    """A reopened plan must show exactly the figures it was generated with.

    The generation path and the read-back path both derive the §9.3 totals.
    They used to do it with two separate copies of the arithmetic, which had
    already drifted apart. This pins them together.
    """
    stub_generation()
    event = payload()
    plan = client.post("/api/events/generate-plan", json=event).json()

    event_id = client.post("/api/events", json={"event": event, "plan": plan}).json()[
        "id"
    ]
    try:
        reloaded = client.get(f"/api/events/{event_id}").json()["plan"]

        for field in (
            "total_budget",
            "planned_expenditure",
            "emergency_reserve",
            "unallocated",
            "total_allocated",
            "budget_per_guest",
            "is_valid",
            "is_over_budget",
            "overage",
            "was_rescaled",
        ):
            assert reloaded["budget"][field] == plan["budget"][field], field

        # Category percentages must agree too, not just the headline totals.
        before = {c["category"]: c["percent_of_budget"] for c in plan["budget"]["categories"]}
        after = {
            c["category"]: c["percent_of_budget"]
            for c in reloaded["budget"]["categories"]
        }
        assert before == after
    finally:
        client.delete(f"/api/events/{event_id}")
