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
