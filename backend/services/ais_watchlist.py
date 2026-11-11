"""The real tanker watchlist, the labelled Nearby sample, the freshness rule and the snapshot file (ShipFinder, M10).

What this key can and cannot do (docs/ais_verification.md, docs/DECISIONS.md D1 to D6):
  * Vessels Nearby is centred on ONE vessel with a fixed 10 nm radius. A response is therefore a SAMPLE ("vessels within 10 nm of <vessel>, seen at <time>"),
    never a count for a chokepoint or any area.
  * The watchlist is up to 8 tankers that the PROVIDER typed as tankers (ship type 80 to 89) in that sample. Their positions are confirmed one by one with
    Vessel Position (metered: 50 calls, hard limit of 23 calls in total for the key, DECISIONS D20: 11 used + 12 for the final refresh of 12 tankers). Fleet Position is not used: it needs a fleet made in the console.
  * Nothing here claims what a tanker carries: AIS does not say crude from products.

Freshness (MASTER_PROMPT_2.md section 3.3, applied honestly): there is no background poller on this key (Vessel Position allows 50 calls for the key's whole life),
so a record is LIVE only in the two minutes after a deliberate refresh, and only if the position it carries is under 10 minutes old. A layer is LIVE only if the
last fetch is within two poll intervals AND the MEDIAN position age is under 10 minutes. Everything older is a SNAPSHOT shown with its time.
"""

import json
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from services import ais_feed
from services import shipfinder as sf

BACKEND = Path(__file__).resolve().parent.parent
RAW_DIR = BACKEND / "data" / "ais_raw"
SNAP_DIR = RAW_DIR / "snapshots"
WATCHLIST_FILE = SNAP_DIR / "watchlist.json"

TANKER_TYPES = range(80, 90)                  # AIS ship types 80 to 89: tankers (the provider's own typing)
MAX_WATCHLIST = 8
# Vessel Position, calls in total for the key (50 allowed). History: 14, then 16 (owner, 2026-11-03: refresh all 8), then 23 (owner, 2026-11-04:
# the watchlist grew to 12 tankers and Fleet Position cannot take a list of MMSIs). 11 used before the final snapshot + 12 refresh calls = 23. Nothing may pass it.
POSITION_ABSOLUTE_LIMIT = 23
POSITION_CALL_CEILING = POSITION_ABSOLUTE_LIMIT
POLL_INTERVAL_S = 60                          # a deliberate refresh counts as one poll
LIVE_FETCH_MAX_AGE_S = 2 * POLL_INTERVAL_S    # "within two poll intervals"
LIVE_MEDIAN_POSITION_AGE_S = 10 * 60          # "median position age under 10 minutes"
STALE_POSITION_AGE_S = 60 * 60

NAV_STATUS = {0: "underway", 1: "at anchor", 2: "not under command", 3: "restricted manoeuvrability", 4: "constrained by draught", 5: "moored",
              6: "aground", 7: "fishing", 8: "under sail"}       # provider's Navigation Status table; anything else is "not reported"
SIZE_BUCKETS = ((100, "under 100 m"), (180, "100 to 180 m"), (250, "180 to 250 m"), (10_000, "over 250 m"))


def utc_iso(ts: float | int) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def is_tanker(row: dict) -> bool:
    t = row.get("ship_type")
    return isinstance(t, int) and t in TANKER_TYPES


def size_bucket(length) -> str:
    if not isinstance(length, (int, float)) or length <= 0:
        return "size unknown"
    return next(label for limit, label in SIZE_BUCKETS if length < limit)


def moving(row: dict) -> bool:
    return isinstance(row.get("sog"), (int, float)) and row["sog"] > 0.5


