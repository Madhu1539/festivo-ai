"""Authentication endpoints.

Sign-up deliberately tells the caller when an email is already registered,
even though that confirms the address has an account here. The alternative -
accepting the registration silently and emailing the real owner - needs mail
delivery this application does not have, and without it the user is left
unable to tell a taken address from a server fault. Sign-in leaks nothing.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session

from ..db import get_db
from ..dependencies import _token_from_header, current_user
from ..errors import EmailAlreadyRegistered, InvalidCredentials
from ..models import User
from ..schemas import AuthOut, CredentialsIn, UserOut
from ..services import auth

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=AuthOut, status_code=201)
def register(payload: CredentialsIn, db: Session = Depends(get_db)) -> AuthOut:
    """Create an account and sign it in."""
    if auth.find_user(db, payload.email) is not None:
        raise EmailAlreadyRegistered()

    user = auth.create_user(db, payload.email, payload.password)
    return AuthOut(user=UserOut.model_validate(user, from_attributes=True),
                   token=auth.create_session(db, user))


@router.post("/login", response_model=AuthOut)
def login(payload: CredentialsIn, db: Session = Depends(get_db)) -> AuthOut:
    """Sign in to an existing account."""
    user = auth.find_user(db, payload.email)

    if user is None:
        # Spend the same work as a real check before failing, so an unknown
        # address cannot be told from a wrong password by response time.
        auth.dummy_verify(payload.password)
        raise InvalidCredentials()

    if not auth.verify_password(payload.password, user.password_hash):
        raise InvalidCredentials()

    return AuthOut(user=UserOut.model_validate(user, from_attributes=True),
                   token=auth.create_session(db, user))


@router.post("/logout", status_code=204)
def logout(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> None:
    """Revoke the current session.

    Succeeds even without a valid token: the caller's intent is to end up
    signed out, and reporting an error for a token that is already gone would
    leave the client unsure whether to clear its own state.
    """
    token = _token_from_header(authorization)
    if token:
        auth.revoke_session(db, token)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)) -> UserOut:
    """The signed-in account. Used by the client to restore a session."""
    return UserOut.model_validate(user, from_attributes=True)
