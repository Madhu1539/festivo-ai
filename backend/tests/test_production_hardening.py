"""Controls that only apply once the service is public."""

from __future__ import annotations

import pytest

from app.config import Settings


def prod(**overrides):
    return Settings(environment="production", **overrides)


# --- M2: the interactive docs are reconnaissance on a public API ----------


def test_docs_are_available_outside_production():
    from app.main import create_app

    app = create_app()  # ENVIRONMENT=test in conftest
    assert app.docs_url == "/docs"
    assert app.openapi_url == "/openapi.json"


def test_docs_are_switched_off_in_production(monkeypatch):
    from app import config, main

    monkeypatch.setenv("ENVIRONMENT", "production")
    config.get_settings.cache_clear()
    try:
        app = main.create_app()
        assert app.docs_url is None
        assert app.redoc_url is None
        assert app.openapi_url is None
    finally:
        config.get_settings.cache_clear()


@pytest.mark.parametrize(
    ("environment", "expected"),
    [
        ("production", True),
        ("PRODUCTION", True),
        ("prod", True),
        (" Production ", True),
        ("development", False),
        ("test", False),
        ("staging", False),
    ],
)
def test_production_is_recognised_case_and_space_insensitively(environment, expected):
    assert Settings(environment=environment).is_production is expected


# --- M3: a wildcard origin must not reach production ----------------------


def test_a_wildcard_origin_is_refused_in_production():
    settings = prod(cors_origins="*")
    with pytest.raises(ValueError, match="must not be"):
        _ = settings.allowed_origins


def test_a_wildcard_origin_is_allowed_in_development():
    """Convenient locally, and there is nothing to steal."""
    assert Settings(environment="development", cors_origins="*").allowed_origins == ["*"]


def test_explicit_origins_still_work_in_production():
    settings = prod(cors_origins="https://festivo-ai-five.vercel.app")
    assert settings.allowed_origins == ["https://festivo-ai-five.vercel.app"]


# --- L2: a mis-cased origin used to fail invisibly ------------------------


def test_origins_are_lowercased_to_match_what_browsers_send():
    """Regression: an uppercase entry matched nothing and looked correct.

    Browsers always send the origin lower-cased. An entry typed as
    "HTTPS://Example.com" therefore never matched, and the rejected preflight
    surfaced in the frontend as a generic network error - the same invisible
    failure mode as the trailing slash.
    """
    settings = Settings(cors_origins="HTTPS://Festivo-AI.Vercel.App/")
    assert settings.allowed_origins == ["https://festivo-ai.vercel.app"]


def test_case_and_slash_variants_collapse_to_one_entry():
    settings = Settings(
        cors_origins="https://a.com, https://A.com/, HTTPS://a.COM"
    )
    assert settings.allowed_origins == ["https://a.com"]