def pick_watchlist(rows: list[dict], n: int = MAX_WATCHLIST) -> list[dict]:
    """Up to n tankers (provider-typed), chosen for variety: a new flag, size band, motion state and exact ship type each count as a point. Deterministic."""
    seen: dict[int, dict] = {}
    for r in rows:
        if is_tanker(r) and isinstance(r.get("mmsi"), int) and r["mmsi"] not in seen:
            seen[r["mmsi"]] = r
    pool = sorted(seen.values(), key=lambda r: (-(r.get("last_time") or 0), r["mmsi"]))
    chosen: list[dict] = []
    flags, sizes, motion, types = set(), set(), set(), set()
    while pool and len(chosen) < n:
        def gain(r: dict) -> int:
            return ((ais_feed.flag_from_mmsi(r["mmsi"]) or str(r["mmsi"])[:3]) not in flags) + (size_bucket(r.get("length")) not in sizes) \
                + (moving(r) not in motion) + (r["ship_type"] not in types)
        best = max(pool, key=gain)               # max keeps the first of equals, so the freshest report wins a tie
        pool.remove(best)
        chosen.append(best)
        flags.add(ais_feed.flag_from_mmsi(best["mmsi"]) or str(best["mmsi"])[:3])
        sizes.add(size_bucket(best.get("length")))
        motion.add(moving(best))
        types.add(best["ship_type"])
    return chosen


def clean_vessel(row: dict, fetched_at: float) -> dict:
    """Provider record -> our fields. The provider's 'not available' sentinels become None; nothing is invented."""
    def num(v, bad=()):
        return v if isinstance(v, (int, float)) and v not in bad else None
    last = row.get("last_time") if isinstance(row.get("last_time"), int) else None
    nav = row.get("navistat")
    return {
        "mmsi": row.get("mmsi"), "imo": row.get("imo") or None, "name": (row.get("ship_name") or "").strip() or None, "call_sign": (row.get("call_sign") or "").strip() or None,
        "ship_type": row.get("ship_type"), "length_m": num(row.get("length"), (0,)), "width_m": num(row.get("width"), (0,)), "draught_m": num(row.get("draught"), (0,)),
        "destination": (row.get("dest") or "").strip() or None, "eta": row.get("eta") or None,
        "nav_status_code": nav if nav in NAV_STATUS else None, "nav_status": NAV_STATUS.get(nav, "not reported"),
        "sog_kn": num(row.get("sog"), (-1,)), "cog_deg": num(row.get("cog"), (-1,)), "heading_deg": num(row.get("hdg"), (511,)),
        "lat": row.get("lat"), "lng": row.get("lng"),
        "source": {0: "terrestrial AIS", 1: "satellite AIS"}.get(row.get("data_source"), "unknown"),
        "last_time": last, "last_seen_utc": utc_iso(last) if last else None,
        "position_age_s": max(0, round(fetched_at - last)) if last else None,
    }


def classify_vessel(position_age_s: float | None, fetch_age_s: float) -> str:
    """LIVE only after a deliberate refresh (fetch within two poll intervals) with a position under 10 minutes old; otherwise SNAPSHOT."""
    if position_age_s is None or fetch_age_s > LIVE_FETCH_MAX_AGE_S:
        return "SNAPSHOT"
    if position_age_s < LIVE_MEDIAN_POSITION_AGE_S:
        return "LIVE"
    return "DELAYED" if position_age_s < STALE_POSITION_AGE_S else "STALE"


def classify_layer(position_ages_s: list[float], fetch_age_s: float) -> str:
    """The prompt's layer rule: last poll within two poll intervals AND median position age under 10 minutes."""
    ages = [a for a in position_ages_s if a is not None]
    if not ages or fetch_age_s > LIVE_FETCH_MAX_AGE_S:
        return "SNAPSHOT"
    median = statistics.median(ages)
    return "LIVE" if median < LIVE_MEDIAN_POSITION_AGE_S else ("DELAYED" if median < STALE_POSITION_AGE_S else "STALE")


# ------------------------------------------------------------------------------------------------------------------ provider steps (each stops at the first error)
HOLD_AFTER_ONE_CALL = "the one Nearby call authorised on 2026-11-03 has been used; ask the owner before any other"


def capture_nearby_sample(client: sf.ShipFinderClient, seed_mmsi: int, raw_dir: Path = RAW_DIR / "nearby") -> dict:
    """EXACTLY ONE Vessels Nearby call. The hold is released for this call only and is put back whatever happens (success, refusal, timeout, garbage).
    A failure leaves the breaker open as well, and raises: the caller must not retry."""
    client.clear_hold("vessels_nearby")
    try:
        return client.call("vessels_nearby", {"mmsi": seed_mmsi}, f"first sample: vessels within 10 nm of MMSI {seed_mmsi} (owner-authorised single call)",
                           raw_dir=raw_dir, raw_name=f"nearby_{seed_mmsi}")
    finally:
        client.set_hold("vessels_nearby", HOLD_AFTER_ONE_CALL)


