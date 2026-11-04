"""M12 endpoints for the real-vessel layer. Everything here reads SAVED data, except the one explicit provider search.

  GET  /api/v1/ais/budget               calls used and left per ShipFinder service, counted from logs/ais_calls.jsonl (our own log is the only reliable count of the
                                        unmetered services: DECISIONS D15), plus holds, breakers and the key's expiry
  GET  /api/v1/ais/search?q=            the saved watchlist only (name, MMSI or IMO); never calls the provider
  POST /api/v1/ais/search/provider      ONE Vessel Search call, only on an explicit submit; status 31 is "no match"; the client's per-minute limit, minimum interval and
                                        circuit breaker apply; from the key's expiry date no call is made and the answer says so
  GET  /api/v1/vessels/{mmsi}/track     the saved past track (or "no saved track"), served from disk with its fetch time
  GET  /api/v1/vessels/{mmsi}/near      the SAVED Vessels Nearby sample that contains this vessel, labelled with its seed and time. Never a live Nearby call (that
                                        service is on hold) and never a count for a chokepoint or any area

None of these ever returns an error screen's worth of failure: a problem is a plain message in a normal response.
"""

import json
import math
import time
from fastapi import APIRouter
from pydantic import BaseModel

from routers.watchlist import _vessel
from services import ais_feed
from services import ais_watchlist as wl
from services import shipfinder as sf

router = APIRouter(prefix="/api/v1")

PROVIDER_SEARCH_MIN_CHARS = 3
LOCAL_SEARCH_MIN_CHARS = 2
NEAR_LIST_LIMIT = 40


def _client() -> sf.ShipFinderClient:
    """One place that makes the client, so tests can hand the endpoints a client with a mock transport (no test ever reaches the provider)."""
    return sf.ShipFinderClient()


def key_info(saved_utc: str | None = None) -> dict:
    """The key's state and the plain sentence the app shows. `saved_utc` is when the data being shown was saved."""
    days = sf.days_until_expiry()
    expired = sf.key_expired()
    saved_day = (saved_utc or "")[:10] or None
    if expired:
        line = f"AIS key expired, showing data saved on {saved_day}" if saved_day else "AIS key expired, showing saved data"
    else:
        line = f"AIS key expires in {days} day{'s' if days != 1 else ''} ({sf.KEY_EXPIRES.isoformat()})"
    return {"expires_on": sf.KEY_EXPIRES.isoformat(), "expires_in_days": days, "expired": expired, "line": line, "saved_on": saved_day}


# ---------------------------------------------------------------------------------------------------- budget
def _log_counts() -> dict[str, dict]:
    out: dict[str, dict] = {}
    try:
        with open(sf.DEFAULT_CALL_LOG, encoding="utf-8") as f:
            for line in f:
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                s = out.setdefault(str(r.get("service")), {"calls": 0, "ok": 0, "failed": 0, "last_call_utc": None, "last_status": None})
                s["calls"] += 1
                ok = r.get("status") == 0 or (r.get("service") == "vessel_search" and r.get("status") == 31)
                s["ok" if ok else "failed"] += 1
                s["last_call_utc"], s["last_status"] = r.get("ts"), r.get("status")
    except OSError:
        pass
    return out


@router.get("/ais/budget")
def ais_budget() -> dict:
    counts = _log_counts()
    disk = _client().budget()
    services = {}
    for name, svc in sf.SERVICES.items():
        c = counts.get(name, {"calls": 0, "ok": 0, "failed": 0, "last_call_utc": None, "last_status": None})
        d = disk.get(name, {})
        services[name] = {
            "used": c["calls"], "ok": c["ok"], "failed": c["failed"], "quota": svc.quota, "left": None if svc.quota is None else max(0, svc.quota - c["calls"]),
            "metered": svc.quota is not None, "last_call_utc": c["last_call_utc"], "last_status": c["last_status"],
            "hold": d.get("hold"), "breaker": d.get("breaker", "closed"), "retry_in_s": d.get("retry_in_s", 0),
        }
    return {"source": "logs/ais_calls.jsonl (our own log: the provider console does not record unmetered calls)", "key": key_info(), "total_calls": sum(c["calls"] for c in counts.values()),
            "services": services}


