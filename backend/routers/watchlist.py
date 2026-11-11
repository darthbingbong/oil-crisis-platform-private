"""GET /api/v1/vessels/watchlist -- the saved watchlist of real tankers (ShipFinder snapshot), for both map views.

This never calls the provider and never fails: it reads the snapshot file written by tools/prewarm_ais.py. With no file (a clean checkout, or a machine that never
captured one) it answers status NONE with an empty list, and the app shows only simulated vessels. Everything it returns is a SNAPSHOT: the freshness rule
(services/ais_watchlist.classify_vessel) is applied to the time of THIS request, so a record is never shown as live unless a deliberate refresh just happened.

The samples are listed by label only. A sample is the vessels within 10 nm of one seed vessel; it is never offered as coverage of a chokepoint or any area.
"""

import time
from datetime import datetime, timezone

from fastapi import APIRouter

from services import ais_watchlist as wl
from services import shipfinder as sf

router = APIRouter(prefix="/api/v1")

NONE_NOTE = "No saved snapshot of real tankers on this machine. Only simulated vessels (labelled SIMULATED) can be shown."


def _parse(ts: str | None) -> float | None:
    try:
        return datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp() if ts else None
    except ValueError:
        return None


def _vessel(v: dict, now: float) -> dict:
    fetched = _parse(v.get("record_fetched_utc"))
    # a record dated in the future (a clock error) can never count as fresh: it is a SNAPSHOT
    fetch_age = float("inf") if fetched is None or fetched > now + 60 else max(0.0, now - fetched)
    pos_age_at_fetch = v.get("position_age_s")
    seen_age_now = None if pos_age_at_fetch is None or fetch_age == float("inf") else round(pos_age_at_fetch + fetch_age)      # unknown if the fetch time is unusable
    flag = v.get("flag_registry") or v.get("flag_from_mmsi_prefix")
    return {
        "mmsi": v.get("mmsi"), "imo": v.get("imo"), "name": v.get("name"), "flag": flag,
        "flag_source": "provider registry (Vessel Flag Information)" if v.get("flag_registry") else ("MMSI prefix (the transponder's claim)" if flag else None),
        "ship_type": v.get("ship_type"), "length_m": v.get("length_m"), "draught_m": v.get("draught_m"), "destination": v.get("destination"),
        "sog_kn": v.get("sog_kn"), "cog_deg": v.get("cog_deg"), "heading_deg": v.get("heading_deg"),
        "nav_status": v.get("nav_status"), "lat": v.get("lat"), "lng": v.get("lng"),
        "last_seen_utc": v.get("last_seen_utc"), "last_seen_age_s_now": seen_age_now, "record_fetched_utc": v.get("record_fetched_utc"),
        "position_confirmed_by": v.get("position_confirmed_by"), "area": v.get("area", wl.HUELVA_AREA),
        "state": wl.classify_vessel(pos_age_at_fetch, fetch_age), "typed_as_tanker_by": v.get("typed_as_tanker_by"),
        "cargo_note": "cargo type not confirmed by AIS",
    }


@router.get("/vessels/watchlist")
def watchlist() -> dict:
    snap = wl.load_watchlist(wl.watchlist_file())
    from routers.ais import key_info          # imported here: routers.ais imports this module
    snap_for_key = wl.load_watchlist(wl.watchlist_file())
    key = key_info((snap_for_key or {}).get("captured_at_utc"))
    base = {"provider": "ShipFinder", "key_expires_in_days": sf.days_until_expiry(), "key": key, "key_expired": key["expired"], "key_line": key["line"]}
    if not snap or not isinstance(snap.get("watchlist"), list):
        return {**base, "status": "NONE", "captured_at_utc": None, "label": None, "note": NONE_NOTE, "vessels": [], "samples": []}
    now = time.time()
    samples = [snap["sample"], *snap.get("extra_samples", [])] if snap.get("sample") else list(snap.get("extra_samples", []))
    return {
        **base, "status": "SNAPSHOT", "captured_at_utc": snap.get("captured_at_utc"),
        "label": snap.get("watchlist_label") or "A sample of real tankers near Huelva, Spain, seen at the time shown. Not chokepoint traffic and not coverage of any area.",
        "note": "Saved positions, not live. Each vessel shows when it was last seen.",
        "vessels": [_vessel(v, now) for v in snap["watchlist"] if isinstance(v.get("lat"), (int, float)) and isinstance(v.get("lng"), (int, float))],
        "samples": [{"label": s.get("label"), "area": s.get("area", wl.HUELVA_AREA), "seed": s.get("seed"), "fetched_utc": s.get("fetched_utc"), "radius_nm": s.get("radius_nm"),
                     "returned": s.get("returned"), "caveat": s.get("caveat")} for s in samples],
    }
