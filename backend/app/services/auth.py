"""Password hashing and session handling.

Two deliberate choices, both of which a reader may want justified.

**scrypt from the standard library, not Argon2id.** OWASP prefers Argon2id,
but lists scrypt configurations that provide "a similar minimal level of
defense, with the main trade-off between parallelism and RAM usage". The
configuration used here, N=2^14 / r=8 / p=5, is one of them. It was chosen
over Argon2id's recommended 19 MiB because it needs *less* memory (16 MiB) at
210ms on the deployment target, and because `hashlib.scrypt` ships with
Python: no wheel to build on the host, and nothing to keep patched.

**Opaque tokens with a server-side row, not JWTs.** Signing out has to revoke
access immediately, and a self-contained token cannot be withdrawn before it
expires. Only the SHA-256 of the token is stored, so a database leak yields
no usable sessions.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from ..models import Session, User, utcnow

# Fail at import rather than silently degrade: scrypt needs OpenSSL 1.1+, and
# a host without it must not quietly fall back to something weaker.
if not hasattr(hashlib, "scrypt"):  # pragma: no cover - environment dependent
    raise RuntimeError(
        "hashlib.scrypt is unavailable, so passwords cannot be hashed safely. "
        "Python must be built against OpenSSL 1.1 or newer."
    )

# OWASP-listed scrypt parameters (N=2^14, r=8, p=5). Stored with each hash so
# these can be raised later without invalidating existing passwords.
SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 5
_DK_LEN = 32
_SALT_BYTES = 16

# 128 * N * r is scrypt's working set (16 MiB here). OpenSSL's default cap is
# 32 MiB and it rejects anything that merely *reaches* it, so the limit is
# passed explicitly rather than left to the default - a detail that otherwise
# only surfaces as "memory limit exceeded" after raising N.
_MAXMEM = 64 * 1024 * 1024

SESSION_TTL = timedelta(days=30)

# Verified against this when the email is unknown, so a missing account costs
# the same time as a wrong password and cannot be detected by timing.
_DUMMY_HASH: str | None = None


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def _derive(password: str, salt: bytes, *, n: int, r: int, p: int) -> bytes:
    return hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=n,
        r=r,
        p=p,
        dklen=_DK_LEN,
        maxmem=_MAXMEM,
    )


def hash_password(password: str) -> str:
    """Hash a password into a self-describing digest string."""
    salt = secrets.token_bytes(_SALT_BYTES)
    digest = _derive(password, salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P)
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    """Check a password against a stored digest.

    Returns False rather than raising on a malformed or unknown-scheme digest:
    a corrupt row must deny access, not produce a 500 that distinguishes it
    from a wrong password.
    """
    try:
        scheme, n_s, r_s, p_s, salt_b64, hash_b64 = stored.split("$")
        if scheme != "scrypt":
            return False
        expected = base64.b64decode(hash_b64)
        actual = _derive(
            password,
            base64.b64decode(salt_b64),
            n=int(n_s),
            r=int(r_s),
            p=int(p_s),
        )
    except (ValueError, TypeError, KeyError):
        return False

    return hmac.compare_digest(actual, expected)


def dummy_verify(password: str) -> None:
    """Spend the same work as a real verification, then discard the result.

    Called when no account matches the submitted email. Without it, login
    returns noticeably faster for an unknown address than for a known one,
    which leaks the account list one guess at a time.
    """
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password(secrets.token_urlsafe(16))
    verify_password(password, _DUMMY_HASH)


def normalize_email(email: str) -> str:
    """Lower-case and trim, so uniqueness is effectively case-insensitive."""
    return email.strip().lower()


def token_hash(token: str) -> str:
    """The stored form of a session token."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(db: DbSession, user: User) -> str:
    """Open a session and return the token. The token is never stored."""
    token = secrets.token_urlsafe(32)
    db.add(
        Session(
            token_hash=token_hash(token),
            user_id=user.id,
            expires_at=utcnow() + SESSION_TTL,
        )
    )
    db.commit()
    return token


def session_user(db: DbSession, token: str) -> User | None:
    """The user behind a token, or None when it is unknown or expired."""
    row = db.scalar(select(Session).where(Session.token_hash == token_hash(token)))
    if row is None:
        return None

    # Stored naive by the DateTime column; compare in UTC either way.
    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=UTC)
    if expires <= datetime.now(UTC):
        db.delete(row)
        db.commit()
        return None

    return row.user


def revoke_session(db: DbSession, token: str) -> None:
    """Sign out. Idempotent: an unknown token is already signed out."""
    row = db.scalar(select(Session).where(Session.token_hash == token_hash(token)))
    if row is not None:
        db.delete(row)
        db.commit()


def find_user(db: DbSession, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == normalize_email(email)))


def create_user(db: DbSession, email: str, password: str) -> User:
    user = User(email=normalize_email(email), password_hash=hash_password(password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
