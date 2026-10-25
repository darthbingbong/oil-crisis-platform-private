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
    return await get_route_news(route)


class NewsSimulation(BaseModel):
    mode: Literal["off", "fail", "empty"] = "off"
    expire_cache: bool = False


@router.post("/dev/news-feed")
def simulate_news_feed(req: NewsSimulation):
    """DEV-ONLY (like /news/test-inject): 'fail' makes every live fetch fail, 'empty' makes the feed return nothing, 'off' restores
    normal behaviour. expire_cache=true ages every cached result past the ttl so the stale path can be demonstrated. Not for production."""
    return set_simulation(req.mode, req.expire_cache)
