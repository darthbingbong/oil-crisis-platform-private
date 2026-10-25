"""Pre-warm the route-news cache before a demo (spaced out, with retries) and optionally refresh the demo snapshot.

Run from backend/ BEFORE a presentation, ideally a few minutes before and with the backend stopped or running (they share the on-disk cache):

    python tools/prewarm_news.py                  # fetch every route that is not fresh, 3 attempts each, 20 s between attempts
    python tools/prewarm_news.py --snapshot       # ... and save the real headlines as the DEMO SNAPSHOT used if GDELT is down on the day
    python tools/prewarm_news.py --snapshot-only  # no network: rebuild the snapshot from what is already cached
    python tools/prewarm_news.py --force --only hormuz,suez --attempts 5

GDELT is slow (10 to 60 s per answer) and often answers HTTP 429, so this takes several minutes. Requests are never in parallel and never closer
than 6 s apart (the client enforces that), and each failed attempt waits --gap seconds (default 20) before the next. The results are written to
backend/data/cache/route_news/ (git-ignored), so they survive a backend restart; the cache entries are valid for 20 minutes, after which the
running backend serves them marked stale and refreshes in the background.
"""

import argparse
import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import news_feed as nf  # noqa: E402
from services.route_data import all_routes  # noqa: E402


async def prewarm(routes, *, attempts, gap, force):
    cache = nf.default_cache()
    rows = []
    for route in routes:
        rid = route["id"]
        entry = cache.get(f"news_{rid}")
        if not force and entry is not None and cache.is_fresh(entry):
            rows.append((rid, "already fresh", len(entry["payload"]["items"]), nf._iso(entry["fetched_at"]), 0, 0.0))
            continue
        status, result, used, t0 = "unavailable", None, 0, time.monotonic()
        for attempt in range(1, attempts + 1):
            used = attempt
            result = await nf.get_route_news(route, cache=cache)
            status = result["feed_status"]
            print(f"  {rid:16} attempt {attempt}/{attempts}: {status}", flush=True)
            if status in ("ok", "empty"):
                break
            if attempt < attempts:
                await asyncio.sleep(gap)
        rows.append((rid, status, result["count"] if result else 0, result["last_updated"] if result else None, used, time.monotonic() - t0))
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--attempts", type=int, default=3, help="attempts per route (default 3)")
    ap.add_argument("--gap", type=float, default=20.0, help="seconds to wait between failed attempts (default 20)")
    ap.add_argument("--force", action="store_true", help="refetch even routes whose cache is still fresh")
    ap.add_argument("--only", default="", help="comma-separated route ids (default: all)")
    ap.add_argument("--snapshot", action="store_true", help="after fetching, save the real cached headlines as the demo snapshot")
    ap.add_argument("--snapshot-only", action="store_true", help="do not fetch; just rebuild the demo snapshot from the cache")
    args = ap.parse_args()

    routes = all_routes()
    if args.only:
        wanted = {x.strip() for x in args.only.split(",")}
        routes = [r for r in routes if r["id"] in wanted]
    order = {rid: i for i, rid in enumerate(nf.WARMUP_FIRST)}
    routes = sorted(routes, key=lambda r: order.get(r["id"], len(order)))

    if not args.snapshot_only:
        print(f"Pre-warming {len(routes)} routes (attempts={args.attempts}, gap={args.gap:g}s). GDELT can take a minute per route.\n")
        rows = asyncio.run(prewarm(routes, attempts=args.attempts, gap=args.gap, force=args.force))
        print(f"\n{'route':16} {'result':14} {'headlines':>9}  {'fetched at (UTC)':22} {'attempts':>8} {'seconds':>8}")
        for rid, status, n, at, used, secs in rows:
            print(f"{rid:16} {status:14} {n:>9}  {str(at):22} {used:>8} {secs:>8.0f}")
        ok = sum(1 for r in rows if r[1] in ("ok", "empty", "already fresh"))
        print(f"\n{ok} of {len(rows)} routes are ready; {len(rows) - ok} could not be fetched (they will show the demo snapshot if one exists for them, "
              "otherwise 'unavailable').")

    if args.snapshot or args.snapshot_only:
        written = nf.write_snapshot_from_cache(all_routes())
        print(f"\nDemo snapshot saved to {nf.SNAPSHOT_PATH.name}: {len(written['routes'])} routes have real headlines:")
        for rid, e in written["routes"].items():
            print(f"  {rid:16} {len(e['items'])} headlines, fetched {e['fetched_at']}")
        missing = [r["id"] for r in all_routes() if r["id"] not in written["routes"]]
        print(f"  no headlines to save for: {', '.join(missing) or 'none'} (these show the plain 'empty' or 'unavailable' message)")


if __name__ == "__main__":
    main()
