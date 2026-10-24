"""Consistent API error envelope (§15.7).

Never leak stack traces or provider details to the frontend.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("festivo")


class AppError(Exception):
    """Base class for errors that are safe to show to a user."""

    code = "INTERNAL_ERROR"
    status_code = 500
    message = "Something went wrong. Please try again."

    def __init__(
        self,
        message: str | None = None,
        *,
        details: list[Any] | None = None,
        code: str | None = None,
        status_code: int | None = None,
    ) -> None:
        self.message = message or self.message
        self.details = details or []
        if code:
            self.code = code
        if status_code:
            self.status_code = status_code
        super().__init__(self.message)

    def to_payload(self) -> dict[str, Any]:
        return {
            "error": {
                "code": self.code,
                "message": self.message,
                "details": self.details,
            }
        }


class InvalidEventInput(AppError):
    code = "INVALID_EVENT_INPUT"
    status_code = 422
    message = "Please check the event details and try again."


class AINotConfigured(AppError):
    code = "AI_NOT_CONFIGURED"
    status_code = 503
    message = (
        "The plan generator is not configured yet. "
        "Add a GEMINI_API_KEY to the backend environment and restart."
    )


class AIUnavailable(AppError):
    code = "AI_UNAVAILABLE"
    status_code = 503
    message = "The plan generator is temporarily unavailable. Please try again."


class AITimeout(AppError):
    code = "AI_TIMEOUT"
    status_code = 504
    message = "Generating your plan took too long. Please try again."


class AIRateLimited(AppError):
    code = "AI_RATE_LIMITED"
    status_code = 429
    message = "Too many plan requests right now. Please wait a moment and retry."


class AIInvalidOutput(AppError):
    code = "AI_INVALID_OUTPUT"
    status_code = 502
    message = (
        "The generated plan could not be validated. "
        "Please try generating it again."
    )


class BudgetValidationFailed(AppError):
    code = "BUDGET_VALIDATION_FAILED"
    status_code = 422
    message = "The generated budget did not pass validation. Please regenerate the plan."


class NotFound(AppError):
    code = "NOT_FOUND"
    status_code = 404
    message = "The requested item could not be found."


class StorageUnavailable(AppError):
    code = "STORAGE_UNAVAILABLE"
    status_code = 503
    message = "Saved events are unavailable because the database is not reachable."


class RequestTooLarge(AppError):
    code = "REQUEST_TOO_LARGE"
    status_code = 413
    message = "That request was too large. Please shorten the details and try again."


class RateLimited(AppError):
    code = "AI_RATE_LIMITED"
    status_code = 429
    message = (
        "You have made several plan requests in quick succession. "
        "Please wait a moment and try again."
    )


# Status codes that Starlette raises for us, mapped onto our own envelope so a
# client never has to parse two different error shapes.
_HTTP_STATUS_CODES: dict[int, tuple[str, str]] = {
    404: ("NOT_FOUND", "The requested item could not be found."),
    405: ("METHOD_NOT_ALLOWED", "That action is not supported on this address."),
    413: (RequestTooLarge.code, RequestTooLarge.message),
    429: (RateLimited.code, RateLimited.message),
}


def register_error_handlers(app) -> None:
    """Attach handlers so every failure uses the §15.7 envelope."""

    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=exc.to_payload())

    @app.exception_handler(RequestValidationError)
    async def _validation_error(
        _: Request, exc: RequestValidationError
    ) -> JSONResponse:
        details = [
            {
                "field": ".".join(str(p) for p in err.get("loc", ()) if p != "body"),
                "message": err.get("msg", "Invalid value."),
            }
            for err in exc.errors()
        ]
        first = details[0]["message"] if details else InvalidEventInput.message
        err = InvalidEventInput(first, details=details)
        return JSONResponse(status_code=err.status_code, content=err.to_payload())

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        """Starlette's own errors (404, 405, ...) use `{"detail": ...}` by
        default. Rewrite them into the §15.7 envelope so the frontend has a
        single error shape to handle."""
        code, message = _HTTP_STATUS_CODES.get(
            exc.status_code, ("INTERNAL_ERROR", AppError.message)
        )
        return JSONResponse(
            status_code=exc.status_code,
            content=AppError(message, code=code).to_payload(),
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        # Logged server-side only; the client gets a generic message so that
        # internals and provider details never leak (§19.4).
        log.exception("Unhandled error: %s", exc)
        return JSONResponse(status_code=500, content=AppError().to_payload())
