"""Hosted mode (M16): which sources a PUBLIC deployment may use, and how it serves visitors.

Local mode (HOSTED_MODE unset or 0) changes nothing: every source works as before, limited only by its own key.

Hosted mode (HOSTED_MODE=1) is the safe side by default. Each source has its own flag, HOSTED_ENABLE_<SOURCE>, read on every call:

    ENABLED by default  : EIA, GDELT, TradingView, GEM, Anthropic (capped, cached, with a rule-based fallback),
                          the ShipFinder SNAPSHOT (saved 2026-11-11, shown read-only; DECISIONS D38) and the ShipFinder-derived voyage distances
    DISABLED by default : ShipFinder CALLS (hosted makes none), AISStream (not set up), NewsAPI, Alpha Vantage

Visitors never cause an upstream call in hosted mode (cache_only): a scheduled refresh (services/refresh.py) fills the caches once a day.
Only the NAMES of sources and their public attributions are here; no key, no secret, nothing from the environment is ever returned.
"""

import os

_TRUE = {"1", "true", "yes", "on"}

SHIPFINDER_ATTRIBUTION = "Real tanker positions: ShipFinder snapshot (2026-11-11, non-commercial use). Chokepoint traffic is simulated."

# source -> (enabled by default when hosted, attribution shown in the footer or None, note)
SOURCES: dict[str, dict] = {
    "eia": {"default": True, "label": "U.S. Energy Information Administration (EIA)", "attribution": "WTI and Brent spot prices: U.S. Energy Information Administration (EIA) Open Data, daily closes in a weekly release.", "url": "https://www.eia.gov/opendata/"},
    "gdelt": {"default": True, "label": "GDELT Project", "attribution": "Headline metadata: the GDELT Project (https://www.gdeltproject.org/). Headlines are links to their publishers, not our content.", "url": "https://www.gdeltproject.org/"},
    "tradingview": {"default": True, "label": "TradingView", "attribution": "Market tables: TradingView widgets. Your browser contacts TradingView directly once you scroll to the Markets panel; TradingView states it receives the page address and the symbol. Delays are set by TradingView.", "url": "https://www.tradingview.com/"},
    "gem": {"default": True, "label": "Global Energy Monitor", "attribution": "Refinery and pipeline data derived from: Global Energy Ownership Tracker, Global Energy Monitor, October 2026 release. Licence: CC BY 4.0 per GEM's general statement, not confirmed for this tracker.", "url": "https://globalenergymonitor.org/"},
    "anthropic": {"default": True, "label": "Anthropic", "attribution": "News classification may use Anthropic's Claude on a capped daily and monthly budget, each headline once; otherwise a rule-based classifier runs.", "url": "https://www.anthropic.com/"},
    # CALLS to the provider: never on the public site (the key expires 2026-11-13 and is not set there)
    "shipfinder": {"default": False, "label": "ShipFinder (live calls)", "attribution": None, "url": None},
    # DISPLAY of the saved 2026-11-11 snapshot, read-only (permission: non-commercial use, DECISIONS D38)
    "shipfinder_snapshot": {"default": True, "label": "ShipFinder snapshot", "attribution": SHIPFINDER_ATTRIBUTION, "url": "https://www.shipfinder.com/"},
    "aisstream": {"default": False, "label": "AISStream", "attribution": None, "url": None},
    "newsapi": {"default": False, "label": "NewsAPI", "attribution": None, "url": None},
    "alphavantage": {"default": False, "label": "Alpha Vantage", "attribution": None, "url": None},
    # not a data source: the voyage-distance set. False = the earlier estimated distances (great-circle sums over illustrative waypoints)
    "shipfinder_distances": {"default": True, "label": "ShipFinder-derived voyage distances", "attribution": None, "url": None},
}

DISCLAIMER = "Educational project. Figures are model estimates, not forecasts or financial advice."
PRIVACY = ("Privacy: this site sets no cookies and runs no analytics or visitor tracking. Our server keeps no record of who you are. "
           "The usual server logs (time, address of the request) may exist at the hosting provider, and TradingView's widgets contact TradingView from your browser.")
DEFAULT_REPO_URL = "https://github.com/darthbingbong/oil-crisis-platform-final"


def hosted_mode() -> bool:
    return os.environ.get("HOSTED_MODE", "").strip().lower() in _TRUE


def cache_only() -> bool:
    """True when a visitor's request must never trigger an upstream call (hosted mode). The scheduled refresh passes force=True."""
    return hosted_mode()


def enabled(source: str) -> bool:
    """Local mode: every source is allowed (its own key still decides). Hosted: HOSTED_ENABLE_<SOURCE> if set, else the safe default."""
    if source not in SOURCES:
        raise KeyError(source)
    if not hosted_mode():
        return True
    raw = os.environ.get(f"HOSTED_ENABLE_{source.upper()}", "").strip().lower()
    if raw == "":
        return SOURCES[source]["default"]
    return raw in _TRUE


def estimated_distances() -> bool:
    """True when the voyage days come from the earlier estimated distances. Both modes default to the ShipFinder route-planned distances (D38, which replaced
    the hosted default of D29); HOSTED_ENABLE_SHIPFINDER_DISTANCES=0 switches a hosted site back to the estimates."""
    return hosted_mode() and not enabled("shipfinder_distances")


def repo_url() -> str:
    return os.environ.get("PUBLIC_REPO_URL", "").strip() or DEFAULT_REPO_URL


def frontend_origin() -> str:
    return os.environ.get("FRONTEND_ORIGIN", "").strip().rstrip("/")


def cors_origins() -> list[str]:
    """Local: any origin (development on another port). Hosted: only FRONTEND_ORIGIN; with none set, no cross-origin caller at all."""
    if not hosted_mode():
        return ["*"]
    o = frontend_origin()
    return [o] if o else []


def public_config() -> dict:
    """What the browser may know: the mode, which sources are on and their attributions. No keys, no environment values beyond the public repo URL."""
    return {
        "hosted": hosted_mode(),
        "sources": {k: {"enabled": enabled(k), "label": v["label"], "attribution": v["attribution"] if enabled(k) else None, "url": v["url"] if enabled(k) else None}
                    for k, v in SOURCES.items()},
        "voyage_distances": "estimated" if estimated_distances() else "shipfinder",
        "vessels": "SIMULATED_ONLY" if hosted_mode() and not enabled("shipfinder_snapshot") else "SIMULATED_AND_SAVED_REAL",
        "ais_live_toggle": not hosted_mode(),              # the SIMULATED / AISSTREAM LIVE switch is only for a local run with an AISStream key
        "news_alerts": "route_news" if hosted_mode() else "pipeline",
        "disclaimer": DISCLAIMER, "privacy": PRIVACY, "repo_url": repo_url(),
        "tradingview_note": SOURCES["tradingview"]["attribution"],
    }
