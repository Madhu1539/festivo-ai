"""Application configuration (§19.1 — secrets stay on the backend)."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- App ---------------------------------------------------------------
    app_name: str = "Festivo AI"
    environment: str = "development"
    # Comma-separated list of allowed browser origins.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # --- GenAI provider: Gemini (§13.6) ------------------------------------
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.5-flash"
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"
    # Request timeout in seconds (§19.5 cost controls).
    ai_timeout_seconds: float = 90.0
    # Thinking tokens count against the output budget and can truncate JSON.
    # 0 disables thinking, which keeps structured output fast and reliable.
    gemini_thinking_budget: int = 0
    ai_max_output_tokens: int = 16384
    ai_temperature: float = 0.8
    # How many times to re-ask the model when its output fails validation.
    ai_max_repair_attempts: int = 1

    # --- Abuse / cost controls (§19.5) ------------------------------------
    # Generating a plan costs money at the provider and occupies a worker for
    # several seconds, so the generation endpoints are rate limited per client
    # IP. Defaults are generous for a real person and restrictive for a script.
    rate_limit_requests: int = 10
    rate_limit_window_seconds: float = 60.0
    rate_limit_enabled: bool = True

    # Credential endpoints are limited against password guessing rather than
    # cost, so they get a tighter budget than plan generation.
    auth_rate_limit_requests: int = 10
    auth_rate_limit_window_seconds: float = 60.0

    # Set to true when the app runs behind a reverse proxy that appends the
    # real client IP to X-Forwarded-For (Render, Fly, Heroku, nginx, ...).
    #
    # This must stay false when the app is reachable directly, because the
    # header is caller-supplied: trusting it without a proxy in front lets
    # anyone rotate the value and bypass the rate limit entirely.
    trust_proxy_headers: bool = False

    # --- Database (Supabase Postgres via the connection pooler) -----------
    # Example (transaction pooler, port 6543):
    #   postgresql+psycopg://postgres.<ref>:<pw>@aws-1-<region>.pooler.supabase.com:6543/postgres
    # Leave unset to fall back to a local SQLite file for development.
    database_url: str = "sqlite:///./festivo.db"
    db_echo: bool = False

    @property
    def is_production(self) -> bool:
        """Whether this process is serving real users.

        Drives the controls that are unhelpful in development but matter once
        the service is reachable from the internet.
        """
        return self.environment.strip().lower() in {"production", "prod"}

    @property
    def allowed_origins(self) -> list[str]:
        """The CORS allowlist, normalised to what a browser actually sends.

        An `Origin` header is only ever scheme + host + optional port: never a
        trailing slash and never a path. People naturally paste a URL copied
        from the address bar ("https://example.vercel.app/"), which then
        matches nothing, and the browser reports the rejected preflight as a
        generic network failure — so the cause is invisible from the frontend.

        Trailing slashes are therefore stripped rather than treated as a
        configuration error. This only ever widens the match to the origin the
        operator plainly meant; it cannot admit an origin they did not list.

        Values are also lower-cased, because browsers send the origin in lower
        case: an entry typed as "HTTPS://Example.com" would otherwise match
        nothing while looking perfectly correct in the dashboard.
        """
        origins: list[str] = []
        for raw in self.cors_origins.split(","):
            origin = raw.strip().rstrip("/").lower()
            if not origin:
                continue
            if origin == "*" and self.is_production:
                # A wildcard lets any site on the internet call this API and
                # spend the account's model quota. Refusing at startup is
                # louder, and easier to diagnose, than discovering it later.
                raise ValueError(
                    "CORS_ORIGINS must not be '*' in production. "
                    "List the frontend origin explicitly."
                )
            if origin not in origins:
                origins.append(origin)
        return origins

    @property
    def ai_configured(self) -> bool:
        return bool(self.gemini_api_key)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
