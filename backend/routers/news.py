"""Route news.

    GET  /api/v1/routes/{id}/news      -- recent tagged headlines for one route (GDELT, cached, stale fallback)
    POST /api/v1/dev/news-feed         -- DEV-ONLY: simulate a feed failure or an empty feed, or age the cache

Headline, source, published time, link and tag only. See services/news_feed.py for quality controls and failure handling.
"""

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.news_feed import get_route_news, set_simulation
from services.route_data import get_route

router = APIRouter(prefix="/api/v1")


@router.get("/routes/{route_id}/news")
async def route_news(route_id: str):
    route = get_route(route_id)
    if route is None:
        raise HTTPException(status_code=404, detail=f"Unknown route '{route_id}'")
    # an expired cached result is returned at once (marked stale + refreshing) while a fresh one is fetched in the background
    return await get_route_news(route, stale_while_revalidate=True)


class NewsSimulation(BaseModel):
    mode: Literal["off", "fail", "empty"] = "off"
    expire_cache: bool = False


@router.post("/dev/news-feed")
def simulate_news_feed(req: NewsSimulation):
    """DEV-ONLY (like /news/test-inject): 'fail' makes every live fetch fail, 'empty' makes the feed return nothing, 'off' restores
    normal behaviour. expire_cache=true ages every cached result past the ttl so the stale path can be demonstrated. Not for production."""
    return set_simulation(req.mode, req.expire_cache)


HEADLINES_LIMIT = 30


@router.get("/news/headlines")
async def news_headlines(limit: int = HEADLINES_LIMIT):
    """The hosted site's news feed (D38): the newest GDELT headlines across every route, read from the route-news CACHE only (a visitor never causes a GDELT call
    in hosted mode). Each headline keeps the keyword tag the rule-based tagger gave it, its publisher, publication time and link; each route carries the
    time its cache was fetched. Nothing here is a price event: no simulated price move is attached."""
    from services.route_data import all_routes
    limit = max(1, min(int(limit), 100))
    items, routes, seen = [], [], set()
    for route in all_routes():
        res = await get_route_news(route)
        routes.append({"route_id": route["id"], "route_name": route["name"], "feed_status": res["feed_status"], "last_updated": res["last_updated"], "snapshot": bool(res.get("snapshot"))})
        for it in res["items"]:
            key = it.get("url") or it.get("title")
            if key in seen:
                continue
            seen.add(key)
            items.append({**it, "route_id": route["id"], "route_name": route["name"], "feed_status": res["feed_status"], "fetched_at": res["last_updated"]})
    items.sort(key=lambda i: i.get("published_at") or "", reverse=True)
    live = [r for r in routes if r["feed_status"] in ("ok", "empty", "stale")]
    stamps = [r["last_updated"] for r in live if r["last_updated"]]
    return {
        "status": "ok" if items else ("empty" if live else "warming"),
        "items": items[:limit], "count": len(items), "routes": routes,
        "fetched_oldest": min(stamps) if stamps else None, "fetched_newest": max(stamps) if stamps else None,
        "classifier": "rule-based keyword tags",
        "source": "GDELT Project", "attribution": "Headline metadata from the GDELT Project (https://www.gdeltproject.org/). Headlines link to their publishers; article text is not stored or shown.",
        "message": None if items else ("No headlines are cached yet. The first refresh runs a minute or two after the server starts; try again shortly." if not live else "No matching headlines in the last 7 days."),
    }
