"""Access control on saved events.

Before authentication, GET /api/events returned every event any visitor had
ever saved, and DELETE accepted any id from anyone. These tests pin the
behaviour that replaced it.
"""

from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import planner as planner_module


def payload(**overrides):
    body = {
        "event_type": "birthday",
        "event_name": "Scoping Test",
        "event_date": (date.today() + timedelta(days=120)).isoformat(),
        "budget": 15000,
        "currency": "INR",
        "guest_count": 30,
        "location": "Bhopal, Madhya Pradesh, India",
        "theme": "Elegant and pastel",
        "preferences": ["Budget-friendly"],
    }
    body.update(overrides)
    return body


@pytest.fixture
def stub_generation(monkeypatch, ai_plan_payload):
    """Replaces the provider so these tests never hit the network."""

    class FakeClient:
        model = "fake-model"

        def __init__(self, payload):
            self.payload = payload

        async def generate_json(self, **_):
            return self.payload

    monkeypatch.setattr(
        planner_module, "GeminiClient", lambda: FakeClient(ai_plan_payload())
    )


def signed_in(label):
    """A fresh signed-in client.

    The email is unique per call because the whole suite shares one database:
    reusing an address would hit the duplicate-account guard on the second
    test that asked for the same label.
    """
    client = TestClient(app)
    client.__enter__()
    registered = client.post(
        "/api/auth/register",
        json={
            "email": f"{label}-{uuid4().hex[:10]}@example.com",
            "password": "a-long-enough-pass",
        },
    )
    assert registered.status_code == 201, registered.text
    client.headers.update({"Authorization": f"Bearer {registered.json()['token']}"})
    return client


@pytest.fixture
def alice():
    client = signed_in("alice")
    yield client
    client.__exit__(None, None, None)


@pytest.fixture
def bob():
    client = signed_in("bob")
    yield client
    client.__exit__(None, None, None)


def save_an_event(client):
    event = payload()
    plan = client.post("/api/events/generate-plan", json=event).json()
    created = client.post("/api/events", json={"event": event, "plan": plan})
    assert created.status_code == 201, created.text
    return created.json()["id"]


# --- Every saved-event endpoint requires an account -----------------------


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/events"),
        ("get", "/api/events/overview"),
        ("get", "/api/events/some-id"),
        ("delete", "/api/events/some-id"),
        ("post", "/api/events"),
        ("patch", "/api/events/some-id/checklist/item-id"),
        ("patch", "/api/events/some-id/timeline/item-id"),
    ],
)
def test_saved_event_endpoints_reject_anonymous_callers(method, path):
    with TestClient(app) as anon:
        call = getattr(anon, method)
        # Only the body-carrying verbs accept `json`.
        response = (
            call(path, json={})
            if method in {"post", "patch", "put"}
            else call(path)
        )
        assert response.status_code == 401, (
            f"{method.upper()} {path} answered {response.status_code} without a token"
        )
        assert response.json()["error"]["code"] == "AUTH_REQUIRED"


def test_generation_stays_public_so_the_app_can_be_tried_first(stub_generation):
    """Generating costs money but reveals nothing, so it needs no account."""
    with TestClient(app) as anon:
        response = anon.post("/api/events/generate-plan", json=payload())
        assert response.status_code == 200


# --- One account cannot see or touch another's data -----------------------


def test_the_list_only_contains_your_own_events(alice, bob, stub_generation):
    alice_event = save_an_event(alice)
    bob_event = save_an_event(bob)

    alice_ids = {item["id"] for item in alice.get("/api/events").json()}
    bob_ids = {item["id"] for item in bob.get("/api/events").json()}

    assert alice_event in alice_ids
    assert bob_event not in alice_ids
    assert bob_event in bob_ids
    assert alice_event not in bob_ids


def test_reading_someone_elses_event_is_not_found_not_forbidden(
    alice, bob, stub_generation
):
    """404 rather than 403, so a wrong guess is not confirmed as a real id."""
    alice_event = save_an_event(alice)

    response = bob.get(f"/api/events/{alice_event}")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_deleting_someone_elses_event_fails_and_leaves_it_intact(
    alice, bob, stub_generation
):
    alice_event = save_an_event(alice)

    assert bob.delete(f"/api/events/{alice_event}").status_code == 404
    # Still there for its owner.
    assert alice.get(f"/api/events/{alice_event}").status_code == 200


def test_patching_through_someone_elses_event_is_rejected(
    alice, bob, stub_generation
):
    alice_event = save_an_event(alice)
    plan = alice.get(f"/api/events/{alice_event}").json()["plan"]
    item_id = plan["vendor_checklist"][0]["id"]

    response = bob.patch(
        f"/api/events/{alice_event}/checklist/{item_id}",
        json={"is_completed": True},
    )
    assert response.status_code == 404

    # The real owner's item is untouched.
    reloaded = alice.get(f"/api/events/{alice_event}").json()["plan"]
    assert reloaded["vendor_checklist"][0]["is_completed"] is False


def test_the_dashboard_totals_only_count_your_own_events(
    alice, bob, stub_generation
):
    """Regression: every overview aggregate used to span all accounts.

    Two of the six reach the owner only through a join, because
    checklist_items has no user_id. Without that join these counts silently
    summed every account's checklists together.
    """
    save_an_event(alice)
    save_an_event(alice)
    save_an_event(bob)

    alice_overview = alice.get("/api/events/overview").json()
    bob_overview = bob.get("/api/events/overview").json()

    assert alice_overview["total_events"] == 2
    assert bob_overview["total_events"] == 1

    # Budget must not be pooled across accounts either.
    assert alice_overview["total_planned_budget"] == pytest.approx(30000)
    assert bob_overview["total_planned_budget"] == pytest.approx(15000)


def test_a_second_account_starts_with_an_empty_dashboard(bob):
    """A brand-new account must not inherit anyone else's figures."""
    overview = bob.get("/api/events/overview").json()
    assert overview["total_events"] == 0
    assert overview["total_planned_budget"] == 0.0
    assert overview["average_progress"] == 0.0
