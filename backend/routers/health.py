"""GET /api/v1/health -- the state of each external feed, in one place, so a presenter can see before a demo what will be live data, what will be a fallback.

Each feed reports  state: ok | degraded | fallback | unknown  plus a plain sentence. Nothing here calls an external service except the price feed,
and that only when its own 15-minute cache is empty (the same call the ticker makes), so polling this endpoint is cheap.

    price  ok        EIA answered (status DAILY_CLOSE)
           fallback  EIA could not be used; the ticker shows the last row of the local CSV (OFFLINE_FALLBACK)
    news   ok        at least one route has a fresh cached result
           degraded  only stale cached results or the demo snapshot are available
           unknown   nothing cached yet (the warm-up has not finished, or it is switched off)
    ais    fallback  no AISSTREAM_API_KEY: simulated vessels only
           ok        frames are arriving (still UNVERIFIED against the live feed)
           degraded  connecting, or the connection failed and is retrying
overall: ok only if every feed is ok; fallback if any feed is running on its fallback; otherwise degraded.
"""

from fastapi import APIRouter

from services import ais_feed, news_feed
from services.price_feed import PriceFeedError, get_service
from services.route_data import all_routes

router = APIRouter(prefix="/api/v1")


async def _price() -> dict:
    try:
        live = await get_service().live()
    except PriceFeedError as e:
        return {"state": "fallback", "detail": f"No price source answered ({e.kind}).", "status": None}
    ok = live["status"] == "DAILY_CLOSE"
    return {
        "state": "ok" if ok else "fallback", "status": live["status"], "as_of": live["as_of"], "age_days": live["age_days"],
        "detail": ("EIA answered; this is the latest published daily close, not a live quote." if ok
                   else live.get("fallback_message") or "EIA could not be used; showing the last row of the local CSV."),
    }


def _news() -> dict:
    cache = news_feed.default_cache()
    fresh = stale = 0
    for r in all_routes():
        if r.get("type") == "pipeline":
            continue
        entry = cache.get(f"news_{r['id']}")
        if entry is None:
            continue
        if cache.is_fresh(entry):
            fresh += 1
        else:
            stale += 1
    snapshot = len(news_feed.load_snapshot().get("routes") or {})
    if fresh:
        state, detail = "ok", f"{fresh} route(s) have fresh cached headlines ({stale} stale)."
    elif stale or snapshot:
        state, detail = "degraded", f"No fresh headlines: {stale} stale cached route(s); the demo snapshot covers {snapshot} route(s) and is always labelled."
    else:
        state, detail = "unknown", "Nothing cached yet. The startup warm-up may still be running, or NEWS_WARMUP is off."
    return {"state": state, "detail": detail, "fresh_routes": fresh, "stale_routes": stale, "snapshot_routes": snapshot, "simulation_mode": news_feed.simulation_mode()}


def _ais() -> dict:
    s = ais_feed.get_hub().status()
    state = {"no_key": "fallback", "streaming": "ok", "connecting": "degraded", "error": "degraded", "idle": "degraded"}.get(s["state"], "unknown")
    return {"state": state, "detail": s["detail"], "provider_state": s["state"], "verified_against_live_feed": s["verified_against_live_feed"],
            "note": "Without a key the globe shows SIMULATED vessels." if s["state"] == "no_key" else s["disclaimer"]}


@router.get("/health")
async def health() -> dict:
    feeds = {"price": await _price(), "news": _news(), "ais": _ais()}
    states = {f["state"] for f in feeds.values()}
    overall = "ok" if states == {"ok"} else "fallback" if "fallback" in states else "degraded"
    return {"overall": overall, "feeds": feeds}