def fetch_positions(client: sf.ShipFinderClient, mmsis: list[int], raw_dir: Path = RAW_DIR / "positions", ceiling: int = POSITION_CALL_CEILING,
                    sleep: Callable[[float], None] = time.sleep) -> tuple[dict[int, dict], str | None]:
    """Vessel Position, one call per vessel, never beyond `ceiling` calls in total for the key (and never beyond POSITION_ABSOLUTE_LIMIT whatever the caller passes).
    Stops at the first error. Returns (rows by mmsi, why it stopped or None)."""
    ceiling = min(ceiling, POSITION_ABSOLUTE_LIMIT)
    out: dict[int, dict] = {}
    for m in mmsis:
        if client.service_state("vessel_position")["used"] >= ceiling:
            return out, f"stopped at the hard ceiling of {ceiling} Vessel Position calls"
        sleep(sf.SERVICES["vessel_position"].min_interval_s + 0.1)
        try:
            body = client.call("vessel_position", {"mmsi": m}, f"watchlist position {m}", raw_dir=raw_dir, raw_name=f"position_{m}")
        except sf.AISError as e:
            return out, f"stopped at the first error: {e.kind}: {e}"
        if isinstance(body.get("data"), dict) and body["data"].get("mmsi"):
            out[m] = body["data"]
    return out, None


def fetch_flags(client: sf.ShipFinderClient, mmsis: list[int], raw_dir: Path = RAW_DIR / "flags", sleep: Callable[[float], None] = time.sleep) -> tuple[dict[int, str], str | None]:
    """Vessel Flag Information (unmetered), one call per vessel, stops at the first error."""
    out: dict[int, str] = {}
    for m in mmsis:
        sleep(sf.SERVICES["vessel_flag"].min_interval_s + 0.1)
        try:
            body = client.call("vessel_flag", {"mmsi": m}, f"watchlist flag {m}", raw_dir=raw_dir, raw_name=f"flag_{m}")
        except sf.AISError as e:
            return out, f"stopped at the first error: {e.kind}: {e}"
        reg = (body.get("data") or {}).get("registry") if isinstance(body.get("data"), dict) else None
        if reg:
            out[m] = reg
    return out, None


TRACK_WINDOW_S = 7 * 24 * 3600                # the docs give no per-call window limit (only "the latest month" of history); 7 days is well inside it


def fetch_track(client: sf.ShipFinderClient, mmsi: int, now: float, window_s: int = TRACK_WINDOW_S, raw_dir: Path = RAW_DIR / "tracks") -> dict:
    """ONE Vessel History Track call (metered: 10 for the key's whole life). The raw response is saved by the client before anything else happens.
    Raises AISError on any non-zero status, timeout or unreadable reply (the breaker opens); the caller must stop and not retry."""
    return client.call("vessel_track", {"mmsi": mmsi, "start_time": int(now - window_s), "end_time": int(now), "output": 1}, f"past track for MMSI {mmsi}, {window_s // 86400} days",
                       raw_dir=raw_dir, raw_name=f"track_{mmsi}")


# ------------------------------------------------------------------------------------------------------------------ a second sample, for location variety
HUELVA_AREA = "Huelva, Spain (Gulf of Cadiz)"
NEARBY_SPACING_S = 30 * 60                    # owner's rule: a Nearby call no sooner than 30 minutes after the previous one (the client's own minimum is 30 s)
EXTRA_TANKERS_FROM_SAMPLE = 3                 # plus the seed itself = at most 4 added to the watchlist


