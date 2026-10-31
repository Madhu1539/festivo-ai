"""The body-size limit must not be opt-out.

Checking only `Content-Length` meant a client could omit the header, send a
chunked body, and have it buffered in full regardless of the cap.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.middleware import MAX_BODY_BYTES


def chunks(total: int, size: int = 16 * 1024):
    """A generator body, which makes httpx use chunked encoding."""
    sent = 0
    while sent < total:
        piece = min(size, total - sent)
        yield b"x" * piece
        sent += piece


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def test_an_oversized_declared_body_is_rejected(client):
    response = client.post(
        "/api/events/generate-plan",
        content=b"x" * (MAX_BODY_BYTES + 1),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "REQUEST_TOO_LARGE"


def test_a_chunked_body_cannot_bypass_the_limit(client):
    """Regression: no Content-Length used to skip the check entirely.

    httpx sends a generator body with Transfer-Encoding: chunked and no
    Content-Length, which is exactly the shape that slipped through.
    """
    response = client.post(
        "/api/events/generate-plan",
        content=chunks(MAX_BODY_BYTES * 2),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "REQUEST_TOO_LARGE"


def test_a_small_chunked_body_still_works(client):
    """The cap must not break legitimate chunked requests."""
    response = client.post(
        "/api/events/generate-plan",
        content=chunks(2048),
        headers={"Content-Type": "application/json"},
    )
    # 422 because the content is not a valid event - it got through the limit,
    # which is the point.
    assert response.status_code == 422


def test_a_malformed_content_length_is_rejected(client):
    response = client.post(
        "/api/events/generate-plan",
        content=b"{}",
        headers={"Content-Type": "application/json", "Content-Length": "abc"},
    )
    assert response.status_code in {400, 413}
