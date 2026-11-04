r"""Refresh the ShipFinder snapshots within the budget. Run from backend/.

    python tools\prewarm_ais.py status
    python tools\prewarm_ais.py sample --allow-one-nearby-call [--seed 538007007]
    python tools\prewarm_ais.py watchlist
    python tools\prewarm_ais.py manifest
    python tools\prewarm_ais.py tracks MMSI [MMSI ...]
    python tools\prewarm_ais.py final-snapshot

sample     EXACTLY ONE Vessels Nearby call around the seed vessel (default FRONT ALTAIR, MMSI 538007007). Refused unless --allow-one-nearby-call is given,
           because Nearby is on hold (it refused calls with status 38 on 2026-11-01). The raw response is saved at once to backend/data/ais_raw/nearby/ and
           backup_ais_data.py runs straight after. On ANY non-zero status, timeout or unreadable reply the hold and breaker stay in place and nothing is retried.
watchlist  Takes up to 8 tankers the provider itself typed as tankers from the latest saved sample (chosen for variety in flag, size and motion), confirms their
           positions with Vessel Position (hard ceiling: 16 calls for the key's whole life, 19 with the one-off location search, stops at the first error) and their flags with Vessel Flag Information
           (unmetered), then writes backend/data/ais_raw/snapshots/watchlist.json and backs up.

final-snapshot  Refreshes every watchlist vessel (12) with ONE Vessel Position call each (hard limit 23 for the key, DECISIONS D20; stops at the first error), keeps
           flags and labels, never calls Vessels Nearby (hold stays), writes watchlist.json and backs up. Refuses outside 2026-11-08 to 2026-11-10 (UTC).

manifest   No provider call. Lists everything captured so far (samples, positions, flags, route plans, port lookups, search lists, tracks) with counts and the
           latest capture time, in backend/data/ais_raw/snapshots/manifest.json, and backs up. This is the "first full snapshot" record.

Raw provider data stays in git-ignored folders. The key expires on 2026-11-13; the final snapshot is due by 2026-11-10.
"""

import argparse
import json
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND / ".env")

import backup_ais_data  # noqa: E402
from services import ais_watchlist as wl  # noqa: E402
from services import shipfinder as sf  # noqa: E402

DEFAULT_SEED = 538007007            # FRONT ALTAIR, chosen by the owner


def backup() -> None:
    try:
        folder, n, size = backup_ais_data.backup(Path.home() / "oil-crisis-backups")
        print(f"backup: {n} files ({size / 1024:.0f} KB) -> {folder}")
    except RuntimeError as e:
        print("BACKUP REFUSED:", e)


def status(client: sf.ShipFinderClient) -> None:
    print(f"key expires in {sf.days_until_expiry()} days (2026-11-13); final snapshot due 2026-11-10")
    for name, b in client.budget().items():
        if b["used"] or b["hold"] or b["breaker"] == "open":
            print(f"  {name:16} used {b['used']:>3} of {b['quota'] if b['quota'] else 'unmetered'}  left {b['left']}  breaker {b['breaker']}  hold {'YES' if b['hold'] else 'no'}")


