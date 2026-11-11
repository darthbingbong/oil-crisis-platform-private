"""Public-site guards (M16): rate limits, closed developer endpoints, and friendly errors. All of it is active in hosted mode only.

* Rate limit: a sliding one-minute window per client. GENERAL_PER_MIN requests to /api/ and /ws/ in total, and SIMULATE_PER_MIN to the calculator endpoints
  (which do the most work). Over the limit: HTTP 429, a plain sentence, and a Retry-After header. The client is the first address of X-Forwarded-For
  when a proxy sets it, otherwise the socket address. The table is in memory and old clients are dropped, so it cannot grow without bound.
* Closed endpoints: the developer / test endpoints answer 404 in hosted mode (they can inject news, trigger polls or fake feed failures).
* Friendly errors: an unexpected failure is a short JSON sentence (no traceback, no file path, no key), and the real error goes to the log only.
"""

import logging
import time
from collections import deque

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from services import hosted

logger = logging.getLogger("guards")

GENERAL_PER_MIN = 120
SIMULATE_PER_MIN = 30
WINDOW_S = 60.0
MAX_CLIENTS = 5000
CLOSED_IN_HOSTED = ("/api/v1/news/test-inject", "/api/v1/news/poll-now", "/api/v1/dev/news-feed", "/api/v1/ais/search/provider")
HEAVY_PREFIXES = ("/api/v1/simulate",)

FRIENDLY_500 = "Something went wrong on our side. Please try again in a moment; the rest of the site still works."
FRIENDLY_429 = "Too many requests from your connection. Please wait a moment and try again."
FRIENDLY_CLOSED = "This function is not available on the public site."


class RateTable:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.hits: dict[str, deque] = {}

    def allow(self, client: str, bucket: str, limit: int) -> tuple[bool, float]:
        """(allowed, seconds until a slot frees). Counts the request when allowed."""
        now = self.clock()
        dq = self.hits.setdefault(f"{client}|{bucket}", deque())
        while dq and now - dq[0] >= WINDOW_S:
            dq.popleft()
        if len(dq) >= limit:
            return False, max(1.0, WINDOW_S - (now - dq[0]))
        dq.append(now)
        if len(self.hits) > MAX_CLIENTS:                       # drop clients whose window is empty
            for k in [k for k, v in self.hits.items() if not v or now - v[-1] >= WINDOW_S][:MAX_CLIENTS // 2]:
                self.hits.pop(k, None)
        return True, 0.0


def client_id(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()[:64]
    return request.client.host if request.client else "unknown"


class HostedGuards(BaseHTTPMiddleware):
    def __init__(self, app, table: RateTable | None = None):
        super().__init__(app)
        self.table = table or RateTable()

    async def dispatch(self, request: Request, call_next):
        if not hosted.hosted_mode():
            return await call_next(request)
        path = request.url.path
        if path in CLOSED_IN_HOSTED:
            return JSONResponse({"error": "not_available", "message": FRIENDLY_CLOSED}, status_code=404)
        if path.startswith(("/api/", "/ws/")):
            who = client_id(request)
            checks = [("all", GENERAL_PER_MIN)] + ([("heavy", SIMULATE_PER_MIN)] if path.startswith(HEAVY_PREFIXES) else [])
            for bucket, limit in checks:
                ok, wait = self.table.allow(who, bucket, limit)
                if not ok:
                    return JSONResponse({"error": "rate_limited", "message": FRIENDLY_429, "retry_after_s": round(wait)}, status_code=429,
                                        headers={"Retry-After": str(round(wait))})
        try:
            return await call_next(request)
        except Exception:
            logger.exception("unhandled error on %s %s", request.method, path)
            return JSONResponse({"error": "server_error", "message": FRIENDLY_500}, status_code=500)


async def friendly_500(request: Request, exc: Exception):
    """Registered for Exception: the same sentence in every mode, never a traceback in the body."""
    logger.exception("unhandled error on %s %s", request.method, request.url.path, exc_info=exc)
    return JSONResponse({"error": "server_error", "message": FRIENDLY_500}, status_code=500)
