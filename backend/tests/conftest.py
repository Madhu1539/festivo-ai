"""Shared test fixtures.

Tests run against a throwaway SQLite file and a fake Gemini key so no network
calls or real credentials are involved.
"""

from __future__ import annotations

import os
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Must be set before the app's cached settings are built.
os.environ["GEMINI_API_KEY"] = "test-key-not-real"
os.environ["ENVIRONMENT"] = "test"
os.environ["AI_MAX_REPAIR_ATTEMPTS"] = "1"
# The whole suite shares one TestClient, so it looks like a single client
# hammering the generation endpoint. Rate limiting is exercised in its own
# test, which builds an app with the limiter switched on explicitly.
os.environ["RATE_LIMIT_ENABLED"] = "false"


@pytest.fixture(scope="session", autouse=True)
def _temp_database(tmp_path_factory):
    db_path = tmp_path_factory.mktemp("db") / "test.db"
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path.as_posix()}"

    from app import config, db

    config.get_settings.cache_clear()
    db.get_engine.cache_clear()
    db.get_session_factory.cache_clear()
    yield


@pytest.fixture
def event_input():
    from app.schemas import EventInput

    def build(**overrides):
        defaults = {
            "event_type": "birthday",
            "event_name": "Pastel Birthday",
            "event_date": date.today() + timedelta(days=120),
            "budget": 15000,
            "guest_count": 30,
            "location": "Bhopal, Madhya Pradesh, India",
            "theme": "Elegant and pastel",
            "preferences": ["Budget-friendly", "Simple decoration", "Photo corner"],
        }
        defaults.update(overrides)
        return EventInput(**defaults)

    return build


@pytest.fixture
def ai_categories():
    """The §9.4 worked example."""
    from app.schemas import AIBudgetCategory

    rows = [
        ("Food and snacks", 4500, False),
        ("Birthday cake", 1800, False),
        ("Decorations", 2000, False),
        ("Return gifts", 1500, False),
        ("Drinks", 900, False),
        ("Games and photo props", 800, False),
        ("Invitations and miscellaneous", 500, False),
        ("Emergency reserve", 3000, True),
    ]
    return [
        AIBudgetCategory(category=name, estimated_amount=amount, is_reserve=reserve)
        for name, amount, reserve in rows
    ]


@pytest.fixture
def ai_plan_payload():
    """A well-formed raw model response for the default event fixture."""
    event_date = date.today() + timedelta(days=120)

    def build(**overrides):
        payload = {
            "budget_breakdown": [
                {"category": "Food and snacks", "estimated_amount": 4500,
                 "description": "Snacks for 30 guests", "is_reserve": False},
                {"category": "Birthday cake", "estimated_amount": 1800,
                 "description": "2 kg pastel cake", "is_reserve": False},
                {"category": "Decorations", "estimated_amount": 2000,
                 "description": "Balloon arch and drapes", "is_reserve": False},
                {"category": "Return gifts", "estimated_amount": 1500,
                 "description": "Small favours", "is_reserve": False},
                {"category": "Drinks", "estimated_amount": 900,
                 "description": "Soft drinks", "is_reserve": False},
                {"category": "Games and photo props", "estimated_amount": 800,
                 "description": "Photo corner props", "is_reserve": False},
                {"category": "Invitations and miscellaneous",
                 "estimated_amount": 500, "description": "Digital invites",
                 "is_reserve": False},
                {"category": "Emergency reserve", "estimated_amount": 3000,
                 "description": "Buffer", "is_reserve": True},
            ],
            "timeline": [
                {"title": "Finalize event requirements",
                 "description": "Confirm the guest list and theme.",
                 "due_date": (event_date - timedelta(days=21)).isoformat(),
                 "priority": "high", "is_follow_up": False},
                {"title": "Confirm cake and food",
                 "description": "Place the order with a local bakery.",
                 "due_date": (event_date - timedelta(days=15)).isoformat(),
                 "priority": "high", "is_follow_up": False},
                {"title": "Prepare decoration plan",
                 "description": "Buy balloons and props.",
                 "due_date": (event_date - timedelta(days=8)).isoformat(),
                 "priority": "medium", "is_follow_up": False},
                {"title": "Confirm guest attendance",
                 "description": "Follow up on RSVPs.",
                 "due_date": (event_date - timedelta(days=3)).isoformat(),
                 "priority": "medium", "is_follow_up": False},
                {"title": "Set up and host",
                 "description": "Decorate and welcome guests.",
                 "due_date": event_date.isoformat(),
                 "priority": "high", "is_follow_up": False},
                {"title": "Share photos with guests",
                 "description": "Send the album link.",
                 "due_date": (event_date + timedelta(days=3)).isoformat(),
                 "priority": "low", "is_follow_up": True},
            ],
            "vendor_checklist": [
                {"category": "Catering", "title": "Book a snack caterer",
                 "description": "Confirm a per-plate rate.", "priority": "high"},
                {"category": "Bakery", "title": "Order the birthday cake",
                 "description": "Eggless, pastel icing.", "priority": "high"},
                {"category": "Decoration", "title": "Arrange balloon decor",
                 "description": "Pastel arch behind the cake table.",
                 "priority": "medium"},
                {"category": "Photography", "title": "Arrange a photographer",
                 "description": "Two hours of candid coverage.",
                 "priority": "medium"},
                {"category": "Logistics", "title": "Confirm the venue layout",
                 "description": "Seating for 30 guests.", "priority": "low"},
            ],
            "personalized_ideas": [
                {"category": "Theme and decoration",
                 "title": "Pastel balloon arch",
                 "description": "Mint, blush and ivory balloons.",
                 "estimated_cost": 1200},
                {"category": "Food and beverages",
                 "title": "Build-your-own chaat counter",
                 "description": "Cheap, popular and interactive.",
                 "estimated_cost": 2500},
                {"category": "Guest experience",
                 "title": "Polaroid photo corner",
                 "description": "A pastel backdrop with props."},
                {"category": "Budget-saving alternatives",
                 "title": "Digital invitations",
                 "description": "Skip printing and send a designed card."},
            ],
            "assumptions": [
                "Assumed an evening event at home rather than a rented hall.",
                "Assumed vegetarian catering unless stated otherwise.",
            ],
            "warnings": ["Pastel flowers may cost more outside their season."],
        }
        payload.update(overrides)
        return payload

    return build