def add_location_sample(snapshot: dict, body: dict, seed_mmsi: int, fetched_at: float, seed_position: dict | None, area: str, n_extra: int = EXTRA_TANKERS_FROM_SAMPLE) -> dict:
    """Adds a second labelled sample and up to 1 + n_extra of its tankers (the seed, whose position was confirmed with Vessel Position, then tankers chosen for variety whose
    positions come from the sample itself, labelled so). Never spends a provider call. The first sample's vessels are tagged with their area."""
    for v in snapshot["watchlist"]:
        v.setdefault("area", HUELVA_AREA)
    rows = body["data"]
    seed_row = next((r for r in rows if r.get("mmsi") == seed_mmsi), None)
    seed_name = ((seed_position or seed_row or {}).get("ship_name") or "").strip() or f"MMSI {seed_mmsi}"
    others = pick_watchlist([r for r in rows if r.get("mmsi") != seed_mmsi], n=n_extra)
    added = []
    if seed_position is not None and is_tanker(seed_position):
        v = clean_vessel(seed_position, seed_position["_fetched_at"])
        v.update(position_confirmed_by="Vessel Position", record_fetched_utc=utc_iso(seed_position["_fetched_at"]), flag_registry=None, flag_from_mmsi_prefix=ais_feed.flag_from_mmsi(seed_mmsi),
                 typed_as_tanker_by="provider (ship type %s)" % seed_position["ship_type"], cargo_note="cargo type not confirmed by AIS", state_when_captured="SNAPSHOT", area=area)
        added.append(v)
    for r in others:
        v = clean_vessel(r, fetched_at)
        v.update(position_confirmed_by="Vessels Nearby sample only", record_fetched_utc=utc_iso(fetched_at), flag_registry=None, flag_from_mmsi_prefix=ais_feed.flag_from_mmsi(r["mmsi"]),
                 typed_as_tanker_by="provider (ship type %s)" % r["ship_type"], cargo_note="cargo type not confirmed by AIS", state_when_captured="SNAPSHOT", area=area)
        added.append(v)
    snapshot["watchlist"].extend(added)
    snapshot.setdefault("extra_samples", []).append({
        "label": f"vessels within 10 nm of {seed_name}, seen at {utc_iso(fetched_at)[11:16]} UTC", "area": area, "seed": {"mmsi": seed_mmsi, "name": seed_name},
        "fetched_utc": utc_iso(fetched_at), "radius_nm": 10, "provider_total": body.get("total"), "returned": len(rows), "tankers_typed_by_provider": sum(is_tanker(r) for r in rows),
        "caveat": ("A sample around one vessel, NOT coverage of a chokepoint or any area. Vessels seen by the provider within this circle only; coverage gaps and vessels with AIS "
                   "off are not included; the provider documents no cap on the number returned, so the count is not shown as a total."),
        "vessels": [clean_vessel(r, fetched_at) for r in rows]})
    snapshot["watchlist_label"] = ("A sample of real tankers near Huelva, Spain, and a few in the Strait of Malacca, each group seen at the time shown on it. "
                                   "Not chokepoint traffic and not coverage of any area.")
    return snapshot


def nearby_spacing_wait_s(last_call_epoch: float | None, now: float) -> float:
    """Seconds still to wait before the next Nearby call is allowed (30 minutes after the previous one)."""
    return 0.0 if not last_call_epoch else max(0.0, NEARBY_SPACING_S - (now - last_call_epoch))


# ------------------------------------------------------------------------------------------------------------------ saved tracks (shown after the key has expired)
TRACKS_FILE = SNAP_DIR / "tracks.json"
TRACK_MAX_POINTS = 500