# ---------------------------------------------------------------------------------------------------- search
def _saved() -> list[dict]:
    snap = wl.load_watchlist(wl.WATCHLIST_FILE)
    if not snap or not isinstance(snap.get("watchlist"), list):
        return []
    now = time.time()
    return [_vessel(v, now) for v in snap["watchlist"] if isinstance(v.get("lat"), (int, float)) and isinstance(v.get("lng"), (int, float))]


@router.get("/ais/search")
def search_saved(q: str = "") -> dict:
    q = q.strip()
    base = {"query": q, "source": "saved watchlist", "provider_search": {"available": not sf.key_expired(), "min_chars": PROVIDER_SEARCH_MIN_CHARS,
            "note": "AIS key expired: only the saved watchlist can be searched." if sf.key_expired() else "Searching the provider is a separate step and only happens when you press Search the provider."}}
    if len(q) < LOCAL_SEARCH_MIN_CHARS:
        return {**base, "results": [], "message": f"Type at least {LOCAL_SEARCH_MIN_CHARS} characters."}
    needle = q.lower()
    hits = [v for v in _saved() if needle in (v.get("name") or "").lower() or str(v.get("mmsi", "")).startswith(q) or str(v.get("imo") or "").startswith(q)]
    hits.sort(key=lambda v: ((v.get("name") or "").lower().find(needle) != 0, v.get("name") or ""))
    return {**base, "results": [{"mmsi": v["mmsi"], "name": v["name"], "flag": v["flag"], "area": v["area"], "ship_type": v["ship_type"], "nav_status": v["nav_status"]} for v in hits[:10]],
            "message": None if hits else "No saved vessel matches."}


class ProviderSearch(BaseModel):
    q: str


@router.post("/ais/search/provider")
def search_provider(body: ProviderSearch) -> dict:
    q = body.q.strip()
    base = {"query": q, "source": "ShipFinder Vessel Search (one call)", "key": key_info()}
    if len(q) < PROVIDER_SEARCH_MIN_CHARS:
        return {**base, "status": "TOO_SHORT", "results": [], "message": f"Type at least {PROVIDER_SEARCH_MIN_CHARS} characters first."}
    if sf.key_expired():
        return {**base, "status": "KEY_EXPIRED", "results": [], "message": base["key"]["line"] + ". No provider search is made; the saved watchlist can still be searched."}
    saved = {v["mmsi"] for v in _saved()}
    try:
        rows = _client().vessel_search(q, 20)
    except sf.AISError as e:
        wait = f" Try again in {round(e.retry_after_s)} s." if e.retry_after_s else ""
        msgs = {"rate_limited": "Too many searches this minute.", "too_soon": "Searches need a second between them.", "breaker_open": "Provider search is paused after an earlier error.",
                "on_hold": "Provider search is on hold.", "no_key": "No AIS key is configured.", "disabled": "AIS is switched off."}
        return {**base, "status": "UNAVAILABLE", "kind": e.kind, "results": [], "retry_after_s": round(e.retry_after_s) if e.retry_after_s else None,
                "message": msgs.get(e.kind, "The provider could not be reached.") + wait}
    if not rows:
        return {**base, "status": "NO_MATCH", "results": [], "message": "no match"}
    results = []
    for r in rows[:20]:
        last = r.get("last_time") if isinstance(r.get("last_time"), int) else None
        results.append({"mmsi": r.get("mmsi"), "imo": r.get("imo") or None, "name": (r.get("ship_name") or "").strip() or None, "call_sign": (r.get("call_sign") or "").strip() or None,
                        "flag": ais_feed.flag_from_mmsi(r.get("mmsi")) if isinstance(r.get("mmsi"), int) else None,
                        "last_report_utc": wl.utc_iso(last) if last else None, "in_watchlist": r.get("mmsi") in saved})
    return {**base, "status": "OK", "results": results, "message": None,
            "note": "Vessel Search returns no position and no ship type, so these cannot be placed on a map without a paid position call."}


