"""Authentication: registration, sign-in, sessions, and the properties that
make the sign-in form safe to expose.
"""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

CREDS = {"email": "Madhu@Example.com", "password": "a-long-enough-pass"}


@pytest.fixture
def client():
    with TestClient(create_app()) as c:
        yield c


def register(client, **overrides):
    body = {**CREDS, **overrides}
    return client.post("/api/auth/register", json=body)


# --- Registration ---------------------------------------------------------


def test_registration_returns_the_user_and_a_token(client):
    response = register(client, email="new-user@example.com")
    assert response.status_code == 201
    body = response.json()
    assert body["user"]["email"] == "new-user@example.com"
    assert body["token"]
    # The hash must never travel to the client.
    assert "password" not in body["user"]
    assert "password_hash" not in body["user"]


def test_email_is_stored_lowercased_so_case_cannot_duplicate_an_account(client):
    first = register(client, email="Mixed@Case.com")
    assert first.status_code == 201
    assert first.json()["user"]["email"] == "mixed@case.com"

    again = register(client, email="MIXED@CASE.COM")
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "AUTH_EMAIL_TAKEN"


def test_a_short_password_is_rejected(client):
    response = register(client, email="short@example.com", password="tiny")
    assert response.status_code == 422


def test_a_malformed_email_is_rejected(client):
    response = register(client, email="not-an-email", password="a-long-enough-pass")
    assert response.status_code == 422


# --- Sign-in --------------------------------------------------------------


def test_login_succeeds_with_the_right_password(client):
    register(client, email="login@example.com")
    response = client.post(
        "/api/auth/login",
        json={"email": "login@example.com", "password": CREDS["password"]},
    )
    assert response.status_code == 200
    assert response.json()["token"]


def test_login_fails_with_the_wrong_password(client):
    register(client, email="wrongpw@example.com")
    response = client.post(
        "/api/auth/login",
        json={"email": "wrongpw@example.com", "password": "not-the-password"},
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_INVALID_CREDENTIALS"


def test_sign_in_does_not_reveal_whether_an_account_exists(client):
    """An unknown email and a wrong password must be indistinguishable.

    Any difference here - status, code, or wording - turns the sign-in form
    into a way to enumerate which addresses are registered.
    """
    register(client, email="known@example.com")

    unknown = client.post(
        "/api/auth/login",
        json={"email": "nobody@example.com", "password": CREDS["password"]},
    )
    wrong = client.post(
        "/api/auth/login",
        json={"email": "known@example.com", "password": "not-the-password"},
    )

    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json() == wrong.json()


def test_an_unknown_email_costs_the_same_time_as_a_wrong_password(client):
    """Guards the dummy-hash path: without it, timing leaks the account list."""
    register(client, email="timing@example.com")

    def elapsed(email):
        samples = []
        for _ in range(3):
            start = time.perf_counter()
            client.post(
                "/api/auth/login",
                json={"email": email, "password": "not-the-password"},
            )
            samples.append(time.perf_counter() - start)
        return min(samples)

    known = elapsed("timing@example.com")
    unknown = elapsed("nobody-at-all@example.com")

    # The unknown path must not short-circuit. Generous bound: it only has to
    # be the same order of magnitude, not identical.
    assert unknown > known / 3, (
        f"unknown-email login was suspiciously fast: {unknown:.4f}s vs {known:.4f}s"
    )


# --- Sessions -------------------------------------------------------------


def test_me_returns_the_signed_in_account(client):
    token = register(client, email="me@example.com").json()["token"]
    response = client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    assert response.json()["email"] == "me@example.com"


@pytest.mark.parametrize(
    "header",
    [
        None,
        "",
        "Bearer",
        "Bearer ",
        "Basic abc123",
        "Bearer not-a-real-token",
        "bearer wrong-scheme-case-but-bad-token",
    ],
)
def test_a_missing_or_bad_token_is_rejected_identically(client, header):
    headers = {} if header is None else {"Authorization": header}
    response = client.get("/api/auth/me", headers=headers)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"


def test_logout_revokes_the_token(client):
    token = register(client, email="logout@example.com").json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    assert client.get("/api/auth/me", headers=headers).status_code == 200
    assert client.post("/api/auth/logout", headers=headers).status_code == 204
    # The whole point of a server-side session: the token stops working now,
    # not when it would have expired.
    assert client.get("/api/auth/me", headers=headers).status_code == 401


def test_logout_without_a_token_still_succeeds(client):
    assert client.post("/api/auth/logout").status_code == 204


def test_an_expired_session_is_rejected(client):
    from datetime import UTC, datetime, timedelta

    from app.db import get_session_factory
    from app.models import Session as SessionRow
    from app.services.auth import token_hash

    token = register(client, email="expired@example.com").json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/auth/me", headers=headers).status_code == 200

    with get_session_factory()() as db:
        row = db.query(SessionRow).filter_by(token_hash=token_hash(token)).one()
        row.expires_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=1)
        db.commit()

    assert client.get("/api/auth/me", headers=headers).status_code == 401
