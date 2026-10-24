"""Request guards: rate limiting and body size (§19.5).

These build their own app rather than using the shared `client` fixture: the
suite deliberately runs with the limiter off, and a limit is only meaningful
when you control how many requests have already been counted.
"""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.errors import register_error_handlers
from app.middleware import (
    MAX_BODY_BYTES,
    BodySizeLimitMiddleware,
    RateLimitMiddleware,
)


def _payload(**overrides):
    body = {
        "event_type": "birthday",
        "event_name": "Pastel Birthday",
        "event_date": (date.today() + timedelta(days=120)).isoformat(),
        "budget": 15000,
        "guest_count": 30,
        "location": "Bhopal, Madhya Pradesh, India",
    }
    body.update(overrides)
    return body


def _app(**limiter_kwargs) -> FastAPI:
    app = FastAPI()

    @app.post("/api/events/generate-plan")
    async def _generate(body: dict):
        return {"ok": True}

    @app.post("/api/events")
    async def _save(body: dict):
        return {"ok": True}

    register_error_handlers(app)
    if limiter_kwargs:
        app.add_middleware(RateLimitMiddleware, **limiter_kwargs)
    app.add_middleware(BodySizeLimitMiddleware)
    return app


# --- Rate limiting --------------------------------------------------------


def test_generation_is_rate_limited_per_client():
    client = TestClient(
        _app(
            paths=("/events/generate-plan",),
            max_requests=3,
            window_seconds=60.0,
        )
    )

    for attempt in range(3):
        assert (
            client.post("/api/events/generate-plan", json=_payload()).status_code == 200
        ), f"request {attempt + 1} should have been allowed"

    blocked = client.post("/api/events/generate-plan", json=_payload())
    assert blocked.status_code == 429

    body = blocked.json()
    assert body["error"]["code"] == "AI_RATE_LIMITED"
    # The client needs to know how long to wait, not just that it failed.
    assert int(blocked.headers["retry-after"]) >= 1


def test_rate_limit_does_not_apply_to_other_endpoints():
    """Saving and reading are cheap; limiting them would break normal use."""
    client = TestClient(
        _app(
            paths=("/events/generate-plan",),
            max_requests=1,
            window_seconds=60.0,
        )
    )

    client.post("/api/events/generate-plan", json=_payload())
    assert client.post("/api/events/generate-plan", json=_payload()).status_code == 429

    for _ in range(5):
        assert client.post("/api/events", json={"event": {}}).status_code == 200


def test_rate_limit_window_expires():
    client = TestClient(
        _app(
            paths=("/events/generate-plan",),
            max_requests=1,
            # A window this short proves expiry without a sleep.
            window_seconds=0.001,
        )
    )

    assert client.post("/api/events/generate-plan", json=_payload()).status_code == 200
    import time

    time.sleep(0.01)
    assert client.post("/api/events/generate-plan", json=_payload()).status_code == 200


# --- Body size ------------------------------------------------------------


def test_oversized_body_is_rejected_before_parsing():
    client = TestClient(_app())

    oversized = _payload(location="x" * (MAX_BODY_BYTES + 1))
    response = client.post("/api/events/generate-plan", json=oversized)

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "REQUEST_TOO_LARGE"


def test_normal_body_passes():
    client = TestClient(_app())
    assert client.post("/api/events/generate-plan", json=_payload()).status_code == 200


def test_save_endpoint_allows_a_larger_body():
    """Saving posts back a whole generated plan, which is legitimately big."""
    client = TestClient(_app())

    body = {"event": _payload(), "notes": "y" * (MAX_BODY_BYTES + 1000)}
    assert client.post("/api/events", json=body).status_code == 200
