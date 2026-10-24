"""Settings normalisation.

The CORS allowlist gets its own tests because a mismatch there fails in the
most opaque way the stack has to offer: the browser rejects the preflight, the
frontend sees a generic network error, and nothing in either log says "origin".
"""

from __future__ import annotations

from app.config import Settings


def settings(**overrides) -> Settings:
    # _env_file=None so a developer's real .env cannot influence the result.
    return Settings(_env_file=None, **overrides)


def test_a_single_origin_is_parsed():
    assert settings(cors_origins="https://app.example.com").allowed_origins == [
        "https://app.example.com"
    ]


def test_multiple_origins_are_split_and_trimmed():
    config = settings(
        cors_origins="https://a.example.com ,  https://b.example.com,https://c.example.com"
    )
    assert config.allowed_origins == [
        "https://a.example.com",
        "https://b.example.com",
        "https://c.example.com",
    ]


def test_a_trailing_slash_is_stripped():
    """A browser's Origin header never has one.

    Pasting the URL straight from the address bar is the obvious thing to do,
    and it used to match nothing at all.
    """
    assert settings(cors_origins="https://app.example.com/").allowed_origins == [
        "https://app.example.com"
    ]


def test_trailing_slashes_are_stripped_across_a_list():
    config = settings(
        cors_origins="https://a.example.com/, https://b.example.com , https://c.example.com/"
    )
    assert config.allowed_origins == [
        "https://a.example.com",
        "https://b.example.com",
        "https://c.example.com",
    ]


def test_duplicates_collapse():
    """The slash and no-slash forms are the same origin."""
    config = settings(cors_origins="https://app.example.com/,https://app.example.com")
    assert config.allowed_origins == ["https://app.example.com"]


def test_empty_entries_are_dropped():
    assert settings(cors_origins="https://a.example.com,,  ,").allowed_origins == [
        "https://a.example.com"
    ]


def test_no_origins_configured_yields_an_empty_allowlist():
    """Empty means "allow nothing", never "allow everything"."""
    assert settings(cors_origins="").allowed_origins == []
    assert settings(cors_origins="   ").allowed_origins == []


def test_a_port_is_preserved():
    assert settings(cors_origins="http://localhost:5173/").allowed_origins == [
        "http://localhost:5173"
    ]


def test_normalisation_does_not_widen_to_other_hosts():
    """Stripping a slash must not turn one origin into a different one."""
    allowed = settings(cors_origins="https://app.example.com/").allowed_origins
    for other in (
        "https://app.example.com.evil.test",
        "http://app.example.com",
        "https://other.example.com",
    ):
        assert other not in allowed


def test_ai_configured_reflects_the_key():
    assert settings(gemini_api_key="x").ai_configured is True
    assert settings(gemini_api_key=None).ai_configured is False
    assert settings(gemini_api_key="").ai_configured is False
