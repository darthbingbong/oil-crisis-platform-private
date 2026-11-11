"""
News ingestion -- NewsAPI.org's /v2/everything endpoint.

(Originally built against Alpha Vantage's NEWS_SENTIMENT per the project
brief's primary recommendation -- discovered via a real, live call that
NEWS_SENTIMENT is premium-only now, even with no query params at all: the
response is `{"Information": "...premium endpoint..."}`. Not a bug in this
code; verified directly against the raw API. Switched to NewsAPI.org, the
brief's own first-listed fallback, which has a genuinely free "Developer"
tier -- no card required, documented at newsapi.org/pricing. This file is
the only one that touches a provider's specific response shape, so a
future swap back to Alpha Vantage (if upgraded) or on to GNews is a
contained change here, not a rewrite of the pipeline.)

Degrades gracefully by design: with no NEWSAPI_API_KEY set,
fetch_live_articles() returns an empty list and logs that it's running in
fixture-only mode, rather than crashing or fabricating data.

NewsAPI has no per-article topic/relevance score the way Alpha Vantage
did -- instead we push a targeted OR-query of our highest-signal terms
server-side (so NewsAPI itself does the first cut), and the existing
keyword filter (relevance.py) still runs as a second, independent layer
afterward.
"""

import hashlib
import logging
import os
from datetime import datetime, timedelta, timezone

import httpx

from .models import Article

logger = logging.getLogger("news_pipeline")

NEWSAPI_URL = "https://newsapi.org/v2/everything"
REQUEST_TIMEOUT_SECONDS = 15.0

# NewsAPI's free "Developer" tier is documented as 100 requests/day as of
# when this was written -- verify against your own dashboard
# (newsapi.org/account) since free-tier terms can change, as we just
# learned the hard way with Alpha Vantage.
MAX_REQUESTS_PER_DAY = 100
_daily_call_log: list[datetime] = []  # timestamps (UTC) of calls actually made

# A focused OR-query, not every term in relevance.py -- keeps the request
# itself targeted so NewsAPI's own matching does real work, rather than
# relying entirely on our post-fetch keyword filter.
SEARCH_QUERY = (
    '"Strait of Hormuz" OR "Bab el-Mandeb" OR "Suez Canal" OR "Strait of Malacca" '
    'OR OPEC OR "crude oil" OR "oil tanker" OR "oil pipeline" OR "oil refinery" '
    'OR "oil sanctions" OR lithium'
)


def url_hash(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()


def _calls_in_last_24h() -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    while _daily_call_log and _daily_call_log[0] <= cutoff:
        _daily_call_log.pop(0)
    return len(_daily_call_log)


def fetch_live_articles() -> list[Article]:
    """Blocking (sync httpx) by design -- callers run this off the event
    loop via asyncio.to_thread (see poller.py) so a slow/stuck request
    doesn't freeze the FastAPI process serving the dashboard."""
    from services import hosted
    api_key = os.environ.get("NEWSAPI_API_KEY") if hosted.enabled("newsapi") else None
    if not api_key:
        logger.info("NEWSAPI_API_KEY not set -- ingestion running in fixture-only mode.")
        return []

    calls_today = _calls_in_last_24h()
    if calls_today >= MAX_REQUESTS_PER_DAY:
        logger.warning(
            "NewsAPI free-tier quota (%d/%d calls in the last 24h) reached -- "
            "skipping this poll cycle to preserve quota.",
            calls_today,
            MAX_REQUESTS_PER_DAY,
        )
        return []

    try:
        resp = httpx.get(
            NEWSAPI_URL,
            params={
                "q": SEARCH_QUERY,
                "language": "en",
                "sortBy": "publishedAt",
                "pageSize": 50,
                "apiKey": api_key,
            },
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        _daily_call_log.append(datetime.now(timezone.utc))
        data = resp.json()
    except httpx.HTTPError as e:
        logger.warning("NewsAPI request failed: %s -- skipping this poll cycle.", e)
        return []
    except ValueError as e:
        logger.warning("NewsAPI returned non-JSON response: %s", e)
        return []

    # NewsAPI uses real HTTP status codes for most errors (401, 426, 429...)
    # but also echoes status in the body -- check both rather than trust
    # resp.raise_for_status() alone, since a rate-limit or plan-upgrade
    # response is exactly the kind of thing we need to catch and log
    # clearly (see the Alpha Vantage lesson in this file's docstring).
    if not resp.is_success or data.get("status") == "error":
        logger.warning(
            "NewsAPI API error (HTTP %d): %s -- skipping this poll cycle.",
            resp.status_code,
            data.get("message", data),
        )
        return []

    feed = data.get("articles", [])
    if not feed:
        logger.info("NewsAPI returned no matching articles this cycle (not an error, just no matches).")
        return []

    articles: list[Article] = []
    for item in feed:
        try:
            source_name = (item.get("source") or {}).get("name", "unknown")
            articles.append(
                Article(
                    title=item["title"],
                    description=item.get("description") or "",
                    url=item["url"],
                    source=source_name,
                    published_at=item.get("publishedAt", ""),
                )
            )
        except KeyError as e:
            logger.warning("Skipping malformed article entry, missing %s: %r", e, item)

    logger.info(
        "NewsAPI returned %d articles for further filtering. (%d/%d calls used in the last 24h)",
        len(articles),
        _calls_in_last_24h(),
        MAX_REQUESTS_PER_DAY,
    )
    return articles
