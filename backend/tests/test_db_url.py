"""Database URL handling for Supabase (§16.6)."""

from __future__ import annotations

from app.db import (
    _is_pooler_host,
    _is_transaction_pooler,
    normalize_database_url,
)

TXN_POOLER = (
    "postgresql://postgres.abcdefgh:pw@aws-1-us-east-1.pooler.supabase.com:6543/postgres"
)
SESSION_POOLER = (
    "postgresql://postgres.abcdefgh:pw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres"
)
DIRECT = "postgresql://user:pw@db.example.com:5432/app"
SQLITE = "sqlite:///./festivo.db"


def test_bare_postgresql_scheme_is_pointed_at_psycopg3():
    """A string copied straight from Supabase must work without editing."""
    assert normalize_database_url(TXN_POOLER).startswith("postgresql+psycopg://")


def test_postgres_scheme_alias_is_normalized():
    url = "postgres://user:pw@host:5432/db"
    assert normalize_database_url(url).startswith("postgresql+psycopg://")


def test_explicit_driver_is_left_alone():
    url = "postgresql+psycopg://user:pw@host:6543/db"
    assert normalize_database_url(url) == url


def test_sqlite_is_left_alone():
    assert normalize_database_url(SQLITE) == SQLITE


def test_garbage_url_is_returned_unchanged():
    assert normalize_database_url("not a url") == "not a url"


def test_normalization_preserves_credentials_and_target():
    from sqlalchemy.engine import make_url

    before = make_url(SESSION_POOLER)
    after = make_url(normalize_database_url(SESSION_POOLER))

    assert after.username == before.username
    assert after.password == before.password
    assert after.host == before.host
    assert after.port == before.port
    assert after.database == before.database


def test_pooler_hosts_are_detected():
    assert _is_pooler_host(normalize_database_url(TXN_POOLER)) is True
    assert _is_pooler_host(normalize_database_url(SESSION_POOLER)) is True
    assert _is_pooler_host(normalize_database_url(DIRECT)) is False
    assert _is_pooler_host(SQLITE) is False


def test_only_port_6543_counts_as_transaction_mode():
    """Transaction mode needs NullPool; session mode does not."""
    assert _is_transaction_pooler(normalize_database_url(TXN_POOLER)) is True
    assert _is_transaction_pooler(normalize_database_url(SESSION_POOLER)) is False
    assert _is_transaction_pooler(normalize_database_url(DIRECT)) is False


def test_engine_settings_match_the_pooler_mode(monkeypatch):
    """Prepared statements are off for both modes; NullPool only for 6543."""
    from sqlalchemy.pool import NullPool

    from app import config, db

    def engine_kwargs_for(url: str) -> dict:
        captured = {}

        def fake_create_engine(resolved_url, **kwargs):
            captured["url"] = resolved_url
            captured["kwargs"] = kwargs
            return object()

        monkeypatch.setenv("DATABASE_URL", url)
        config.get_settings.cache_clear()
        db.get_engine.cache_clear()
        monkeypatch.setattr(db, "create_engine", fake_create_engine)
        db.get_engine()
        return captured

    txn = engine_kwargs_for(TXN_POOLER)
    assert txn["kwargs"]["poolclass"] is NullPool
    assert txn["kwargs"]["connect_args"]["prepare_threshold"] is None

    session = engine_kwargs_for(SESSION_POOLER)
    assert "poolclass" not in session["kwargs"]
    assert session["kwargs"]["connect_args"]["prepare_threshold"] is None
    assert session["kwargs"]["pool_pre_ping"] is True

    sqlite = engine_kwargs_for(SQLITE)
    assert sqlite["kwargs"]["connect_args"] == {"check_same_thread": False}

    # Restore the session-wide test database.
    config.get_settings.cache_clear()
    db.get_engine.cache_clear()
