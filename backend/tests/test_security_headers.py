"""Security response headers on the API."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


EXPECTED = {
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
}


@pytest.mark.parametrize(("header", "value"), EXPECTED.items())
def test_every_response_carries_the_header(client, header, value):
    response = client.get("/api/health")
    assert response.headers.get(header) == value


def test_headers_are_present_on_an_error_response(client):
    """A 401 or 404 must be as locked down as a 200."""
    unauthorized = client.get("/api/events")
    assert unauthorized.status_code == 401
    for header, value in EXPECTED.items():
        assert unauthorized.headers.get(header) == value


def test_the_api_policy_allows_nothing_to_load(client):
    """It only ever returns JSON, so the strictest policy is the right one."""
    policy = client.get("/api/health").headers["Content-Security-Policy"]
    assert "default-src 'none'" in policy
    assert "frame-ancestors 'none'" in policy
