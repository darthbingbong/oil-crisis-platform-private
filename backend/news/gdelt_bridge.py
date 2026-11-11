"""Hosted mode has no NewsAPI, so the classifier pipeline is fed from the GDELT headlines the scheduled refresh already fetched for each route.

One headline goes through exactly the same steps as a NewsAPI article (poller.process_articles): already-processed check, relevance filter, classification
(Claude under the caps of claude_governor, else rules), record, price engine. A headline seen before is never classified twice (the url hash is recorded,
and claude_governor caches by headline text too). No network call is made here; the GDELT fetch happened in services.news_feed.
"""

from .models import Article
from .poller import process_articles


async def classify_route_items(items: list[dict]) -> int:
    """items: normalised GDELT items (title, source, published_at, url). Returns how many were newly classified."""
    articles = [Article(title=i["title"], description="", url=i["url"], source=i.get("source", "gdelt"), published_at=i.get("published_at", "")) for i in items]
    return len(await process_articles(articles))