# ---------------------------------------------------------------------------------------------------- track
def track_view(t: dict, headline_mmsi: int | None) -> dict:
    stationary = (t.get("start_to_end_nm") or 0) < 1.0 and (t.get("moving_share_pct") or 0) == 0
    return {
        "status": "SAVED", "mmsi": t["mmsi"], "name": t.get("name"), "label": t.get("label"), "fetched_utc": t.get("fetched_utc"), "window_utc": t.get("window_utc"),
        "first_point_utc": t.get("first_point_utc"), "last_point_utc": t.get("last_point_utc"), "points_provider": t.get("points_provider"), "points_stored": t.get("points_stored"),
        "path_nm": t.get("path_nm"), "start_to_end_nm": t.get("start_to_end_nm"), "max_sog_kn": t.get("max_sog_kn"), "moving_share_pct": t.get("moving_share_pct"),
        "stationary": stationary, "motion_note": "stationary during this window" if stationary else None, "headline": t["mmsi"] == headline_mmsi,
        "points": t.get("points", []), "bbox": t.get("bbox"), "note": t.get("note"),
    }


@router.get("/vessels/{mmsi}/track")
def vessel_track(mmsi: int) -> dict:
    t = wl.load_track(mmsi, wl.TRACKS_FILE)
    if not t:
        return {"status": "NONE", "mmsi": mmsi, "label": "no saved track", "points": [], "key": key_info()}
    try:
        all_tracks = json.loads(wl.TRACKS_FILE.read_text(encoding="utf-8")).get("tracks", [])
        best = max(all_tracks, key=lambda x: x.get("start_to_end_nm") or 0, default=None)
        headline = best["mmsi"] if best and (best.get("start_to_end_nm") or 0) >= 1.0 else None      # the headline is the one that really travelled
    except (OSError, ValueError, KeyError):
        headline = None
    return {**track_view(t, headline), "key": key_info(t.get("fetched_utc"))}


# ---------------------------------------------------------------------------------------------------- saved Nearby samples
def _nm(a: tuple[float, float], b: tuple[float, float]) -> float:
    (la1, lo1), (la2, lo2) = a, b
    p1, p2 = math.radians(la1), math.radians(la2)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lo2 - lo1) / 2) ** 2
    return 3440.065 * 2 * math.asin(min(1.0, math.sqrt(h)))


@router.get("/vessels/{mmsi}/near")
def vessels_near(mmsi: int) -> dict:
    snap = wl.load_watchlist(wl.WATCHLIST_FILE)
    hold = "Live Vessels Nearby is on hold. Only the saved samples below can be shown."
    if not snap:
        return {"status": "NONE", "mmsi": mmsi, "message": "No saved Nearby sample on this machine.", "note": hold, "vessels": []}
    samples = [snap["sample"], *snap.get("extra_samples", [])] if snap.get("sample") else list(snap.get("extra_samples", []))
    for s in samples:
        rows = s.get("vessels") or []
        me = next((r for r in rows if r.get("mmsi") == mmsi), None)
        if not me:
            continue
        here = (me["lat"], me["lng"])
        others = sorted(
            ({"mmsi": r["mmsi"], "name": r.get("name"), "ship_type": r.get("ship_type"), "tanker": wl.is_tanker(r), "nav_status": r.get("nav_status"), "sog_kn": r.get("sog_kn"),
              "distance_nm": round(_nm(here, (r["lat"], r["lng"])), 1)} for r in rows if r.get("mmsi") != mmsi and isinstance(r.get("lat"), (int, float)) and isinstance(r.get("lng"), (int, float))),
            key=lambda r: r["distance_nm"])
        return {"status": "SAVED SAMPLE", "mmsi": mmsi, "label": s.get("label"), "seed": s.get("seed"), "fetched_utc": s.get("fetched_utc"), "radius_nm": s.get("radius_nm"),
                "provider_total": s.get("provider_total"), "returned": s.get("returned"), "caveat": s.get("caveat"), "note": hold, "distances_note": "Distances are from this vessel; the sample itself is centred on its seed.",
                "listed": min(len(others), NEAR_LIST_LIMIT), "vessels": others[:NEAR_LIST_LIMIT], "key": key_info(s.get("fetched_utc"))}
    return {"status": "NOT_IN_SAMPLE", "mmsi": mmsi, "message": "This vessel is not in either saved Nearby sample.", "note": hold, "vessels": []}
