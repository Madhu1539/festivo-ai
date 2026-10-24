"""Request guards: rate limiting and body size (§19.5).

These build their own app rather than using the shared `client` fixture: the
suite deliberately runs with the limiter off, and a limit is only meaningful
when you control how many requests have already been counted.
"""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.errors import register_error_handlers
from app.middleware import (
    MAX_BODY_BYTES,
    BodySizeLimitMiddleware,
    RateLimitMiddleware,
    client_key,
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


# --- Client identification behind a proxy --------------------------------
#
# Deployed on Render/Fly/Heroku, `request.client.host` is the load balancer,
# so without X-Forwarded-For handling every user shares one bucket and the
# limit throttles the whole service at once.


def _request(headers: dict[str, str] | None = None, host: str = "10.0.0.1"):
    """A minimal Request with a client address and optional headers."""
    raw = [
        (k.lower().encode(), v.encode()) for k, v in (headers or {}).items()
    ]
    return Request({"type": "http", "headers": raw, "client": (host, 1234)})


def test_direct_connections_use_the_socket_address():
    assert client_key(_request(host="203.0.113.7"), trust_proxy=False) == "203.0.113.7"


def test_forwarded_header_is_ignored_when_not_behind_a_proxy():
    """Otherwise anyone could rotate the header and bypass the limit."""
    request = _request({"X-Forwarded-For": "1.2.3.4"}, host="203.0.113.7")
    assert client_key(request, trust_proxy=False) == "203.0.113.7"


def test_behind_a_proxy_the_real_client_is_used():
    request = _request({"X-Forwarded-For": "203.0.113.7"}, host="10.0.0.1")
    assert client_key(request, trust_proxy=True) == "203.0.113.7"


def test_a_spoofed_forwarded_chain_cannot_bypass_the_limit():
    """The rightmost entry is the one the trusted proxy appended.

    A client can pre-populate the header with anything, so taking the
    leftmost value would let it present a fresh fake IP on every request.
    """
    request = _request(
        {"X-Forwarded-For": "9.9.9.9, 8.8.8.8, 203.0.113.7"}, host="10.0.0.1"
    )
    assert client_key(request, trust_proxy=True) == "203.0.113.7"


def test_falls_back_when_the_proxy_sends_no_header():
    request = _request({}, host="10.0.0.1")
    assert client_key(request, trust_proxy=True) == "10.0.0.1"


def test_an_empty_forwarded_header_falls_back():
    request = _request({"X-Forwarded-For": "  ,  "}, host="10.0.0.1")
    assert client_key(request, trust_proxy=True) == "10.0.0.1"


def test_two_users_behind_one_proxy_get_separate_budgets():
    """The regression this guards: one shared bucket for every visitor."""
    client = TestClient(
        _app(
            paths=("/events/generate-plan",),
            max_requests=1,
            window_seconds=60.0,
            trust_proxy=True,
        )
    )

    def post(ip: str):
        return client.post(
            "/api/events/generate-plan",
            json=_payload(),
            headers={"X-Forwarded-For": ip},
        )

    assert post("203.0.113.1").status_code == 200
    assert post("203.0.113.1").status_code == 429  # same user, over budget

    # A different visitor must not be punished for the first one's usage.
    assert post("203.0.113.2").status_code == 200


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
