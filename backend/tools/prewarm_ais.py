r"""Refresh the ShipFinder snapshots within the budget. Run from backend/.

    python tools\prewarm_ais.py status
    python tools\prewarm_ais.py sample --allow-one-nearby-call [--seed 538007007]
    python tools\prewarm_ais.py watchlist

sample     EXACTLY ONE Vessels Nearby call around the seed vessel (default FRONT ALTAIR, MMSI 538007007). Refused unless --allow-one-nearby-call is given,
           because Nearby is on hold (it refused calls with status 38 on 2026-11-01). The raw response is saved at once to backend/data/ais_raw/nearby/ and
           backup_ais_data.py runs straight after. On ANY non-zero status, timeout or unreadable reply the hold and breaker stay in place and nothing is retried.
watchlist  Takes up to 8 tankers the provider itself typed as tankers from the latest saved sample (chosen for variety in flag, size and motion), confirms their
           positions with Vessel Position (hard ceiling: 14 calls for the key's whole life, stops at the first error) and their flags with Vessel Flag Information
           (unmetered), then writes backend/data/ais_raw/snapshots/watchlist.json and backs up.

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
    ap.add_argument("step", choices=["status", "sample", "watchlist"])
    ap.add_argument("--seed", type=int, default=DEFAULT_SEED)
    ap.add_argument("--allow-one-nearby-call", action="store_true")
    args = ap.parse_args()
    client = sf.ShipFinderClient()
    if args.step == "status":
        status(client)
        return 0

    if args.step == "sample":
        if not args.allow_one_nearby_call:
            print("refused: Vessels Nearby is on hold. Pass --allow-one-nearby-call only when the owner has authorised exactly one call.")
            return 2
        try:
            body = wl.capture_nearby_sample(client, args.seed)
        except sf.AISError as e:
            print(f"NEARBY CALL FAILED: {e.kind}: {e}")
            print("hold and breaker stay in place; nothing is retried. Fall back to option B (Vessel Search + Vessel Position, at most 6 vessels, 14 Position calls in total).")
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