def latest_sample() -> tuple[Path, dict]:
    files = sorted((wl.RAW_DIR / "nearby").glob("nearby_*.json"))
    if not files:
        raise SystemExit("no saved Nearby sample yet: run the sample step first")
    return files[-1], json.loads(files[-1].read_text(encoding="utf-8"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("step", choices=["status", "sample", "watchlist", "manifest", "tracks", "tracks-snapshot", "location-sample", "final-snapshot"])
    ap.add_argument("--seed", type=int, default=DEFAULT_SEED)
    ap.add_argument("--allow-one-nearby-call", action="store_true")
    ap.add_argument("--area", default="Strait of Malacca")
    ap.add_argument("--wait", action="store_true", help="location-sample: sleep until the 30-minute spacing since the last Nearby call has passed")
    ap.add_argument("mmsis", nargs="*", type=int, help="tracks step: the vessels, one History Track call each")
    args = ap.parse_args()
    client = sf.ShipFinderClient()
    if args.step == "status":
        status(client)
        return 0

    if args.step == "tracks":
        if not 1 <= len(args.mmsis) <= 3:
            print("give 1 to 3 MMSIs (owner approved 3 track loads for now; 7 stay in reserve)")
            return 2
        for m in args.mmsis:
            if client.service_state("vessel_track")["used"] >= 3:
                print("stopped: 3 track loads already used (owner approved 3)")
                break
            time.sleep(sf.SERVICES["vessel_track"].min_interval_s + 0.5)
            try:
                body = wl.fetch_track(client, m, time.time())
            except sf.AISError as e:
                print(f"TRACK CALL FAILED for {m}: {e.kind}: {e}")
                print("stopped; nothing is retried.")
                backup()
                return 3
            pts = body.get("data") or []
            print(f"track {m}: status 0, {len(pts)} points" + (f", first row keys {sorted(pts[0].keys())}" if pts else ""))
            backup()
        status(client)
        return 0

    if args.step == "location-sample":
        if not args.allow_one_nearby_call:
            print("refused: pass --allow-one-nearby-call (the owner authorised exactly one call for this step)")
            return 2
        wait = wl.nearby_spacing_wait_s(client.service_state("vessels_nearby")["last_call"], time.time())
        if wait > 0 and not args.wait:
            print(f"refused: the last Nearby call was less than 30 minutes ago; {wait:.0f} s to go (use --wait)")
            return 2
        if wait > 0:
            print(f"waiting {wait:.0f} s for the 30-minute spacing ...", flush=True)
            time.sleep(wait + 5)
        try:
            body = wl.capture_nearby_sample(client, args.seed)
        except sf.AISError as e:
            print(f"NEARBY CALL FAILED: {e.kind}: {e}")
            print("hold and breaker stay in place; nothing is retried; the watchlist keeps its single Huelva sample.")
            return 3
        fetched_at = time.time()
        rows = body.get("data") or []
        print(f"NEARBY OK: status 0, total {body.get('total')}, returned {len(rows)}, tankers typed by the provider {sum(wl.is_tanker(r) for r in rows)}")
        backup()
        seed_files = sorted((wl.RAW_DIR / "positions_location_search").glob(f"position_{args.seed}_*.json"))
        seed_pos = None
        if seed_files:
            d = json.loads(seed_files[-1].read_text(encoding="utf-8"))
            seed_pos = {**d["response"]["data"], "_fetched_at": time.mktime(time.strptime(d["retrieved_at_utc"], "%Y%m%dT%H%M%SZ")) - time.timezone}
        snap = wl.load_watchlist()
        if not snap:
            print("no watchlist snapshot to extend; run the watchlist step first")
            return 2
        wl.add_location_sample(snap, body, args.seed, fetched_at, seed_pos, args.area)
        wl.save_snapshot(snap)
        print(f"watchlist now {len(snap['watchlist'])} vessels; extra sample: {snap['extra_samples'][-1]['label']}")
        backup()
        status(client)
        return 0

    if args.step == "final-snapshot":
        now = time.time()
        if not wl.in_final_snapshot_window(now):
            print(f"refused: the final snapshot is taken between {wl.FINAL_SNAPSHOT_WINDOW[0]} and {wl.FINAL_SNAPSHOT_WINDOW[1]} (UTC); now is {wl.utc_iso(now)}")
            return 2
        snap = wl.load_watchlist()
        if not snap:
            print("no watchlist snapshot to refresh")
            return 2
        mmsis = [v["mmsi"] for v in snap["watchlist"]]
        left = wl.POSITION_ABSOLUTE_LIMIT - client.service_state("vessel_position")["used"]
        print(f"refreshing {len(mmsis)} vessels; Vessel Position calls left under the limit of {wl.POSITION_ABSOLUTE_LIMIT}: {left}")
        positions, why = wl.fetch_positions(client, mmsis)
        fetched_at = time.time()
        notes = [f"final snapshot positions: {why}"] if why else []
        if why:
            print("positions:", why)
        snap, n = wl.refresh_snapshot(snap, positions, fetched_at, client.budget(), notes)
        out = wl.save_snapshot(snap)
        print(f"final snapshot saved: {out.relative_to(BACKEND)} ({n} of {len(mmsis)} vessels refreshed)")
        backup()
        status(client)
        print("REMINDER: copy the newest ais_* folder inside the oil-crisis-backups folder in your user profile to a USB drive or a cloud folder; the key expires on 2026-11-13.")
        return 0 if n == len(mmsis) else 3

    if args.step == "tracks-snapshot":
        watch = wl.load_watchlist() or {"watchlist": []}
        names = {v["mmsi"]: (v["name"], v.get("flag_registry")) for v in watch["watchlist"]}
        latest = {}
        for f in sorted((wl.RAW_DIR / "tracks").glob("track_*.json")):
            d = json.loads(f.read_text(encoding="utf-8"))
            latest[d["params"]["mmsi"]] = d
        records = [wl.build_track_record(d, *names.get(m, (None, None))) for m, d in latest.items()]
        out = wl.save_tracks(records)
        for r in records:
            print(f"  {r['name']} ({r['mmsi']}): {r['points_provider']} points -> {r['points_stored']} stored, path {r['path_nm']} nm, start-to-end {r['start_to_end_nm']} nm, {r['label']}")
        print("saved:", out.relative_to(BACKEND))
        backup()
        return 0

    if args.step == "manifest":
        parts = {}
        for name, pattern in [("nearby_samples", "nearby/nearby_*.json"), ("vessel_positions", "positions/position_*.json"), ("vessel_flags", "flags/flag_*.json"),
                              ("route_plans", "route_plans/*.json"), ("port_info_lookups", "port_info_lookup_*.json"), ("vessel_search_lists", "vessel_search_*.json"),
                              ("vessel_tracks", "tracks/track_*.json")]:
            files = sorted(wl.RAW_DIR.glob(pattern))
            parts[name] = {"files": len(files), "latest_modified_utc": wl.utc_iso(max(f.stat().st_mtime for f in files)) if files else None}
        watch = wl.load_watchlist()
        manifest = {"kind": "SNAPSHOT MANIFEST", "written_utc": wl.utc_iso(time.time()), "key_expires": "2026-11-13", "final_snapshot_due": "2026-11-10", "parts": parts,
                    "watchlist": {"vessels": len(watch["watchlist"]), "captured_utc": watch["captured_at_utc"], "sample_label": watch["sample"]["label"]} if watch else None,
                    "provider_calls": client.budget(),
                    "not_captured": ["vessel tracks (fetched on demand from the vessel panel, M12; 10 calls, 4 kept in reserve)", "any chokepoint or area coverage (this key cannot provide it)"]}
        out = wl.SNAP_DIR / "manifest.json"
        out.write_text(json.dumps(manifest, indent=1), encoding="utf-8")
        for k, v in parts.items():
            print(f"  {k:20} {v['files']:>3} files, latest {v['latest_modified_utc']}")
        print("manifest written:", out.relative_to(BACKEND))
        backup()
        return 0

    if args.step == "sample":
        if not args.allow_one_nearby_call:
            print("refused: Vessels Nearby is on hold. Pass --allow-one-nearby-call only when the owner has authorised exactly one call.")
            return 2
        try:
            body = wl.capture_nearby_sample(client, args.seed)
        except sf.AISError as e:
            print(f"NEARBY CALL FAILED: {e.kind}: {e}")
            print("hold and breaker stay in place; nothing is retried. Fall back to option B (Vessel Search + Vessel Position, at most 6 vessels, Position calls within the 16 ceiling).")
            return 3
        rows = body.get("data") or []
        print(f"NEARBY OK: provider status 0, total {body.get('total')}, returned {len(rows)}, tankers typed by the provider {sum(wl.is_tanker(r) for r in rows)}")
        backup()
        status(client)
        return 0

    # ---- watchlist
    path, saved = latest_sample()
    body, fetched_at = saved["response"], time.mktime(time.strptime(saved["retrieved_at_utc"], "%Y%m%dT%H%M%SZ")) - time.timezone
    picked = wl.pick_watchlist(body["data"])
    seed = saved["params"]["mmsi"]
    print(f"sample {path.name}: {len(body['data'])} vessels; watchlist candidates: {len(picked)}")
    notes = []
    positions, why = wl.fetch_positions(client, [r["mmsi"] for r in picked])
    pos_time = time.time()
    if why:
        notes.append(f"positions: {why}")
        print("positions:", why)
    flags, why = wl.fetch_flags(client, [r["mmsi"] for r in picked])
    if why:
        notes.append(f"flags: {why}")
        print("flags:", why)
    snap = wl.build_snapshot(body, seed, fetched_at, picked, positions, pos_time if positions else None, flags, notes, client.budget())
    out = wl.save_snapshot(snap)
    print(f"snapshot saved: {out.relative_to(BACKEND)} ({len(snap['watchlist'])} vessels, {len(positions)} positions confirmed, {len(flags)} flags)")
    backup()
    status(client)
    return 0


if __name__ == "__main__":
    sys.exit(main())
