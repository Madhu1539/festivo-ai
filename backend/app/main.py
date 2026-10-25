"""Festivo AI backend: application assembly (§14.2).

Wires configuration, middleware, error handlers and routers into the ASGI
app. The plan-generation pipeline it serves — validate input, build prompt,
call Gemini, validate schema, validate dates, recompute budget (§13.3) — lives
in `services/planner.py`; nothing here performs any of those steps.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import init_database
from .errors import register_error_handlers
from .middleware import BodySizeLimitMiddleware, RateLimitMiddleware
from .routers import events, health

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
)
log = logging.getLogger("festivo")


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    init_database()
    if not settings.ai_configured:
        log.warning(
            "GEMINI_API_KEY is not set. Plan generation will return "
            "AI_NOT_CONFIGURED until it is provided."
        )
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=f"{settings.app_name} API",
        version="1.0.0",
        description="GenAI-powered celebration and event planner.",
        lifespan=lifespan,
    )

    # Middleware runs outermost-last, so these are added before CORS in order
    # for CORS headers to still be attached to a 429 or 413 response.
    if settings.rate_limit_enabled:
        app.add_middleware(
            RateLimitMiddleware,
            paths=("/events/generate-plan", "/events/regenerate-plan"),
            max_requests=settings.rate_limit_requests,
            window_seconds=settings.rate_limit_window_seconds,
            trust_proxy=settings.trust_proxy_headers,
        )

    app.add_middleware(BodySizeLimitMiddleware)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )

    register_error_handlers(app)
    app.include_router(health.router, prefix="/api")
    app.include_router(events.router, prefix="/api")
    return app


app = create_app()
