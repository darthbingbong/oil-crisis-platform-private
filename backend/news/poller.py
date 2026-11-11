"""
Background polling loop -- started from main.py's FastAPI lifespan, runs
inside the same process (no separate scheduler/worker needed at this
scale). One pass: fetch -> relevance filter -> dedup -> classify -> apply
to the price engine -> record.

Resilience, per the project brief: a failed poll cycle backs off and
retries rather than crashing the server or hammering a failing endpoint;
every outcome (skipped, classified, errored) is logged so the cause of any
gap is visible after the fact.
"""

import asyncio
import logging
import os

from . import db, price_engine
from .classify import active_classifier_name, classify_article
from .ingestion import fetch_live_articles, url_hash
from .models import Article, ClassifiedEvent
from .relevance import is_relevant

logger = logging.getLogger("news_pipeline")

# NewsAPI's free tier is documented as 100 requests/day. Default to every
# 20 minutes (72 calls/day, a safety margin under the cap) -- override via
# NEWS_POLL_INTERVAL_SECONDS in backend/.env if your plan allows more.
DEFAULT_POLL_INTERVAL_SECONDS = 20 * 60
POLL_INTERVAL_SECONDS = int(os.environ.get("NEWS_POLL_INTERVAL_SECONDS", DEFAULT_POLL_INTERVAL_SECONDS))

# If a poll cycle throws, wait this long (not the full interval, not an
# instant retry) before trying again.
ERROR_BACKOFF_SECONDS = 2 * 60


async def run_poll_cycle() -> list[tuple[Article, ClassifiedEvent, str]]:
    """One fetch-filter-classify-price pass. Returns (article, event,
    classifier_used) for every article that was actually classified this
    cycle (whether or not price_relevant)."""
    articles = await asyncio.to_thread(fetch_live_articles)
    return await process_articles(articles)


async def process_articles(articles: list[Article]) -> list[tuple[Article, ClassifiedEvent, str]]:
    """The steps shared by the NewsAPI poller and the hosted GDELT bridge: skip what was processed, filter, classify, record, price."""
    new_events: list[tuple[Article, ClassifiedEvent, str]] = []

    for article in articles:
        h = url_hash(article.url)
        if db.is_processed(h):
            continue

        if not is_relevant(article.title, article.description):
            db.record_skipped(h, article, reason="skipped_not_relevant")
            continue

        try:
            event, classifier_used = await asyncio.to_thread(classify_article, article)
        except Exception:
            logger.exception("Classification failed for %s -- leaving unprocessed for next cycle.", article.url)
            continue

        db.record_classification(h, article, event, classifier_used)
        await asyncio.to_thread(price_engine.apply_event, article, event, classifier_used)
        new_events.append((article, event, classifier_used))

    return new_events


async def poll_loop() -> None:
    logger.info(
        "News poller starting, interval=%ss, active classifier=%s",
        POLL_INTERVAL_SECONDS,
        active_classifier_name(),
    )
    while True:
        try:
            events = await run_poll_cycle()
            if events:
                logger.info("Poll cycle complete: %d new article(s) classified.", len(events))
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            logger.info("News poller stopping.")
            raise
        except Exception:
            logger.exception("Poll cycle crashed -- backing off %ss before retrying.", ERROR_BACKOFF_SECONDS)
            await asyncio.sleep(ERROR_BACKOFF_SECONDS)
