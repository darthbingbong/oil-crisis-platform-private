"""Loads the M1 data files once and resolves route ids (including the legacy chokepoint spellings)."""

import json
from functools import lru_cache
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# Spellings the original /api/v1/routes/{chokepoint} endpoint accepted (matched lowercase).
LEGACY_CHOKEPOINTS = {"hormuz": "hormuz", "bab_el_mandeb": "bab el-mandeb", "suez": "suez", "malacca": "malacca"}


@lru_cache(maxsize=1)
def routes_doc() -> dict:
    return json.loads((DATA_DIR / "routes.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def lithium_doc() -> dict:
    return json.loads((DATA_DIR / "lithium_usgs.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def validated_supply_loss_max_pct() -> float:
    """Largest supply loss among the 21 daily-resolution events the formula's error band was measured on."""
    import pandas as pd
    e = pd.read_csv(DATA_DIR / "events.csv")
    return float(e[e["resolution"] == "daily"]["supply_loss_pct"].abs().max())


@lru_cache(maxsize=1)
def validated_reference() -> dict:
    """The largest-supply-loss event among the 21 daily-resolution validation events, with its ACTUAL price move,
    computed exactly as phase1_analysis.py does (nearest daily WTI price 5 days before vs 30 days after the event)."""
    import pandas as pd
    ev = pd.read_csv(DATA_DIR / "events.csv", parse_dates=["event_date"])
    daily = pd.read_csv(DATA_DIR / "oil_daily_prices.csv", parse_dates=["date"]).sort_values("date")

    def px(d):
        c = daily[(daily["date"] >= d) & daily["wti"].notna()]
        return float(c.iloc[0]["wti"])

    ev = ev[ev["resolution"] == "daily"]
    n_events = int(len(ev))
    top = ev.loc[ev["supply_loss_pct"].abs().idxmax()]
    before, after = px(top["event_date"] - pd.Timedelta(days=5)), px(top["event_date"] + pd.Timedelta(days=30))
    return {
        "name": str(top["name"]), "date": top["event_date"].strftime("%Y-%m-%d"), "n_events": n_events,
        "supply_loss_pct": float(top["supply_loss_pct"]),
        "actual_price_move_pct": (after - before) / before * 100.0,
        "price_window": "WTI nearest daily price 5 days before vs 30 days after the event (same method as phase1_analysis.py)",
        "note": "events.csv marks this event's supply loss as a ROUGH ESTIMATE and still unfolding, so the top of the validated range is itself uncertain."
        if "ROUGH ESTIMATE" in str(top["notes"]) else None,
    }


def normalize_id(raw: str) -> str:
    """'Bab el-Mandeb', 'bab el-mandeb' and 'bab_el_mandeb' all become 'bab_el_mandeb'."""
    return raw.strip().lower().replace(" ", "_").replace("-", "_")


def all_routes() -> list[dict]:
    return routes_doc()["routes"]


def get_route(raw_id: str) -> dict | None:
    rid = normalize_id(raw_id)
    return next((r for r in all_routes() if r["id"] == rid), None)


def legacy_name(route_id: str) -> str | None:
    """The old endpoint's chokepoint key for this route id, or None if the old endpoint never knew it."""
    return LEGACY_CHOKEPOINTS.get(route_id)
