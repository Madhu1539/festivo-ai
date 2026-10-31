"""Request guards: body size and per-client rate limiting (§19.5).

Both are deliberately simple and in-process. There is no Redis here and
inventing one would be dishonest about what this deployment is: a single
backend process. The limiter therefore protects *this* process, which is
exactly what is at risk — every `/generate-plan` call spends real money at the
model provider and holds a worker for several seconds.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from collections.abc import Iterable
from typing import ClassVar

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .errors import RateLimited, RequestTooLarge

# 64 kB is already far more than the form can produce: every free-text field is
# length-capped by EventInput. A larger body is either a mistake or an attempt
# to exhaust memory before validation ever runs.
MAX_BODY_BYTES = 64 * 1024

# Saving a plan posts the whole generated plan back, which is legitimately
# larger than an input form.
MAX_PLAN_BODY_BYTES = 512 * 1024

# The save endpoint, matched by suffix so the /api prefix stays in one place.
_SAVE_PLAN_PATH_SUFFIX = "/events"

# Above this many tracked clients, sweep the empty deques. Purely bookkeeping:
# it bounds memory on a long-running process and never affects a decision.
_TRACKED_CLIENT_SWEEP_THRESHOLD = 1024

# Methods that can carry a body worth measuring.
_BODY_METHODS = frozenset({"POST", "PUT", "PATCH"})


def _body_limit_for(path: str) -> int:
    return (
        MAX_PLAN_BODY_BYTES
        if path.rstrip("/").endswith(_SAVE_PLAN_PATH_SUFFIX)
        else MAX_BODY_BYTES
    )


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Defence-in-depth headers on every API response.

    This service only ever returns JSON, so the policy can be as strict as it
    gets: nothing is allowed to load, and the responses must not be framed or
    content-sniffed. None of this substitutes for the escaping and validation
    elsewhere - it is the layer that limits the damage if one of those is ever
    wrong.
    """

    _HEADERS: ClassVar[dict[str, str]] = {
        # A JSON API has no legitimate need to load anything at all.
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
        # Stop a browser from second-guessing the declared content type and
        # treating a response as script or HTML.
        "X-Content-Type-Options": "nosniff",
        # Belt and braces with frame-ancestors, for older browsers.
        "X-Frame-Options": "DENY",
        # Do not leak the API path back to third parties.
        "Referrer-Policy": "no-referrer",
    }

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        for header, value in self._HEADERS.items():
            response.headers.setdefault(header, value)
        return response


class BodySizeLimitMiddleware:
    """Reject oversized bodies before anything downstream reads them.

    Written as raw ASGI rather than `BaseHTTPMiddleware` on purpose. That base
    class builds its own `receive` for the downstream call, so swapping the one
    on a `Request` has no effect and the stream goes unmeasured - the limit
    silently applies to declared sizes only, which is the bypass this closes.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        request = Request(scope)
        limit = _body_limit_for(request.url.path)
        declared = request.headers.get("content-length")

        if declared is not None:
            try:
                too_big = int(declared) > limit
            except ValueError:
                # A malformed Content-Length is not something to guess about.
                response = _error(RequestTooLarge("Could not read the request size."))
                return await response(scope, receive, send)
            if too_big:
                return await _error(RequestTooLarge())(scope, receive, send)
            return await self.app(scope, receive, send)

        if scope.get("method") not in _BODY_METHODS:
            return await self.app(scope, receive, send)

        # No Content-Length means a chunked body, whose size is not known until
        # it has been read. Measure it as it arrives, so a client cannot opt
        # out of the limit just by leaving the header off.
        received = 0
        exceeded = False
        replaced = False

        async def capped() -> Message:
            nonlocal received, exceeded
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    exceeded = True
                    # Report the stream as finished rather than raising: an
                    # exception from inside `receive` surfaces as a 500, while
                    # ending the body lets the response be replaced below.
                    return {"type": "http.request", "body": b"", "more_body": False}
            return message

        async def guarded_send(message: Message) -> None:
            nonlocal replaced
            if exceeded and message["type"] == "http.response.start":
                # The handler saw a truncated body and is about to answer
                # "invalid request". Say what actually happened instead.
                replaced = True
                return await _error(RequestTooLarge())(scope, receive, send)
            if replaced:
                return  # Swallow the abandoned response's body.
            await send(message)

        await self.app(scope, capped, guarded_send)


def client_key(request: Request, *, trust_proxy: bool) -> str:
    """Identify the caller for rate-limiting purposes.

    Behind a reverse proxy, `request.client.host` is the *proxy's* address, so
    every user would share a single bucket and the limit would throttle the
    whole service at once. The real address has to come from
    `X-Forwarded-For`.

    The **rightmost** entry is used, not the leftmost. The header is a
    caller-supplied list that each hop appends to, so a client can send a
    header full of invented addresses; the trusted proxy appends the address
    it actually saw to the end. Taking the leftmost value would let anyone
    rotate a fake IP per request and bypass the limit completely.
    """
    if trust_proxy:
        forwarded = request.headers.get("x-forwarded-for", "")
        hops = [hop.strip() for hop in forwarded.split(",") if hop.strip()]
        if hops:
            return hops[-1]

    return request.client.host if request.client else "unknown"


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Sliding-window limit on the endpoints that cost money to serve.

    Only the generation endpoints are limited. Reads and checklist ticks are
    cheap and rate-limiting them would just make the app feel broken under
    normal use.
    """

    def __init__(
        self,
        app,
        *,
        paths: Iterable[str],
        max_requests: int,
        window_seconds: float,
        trust_proxy: bool = False,
    ) -> None:
        super().__init__(app)
        self._paths = tuple(paths)
        self._max_requests = max_requests
        self._window = window_seconds
        self._trust_proxy = trust_proxy
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def _is_limited(self, path: str) -> bool:
        return any(path.rstrip("/").endswith(suffix) for suffix in self._paths)

    async def dispatch(self, request: Request, call_next):
        if request.method != "POST" or not self._is_limited(request.url.path):
            return await call_next(request)

        client = client_key(request, trust_proxy=self._trust_proxy)
        now = time.monotonic()
        hits = self._hits[client]

        # Drop everything that has fallen out of the window.
        while hits and now - hits[0] > self._window:
            hits.popleft()

        if len(hits) >= self._max_requests:
            retry_after = max(1, int(self._window - (now - hits[0])) + 1)
            return _error(RateLimited(), headers={"Retry-After": str(retry_after)})

        hits.append(now)

        # Keep the bookkeeping from growing without bound on a long-running
        # process: an empty deque for a departed client is pure overhead.
        if len(self._hits) > _TRACKED_CLIENT_SWEEP_THRESHOLD:
            for key in [k for k, v in self._hits.items() if not v]:
                del self._hits[key]

        return await call_next(request)


def _error(exc, *, headers: dict[str, str] | None = None) -> Response:
    return JSONResponse(
        status_code=exc.status_code, content=exc.to_payload(), headers=headers
    )
