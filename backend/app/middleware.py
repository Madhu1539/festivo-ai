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

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from .errors import RateLimited, RequestTooLarge

# 64 kB is already far more than the form can produce: every free-text field is
# length-capped by EventInput. A larger body is either a mistake or an attempt
# to exhaust memory before validation ever runs.
MAX_BODY_BYTES = 64 * 1024

# Saving a plan posts the whole generated plan back, which is legitimately
# larger than an input form.
MAX_PLAN_BODY_BYTES = 512 * 1024


def _body_limit_for(path: str) -> int:
    return MAX_PLAN_BODY_BYTES if path.rstrip("/").endswith("/events") else MAX_BODY_BYTES


class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    """Reject oversized bodies up front, before parsing or validation."""

    async def dispatch(self, request: Request, call_next):
        declared = request.headers.get("content-length")
        limit = _body_limit_for(request.url.path)

        if declared is not None:
            try:
                if int(declared) > limit:
                    return _error(RequestTooLarge())
            except ValueError:
                # A malformed Content-Length is not something to guess about.
                return _error(RequestTooLarge("Could not read the request size."))

        return await call_next(request)


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
        if len(self._hits) > 1024:
            for key in [k for k, v in self._hits.items() if not v]:
                del self._hits[key]

        return await call_next(request)


def _error(exc, *, headers: dict[str, str] | None = None) -> Response:
    return JSONResponse(
        status_code=exc.status_code, content=exc.to_payload(), headers=headers
    )
