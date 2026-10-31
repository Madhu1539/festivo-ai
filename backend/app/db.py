"""Database access (§16.6).

Target deployment is Supabase Postgres reached through its connection pooler.
Both pooler modes disable server-side prepared statements
(``prepare_threshold=None``); transaction mode (port 6543) additionally uses
``NullPool``, because a server connection is only held for the duration of a
transaction.

A connection string copied straight from the Supabase dashboard works as-is:
the bare ``postgresql://`` scheme is rewritten to the installed psycopg 3
driver.

If ``DATABASE_URL`` is left at its SQLite default, the app still runs; persistence
simply uses a local file. If the database is unreachable the API degrades to
generate-only mode rather than failing to boot.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from functools import lru_cache
from typing import Any

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import URL, Engine, make_url
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from .config import get_settings
from .errors import StorageUnavailable

log = logging.getLogger("festivo.db")

# Recycle connections well inside the idle timeout a cloud proxy typically
# enforces, so a stale socket is replaced rather than handed to a request.
_POOL_RECYCLE_SECONDS = 300
_CONNECT_TIMEOUT_SECONDS = 10


def _parse(url: str) -> URL | None:
    """Parse a database URL, or None when it is not parseable."""
    try:
        return make_url(url)
    except Exception:
        return None


def _is_pooler_host(url: str) -> bool:
    """True for any Supabase pooler endpoint (either mode)."""
    parsed = _parse(url)
    if parsed is None or not parsed.drivername.startswith("postgresql"):
        return False
    return "pooler." in (parsed.host or "").lower()


def _is_transaction_pooler(url: str) -> bool:
    """True only for transaction mode, which multiplexes server connections."""
    parsed = _parse(url)
    if parsed is None or not parsed.drivername.startswith("postgresql"):
        return False
    return parsed.port == 6543


def normalize_database_url(url: str) -> str:
    """Point bare ``postgresql://`` URLs at psycopg 3.

    Supabase hands out connection strings as ``postgresql://`` (and sometimes
    ``postgres://``). SQLAlchemy maps both to psycopg2, which this project does
    not install, so the URL is rewritten to the installed psycopg 3 driver.
    A connection string copied straight from the dashboard then works as-is.
    """
    parsed = _parse(url)
    if parsed is None:
        return url
    if parsed.drivername in ("postgres", "postgresql"):
        # render_as_string(hide_password=False) is required: str(URL) masks the
        # password as "***", which would silently break authentication.
        return parsed.set(drivername="postgresql+psycopg").render_as_string(
            hide_password=False
        )
    return url


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    settings = get_settings()
    url = normalize_database_url(settings.database_url)
    kwargs: dict[str, Any] = {"echo": settings.db_echo, "future": True}

    # Recycle below the typical cloud-proxy idle timeout, and pre-ping so a
    # connection the proxy dropped is replaced rather than handed out dead.
    pooling = {"pool_pre_ping": True, "pool_recycle": _POOL_RECYCLE_SECONDS}

    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    elif _is_pooler_host(url):
        # Neither pooler mode supports server-side prepared statements.
        connect_args: dict[str, Any] = {
            "prepare_threshold": None,
            "connect_timeout": _CONNECT_TIMEOUT_SECONDS,
        }
        if _is_transaction_pooler(url):
            # Transaction mode (6543): a server connection is only ours for the
            # duration of a transaction, so never hold one between requests.
            kwargs["poolclass"] = NullPool
        else:
            # Session mode (5432): the connection is ours, so pooling is safe.
            kwargs.update(pooling)
        kwargs["connect_args"] = connect_args
    else:
        kwargs.update(pooling)
        if url.startswith("postgresql"):
            kwargs["connect_args"] = {"connect_timeout": _CONNECT_TIMEOUT_SECONDS}

    return create_engine(url, **kwargs)


@lru_cache(maxsize=1)
def get_session_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), expire_on_commit=False, future=True)


_schema_ready = False
_schema_error: str | None = None


def _add_missing_columns(engine: Engine) -> None:
    """Add columns that `create_all` cannot, for tables that already exist.

    `Base.metadata.create_all` creates missing *tables* and nothing else: it
    will not add a column to a table it finds already present. A deployment
    that predates `events.user_id` therefore keeps the old shape and every
    owner-scoped query fails at runtime, which is a silent break rather than a
    loud one.

    This is deliberately not a migration framework. It handles exactly the
    additive, nullable columns this application has introduced, and is a no-op
    once they exist, so it is safe to run on every start.
    """
    inspector = inspect(engine)
    if not inspector.has_table("events"):
        return  # Fresh database: create_all already produced the right shape.

    existing = {column["name"] for column in inspector.get_columns("events")}
    if "user_id" in existing:
        return

    # No FK constraint is added here. Doing so on an existing table differs
    # per backend and can fail on rows that predate the users table; the
    # relationship is enforced by the ORM and by every query being scoped.
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE events ADD COLUMN user_id VARCHAR(32)"))
        connection.execute(
            text("CREATE INDEX IF NOT EXISTS ix_events_user_id ON events (user_id)")
        )
    log.info("Added events.user_id to an existing schema.")


def init_database() -> None:
    """Create tables if possible. Never raises — persistence is optional."""
    global _schema_ready, _schema_error
    from .models import Base  # imported here to avoid a circular import

    try:
        engine = get_engine()
        Base.metadata.create_all(bind=engine)
        _add_missing_columns(engine)
        _schema_ready = True
        _schema_error = None
        log.info("Database schema ready.")
    except Exception as exc:  # pragma: no cover - environment dependent
        _schema_ready = False
        _schema_error = type(exc).__name__
        # Full detail server-side only; the API response carries just the type.
        log.warning(
            "Database unavailable (%s). Saved events are disabled; "
            "plan generation still works.",
            _schema_error,
            exc_info=True,
        )


def database_status() -> dict[str, Any]:
    settings = get_settings()
    try:
        backend = make_url(
            normalize_database_url(settings.database_url)
        ).get_backend_name()
    except Exception:
        backend = "unknown"
    return {
        "backend": backend,
        "persistence_enabled": _schema_ready,
        "detail": _schema_error,
    }


def _new_session() -> Session:
    if not _schema_ready:
        # One retry: the database may have come back since startup.
        init_database()
    if not _schema_ready:
        raise StorageUnavailable()
    return get_session_factory()()


def get_db() -> Iterator[Session]:
    """FastAPI dependency.

    This deliberately does NOT commit on teardown. FastAPI runs the code after
    ``yield`` only once the response has been sent, so committing here would
    mean the client is told a write succeeded before it is durable — and a
    client reading immediately afterwards could still see the old row. Write
    operations in ``services.storage`` commit explicitly instead.
    """
    session = _new_session()
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
