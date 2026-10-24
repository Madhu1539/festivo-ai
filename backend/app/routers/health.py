"""Health check (§15.1)."""

from __future__ import annotations

from fastapi import APIRouter

from ..config import get_settings
from ..db import database_status

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    settings = get_settings()
    db = database_status()
    return {
        "status": "ok",
        "app": settings.app_name,
        "environment": settings.environment,
        "ai": {
            "provider": "gemini",
            "model": settings.gemini_model,
            "configured": settings.ai_configured,
        },
        "database": db,
    }
