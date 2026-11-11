"""Build the DISPLAY snapshot for the public site from the saved ShipFinder data (DECISIONS D38).

Reads the git-ignored raw snapshot (data/ais_raw/snapshots/watchlist.json and tracks.json) and writes data/ais_display/watchlist.json and tracks.json.
The display files hold ONLY the fields the interface shows (an allow-list below): no raw provider response, no request log, no key, no call counts.
Run on the author's laptop after the final snapshot; the output is committed, the raw folder stays git-ignored.

    python tools/make_display_snapshot.py            # write
    python tools/make_display_snapshot.py --check    # verify the committed files equal what would be written (exit 1 if not)
"""

import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
RAW = BACKEND / "data" / "ais_raw" / "snapshots"
OUT = BACKEND / "data" / "ais_display"

VESSEL_KEYS = ("mmsi", "imo", "name", "ship_type", "length_m", "draught_m", "destination", "nav_status", "sog_kn", "cog_deg", "heading_deg", "lat", "lng",
               "last_seen_utc", "position_age_s", "flag_registry", "flag_from_mmsi_prefix", "typed_as_tanker_by", "area", "position_confirmed_by", "record_fetched_utc")
SAMPLE_VESSEL_KEYS = ("mmsi", "name", "ship_type", "nav_status", "sog_kn", "lat", "lng")
SAMPLE_KEYS = ("label", "area", "fetched_utc", "radius_nm", "provider_total", "returned", "caveat")
TRACK_KEYS = ("mmsi", "name", "flag", "kind", "label", "fetched_utc", "window_utc", "first_point_utc", "last_point_utc", "points_provider", "points_stored",
              "path_nm", "start_to_end_nm", "max_sog_kn", "moving_share_pct", "bbox", "points", "note")


def pick(d: dict, keys) -> dict:
    return {k: d[k] for k in keys if k in d}


def sample_view(s: dict) -> dict:
    out = pick(s, SAMPLE_KEYS)
    out["seed"] = pick(s.get("seed") or {}, ("mmsi", "name"))
    out["vessels"] = [pick(v, SAMPLE_VESSEL_KEYS) for v in s.get("vessels", [])]
    return out


def build() -> tuple[dict, dict]:
    raw = json.loads((RAW / "watchlist.json").read_text(encoding="utf-8"))
    tracks = json.loads((RAW / "tracks.json").read_text(encoding="utf-8"))
    watch = {
        "kind": "DISPLAY SNAPSHOT", "provider": "ShipFinder", "captured_at_utc": raw["captured_at_utc"], "watchlist_label": raw.get("watchlist_label"),
        "note": "Derived from the saved 2026-11-11 snapshot: only the fields the interface shows. No raw provider response, no request log, no key.",
        "watchlist": [pick(v, VESSEL_KEYS) for v in raw["watchlist"]],
        "sample": sample_view(raw["sample"]) if raw.get("sample") else None,
        "extra_samples": [sample_view(s) for s in raw.get("extra_samples", [])],
    }
    trk = {"kind": "SAVED PAST TRACKS", "tracks": [pick(t, TRACK_KEYS) for t in tracks["tracks"]]}
    return watch, trk


def dump(o: dict) -> str:
    return json.dumps(o, ensure_ascii=False, indent=1) + "\n"


def main() -> int:
    watch, trk = build()
    files = {"watchlist.json": dump(watch), "tracks.json": dump(trk)}
    if "--check" in sys.argv:
        bad = [n for n, t in files.items() if not (OUT / n).exists() or (OUT / n).read_text(encoding="utf-8") != t]
        print("display snapshot matches the raw snapshot" if not bad else f"MISMATCH: {bad}")
        return 1 if bad else 0
    OUT.mkdir(parents=True, exist_ok=True)
    for n, t in files.items():
        (OUT / n).write_text(t, encoding="utf-8", newline="\n")
        print(f"wrote {OUT / n} ({len(t):,} bytes)")
    print(f"{len(watch['watchlist'])} tankers, {len(trk['tracks'])} tracks, {1 + len(watch['extra_samples'])} samples")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
