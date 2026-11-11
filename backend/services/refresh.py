"""The scheduled refresh for hosted mode (M16): the ONLY place that reaches EIA and GDELT while the site is public.

Visitors are served from caches (services.hosted.cache_only). Once a day (REFRESH_INTERVAL_HOURS, default 24) and once at start-up, this module
  1. asks EIA for WTI and Brent (one call set; a failure leaves the older cached answer or the dated CSV fallback in place),
  2. fetches each route's GDELT headlines one route at a time, at least NEWS_WARMUP_GAP seconds apart (GDELT answers 429 faster than that),
  3. passes the new headlines through the classifier pipeline (Claude under the daily and monthly caps and the cache, else rules).
A failure of any step is logged and the others still run. Nothing here is reachable from a request.
"""

import asyncio
import logging
import os

from news.gdelt_bridge import classify_route_items
from services import hosted
from services import news_feed
from services.price_feed import get_service
from services.route_data import all_routes

logger = logging.getLogger("refresh")


def interval_seconds() -> float:
    try:
        return max(0.05, float(os.environ.get("REFRESH_INTERVAL_HOURS", "").strip() or 24)) * 3600
    except ValueError:
        return 24 * 3600


async def refresh_all(*, gap: float | None = None, price_fn=None, news_fn=None, classify_fn=None) -> dict:
    """One full refresh. The three callables exist so tests can replace the network; by default they are the real feeds."""
    gap = news_feed.WARMUP_GAP_SECONDS if gap is None else gap
    report: dict = {"price": None, "news": {}, "classified": 0}
    if hosted.enabled("eia"):
        try:
            out = await (price_fn or get_service().refresh)()
            report["price"] = out.get("status")
        except Exception:
            logger.exception("scheduled refresh: price step failed")
            report["price"] = "FAILED"
    if hosted.enabled("gdelt"):
        cache = news_feed.default_cache()
        for route in all_routes():
            key = f"news_{route['id']}"
            entry = cache.get(key)
            if entry is not None:
                entry["expired"] = True                      # due: the refetch below replaces it; if GDELT fails it stays as the labelled stale answer
            try:
                res = await (news_fn or news_feed.get_route_news)(route, force=True)
                report["news"][route["id"]] = res["feed_status"]
                if res["feed_status"] == "ok":
                    report["classified"] += await (classify_fn or classify_route_items)(res["items"])
            except Exception:
                logger.exception("scheduled refresh: news step failed for %s", route["id"])
                report["news"][route["id"]] = "FAILED"
            await asyncio.sleep(gap)
    logger.info("scheduled refresh done: price=%s news=%s classified=%d", report["price"], report["news"], report["classified"])
    return report


async def refresh_loop() -> None:
    """Start-up refresh after a short delay, then every interval. Cancelled with the server."""
    await asyncio.sleep(3.0)
    while True:
        try:
            await refresh_all()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("scheduled refresh crashed; trying again at the next interval")
        await asyncio.sleep(interval_seconds())
