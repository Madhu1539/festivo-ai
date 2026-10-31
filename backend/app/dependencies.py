"""Request-scoped authentication dependencies."""

from __future__ import annotations

from fastapi import Depends, Header
from sqlalchemy.orm import Session

from .db import get_db
from .errors import AuthRequired
from .models import User
from .services import auth


def _token_from_header(authorization: str | None) -> str | None:
    """Pull the token out of an `Authorization: Bearer <token>` header."""
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer":
        return None
    return token.strip() or None


def current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    """The signed-in account, or 401.

    Raises the same `AuthRequired` for a missing, malformed, unknown and
    expired token. The client cannot act differently on those cases anyway -
    all four mean "sign in again" - and telling them apart would reveal
    whether a given token ever existed.
    """
    token = _token_from_header(authorization)
    if token is None:
        raise AuthRequired()

    user = auth.session_user(db, token)
    if user is None:
        raise AuthRequired()

    return user


def optional_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User | None:
    """The signed-in account if there is one, otherwise None. Never raises."""
    token = _token_from_header(authorization)
    if token is None:
        return None
    return auth.session_user(db, token)