def _nm(a: dict, b: dict) -> float:
    import math
    la1, lo1, la2, lo2 = map(math.radians, (a["lat"], a["lng"], b["lat"], b["lng"]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 3440.065 * math.asin(math.sqrt(h))


def _rdp(pts: list[dict], eps: float) -> list[dict]:
    """Ramer-Douglas-Peucker on a flat projection (iterative, so 7,000 points cannot overflow the stack). Keeps the first and last point."""
    import math
    if len(pts) < 3:
        return pts
    k = math.cos(math.radians(sum(p["lat"] for p in pts) / len(pts)))
    xy = [(p["lng"] * k, p["lat"]) for p in pts]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (x1, y1), (x2, y2) = xy[a], xy[b]
        dx, dy = x2 - x1, y2 - y1
        norm = math.hypot(dx, dy)
        best, idx = -1.0, -1
        for i in range(a + 1, b):
            x0, y0 = xy[i]
            d = math.hypot(x0 - x1, y0 - y1) if norm == 0 else abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / norm
            if d > best:
                best, idx = d, i
        if best > eps and idx > 0:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k_ in zip(pts, keep) if k_]


def downsample_track(points: list[dict], max_points: int = TRACK_MAX_POINTS) -> list[dict]:
    """At most max_points points that keep the shape of the route (the tolerance is searched, not fixed). First and last points are always kept."""
    if len(points) <= max_points:
        return points
    lo, hi = 0.0, 1.0                    # degrees
    best = points[:2]
    for _ in range(28):
        mid = (lo + hi) / 2
        r = _rdp(points, mid)
        if len(r) > max_points:
            lo = mid
        else:
            hi, best = mid, r
    return best


def build_track_record(saved: dict, name: str | None, flag: str | None = None) -> dict:
    """From a raw saved History Track response (as written by the client) to the record the vessel panel shows."""
    pts = sorted((p for p in saved["response"].get("data") or [] if isinstance(p.get("lat"), (int, float)) and isinstance(p.get("lng"), (int, float)) and isinstance(p.get("utc"), int)),
                 key=lambda p: p["utc"])
    if not pts:
        raise ValueError("track has no usable points")
    fetched = datetime.strptime(saved["retrieved_at_utc"], "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
    thin = downsample_track(pts)
    lats, lngs = [p["lat"] for p in pts], [p["lng"] for p in pts]
    speeds = [p["sog"] for p in pts if isinstance(p.get("sog"), (int, float)) and p["sog"] >= 0]
    return {
        "mmsi": saved["params"]["mmsi"], "name": name, "flag": flag, "kind": "PAST TRACK",
        "label": f"past track, fetched at {fetched.strftime('%Y-%m-%d %H:%M')} UTC",
        "fetched_utc": fetched.strftime("%Y-%m-%dT%H:%M:%SZ"), "provider": "ShipFinder (Vessel History Track)",
        "window_utc": [utc_iso(saved["params"]["start_time"]), utc_iso(saved["params"]["end_time"])],
        "first_point_utc": utc_iso(pts[0]["utc"]), "last_point_utc": utc_iso(pts[-1]["utc"]),
        "points_provider": len(pts), "points_stored": len(thin),
        "path_nm": round(sum(_nm(a, b) for a, b in zip(pts, pts[1:])), 1), "start_to_end_nm": round(_nm(pts[0], pts[-1]), 1),
        "max_sog_kn": max(speeds) if speeds else None, "moving_share_pct": round(100 * sum(s > 1 for s in speeds) / len(speeds)) if speeds else None,
        "bbox": {"lat": [min(lats), max(lats)], "lng": [min(lngs), max(lngs)]},
        "points": [[round(p["lng"], 5), round(p["lat"], 5), p["utc"], p.get("sog")] for p in thin],       # [lng, lat, unix seconds, sog]
        "note": "A saved past track. AIS positions only; the line joins reported positions and is not a surveyed route. Thinned to keep its shape.",
    }


def save_tracks(records: list[dict], path: Path = TRACKS_FILE) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"kind": "SAVED PAST TRACKS", "tracks": records}, ensure_ascii=False), encoding="utf-8")
    return path


def load_track(mmsi: int, path: Path = TRACKS_FILE) -> dict | None:
    """The saved track for a vessel, or None. Never raises: after the key expires the panel shows this record with its date."""
    try:
        return next((t for t in json.loads(path.read_text(encoding="utf-8")).get("tracks", []) if t.get("mmsi") == mmsi), None)
    except (OSError, ValueError):
        return None


# ------------------------------------------------------------------------------------------------------------------ the snapshot
def build_snapshot(sample_body: dict, seed_mmsi: int, sample_fetched_at: float, picked: list[dict], positions: dict[int, dict], position_fetched_at: float | None,
                   flags: dict[int, str], notes: list[str], budget: dict) -> dict:
    rows = sample_body["data"]
    seed = next((r for r in rows if r.get("mmsi") == seed_mmsi), None)
    seed_name = (seed or {}).get("ship_name", "").strip() or f"MMSI {seed_mmsi}"
    sample_vessels = [clean_vessel(r, sample_fetched_at) for r in rows]
    watch = []
    for r in picked:
        m = r["mmsi"]
        confirmed = m in positions
        v = clean_vessel(positions[m], position_fetched_at) if confirmed else clean_vessel(r, sample_fetched_at)
        fetched = position_fetched_at if confirmed else sample_fetched_at
        v.update(position_confirmed_by="Vessel Position" if confirmed else "Vessels Nearby sample only", record_fetched_utc=utc_iso(fetched),
                 flag_registry=flags.get(m), flag_from_mmsi_prefix=ais_feed.flag_from_mmsi(m), typed_as_tanker_by="provider (ship type %s)" % r["ship_type"],
                 cargo_note="cargo type not confirmed by AIS")
        v["state_when_captured"] = "SNAPSHOT"
        watch.append(v)
    return {
        "kind": "SNAPSHOT", "provider": "ShipFinder", "captured_at_utc": utc_iso(position_fetched_at or sample_fetched_at),
        "sample": {
            "label": f"vessels within 10 nm of {seed_name}, seen at {utc_iso(sample_fetched_at)[11:16]} UTC",
            "seed": {"mmsi": seed_mmsi, "name": seed_name}, "fetched_utc": utc_iso(sample_fetched_at), "radius_nm": 10,
            "provider_total": sample_body.get("total"), "returned": len(rows), "tankers_typed_by_provider": sum(is_tanker(r) for r in rows),
            "caveat": ("A sample around one vessel, NOT coverage of a chokepoint or any area. Vessels seen by the provider within this circle only; coverage gaps and "
                       "vessels with AIS off are not included; the provider documents no cap on the number returned, so the count is not shown as a total."),
            "vessels": sample_vessels,
        },
        "watchlist": watch, "notes": notes, "provider_calls": budget,
        "freshness_rule": "LIVE only within two minutes of a deliberate refresh and with a position under 10 minutes old; otherwise SNAPSHOT with its time.",
    }


FINAL_SNAPSHOT_WINDOW = ("2026-11-11", "2026-11-12")      # owner decision (D12/D20, moved 2026-11-11): the key expires on 2026-11-13


def in_final_snapshot_window(now: float) -> bool:
    day = utc_iso(now)[:10]
    return FINAL_SNAPSHOT_WINDOW[0] <= day <= FINAL_SNAPSHOT_WINDOW[1]


def refresh_snapshot(snapshot: dict, positions: dict[int, dict], fetched_at: float, budget: dict, notes: list[str] | None = None) -> tuple[dict, int]:
    """Final snapshot: every watchlist vessel whose Vessel Position call succeeded gets its new position and time; its flag, area and labels are kept. A vessel whose call
    did not happen or failed keeps its older record and its older time (nothing is faked). The Nearby samples are never touched. Returns (snapshot, vessels refreshed)."""
    refreshed = 0
    for i, old in enumerate(snapshot["watchlist"]):
        pos = positions.get(old["mmsi"])
        if not pos:
            continue
        v = clean_vessel(pos, fetched_at)
        v.update({k: old.get(k) for k in ("flag_registry", "flag_from_mmsi_prefix", "typed_as_tanker_by", "cargo_note", "area")})
        v.update(position_confirmed_by="Vessel Position", record_fetched_utc=utc_iso(fetched_at), state_when_captured="SNAPSHOT")
        snapshot["watchlist"][i] = v
        refreshed += 1
    if refreshed:
        snapshot["captured_at_utc"] = utc_iso(fetched_at)
        snapshot["final_snapshot"] = {"taken_utc": utc_iso(fetched_at), "vessels_refreshed": refreshed, "vessels_total": len(snapshot["watchlist"])}
    snapshot["provider_calls"] = budget
    if notes:
        snapshot["notes"] = list(snapshot.get("notes") or []) + notes
    return snapshot, refreshed


def save_snapshot(snapshot: dict, path: Path = WATCHLIST_FILE) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(snapshot, indent=1, ensure_ascii=False), encoding="utf-8")
    return path


def load_watchlist(path: Path = WATCHLIST_FILE) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
