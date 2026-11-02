r"""Run ONE approved ShipFinder route-planning call, check it, and store it.

    cd backend
    python tools\plan_routes.py --list
    python tools\plan_routes.py --only ras_tanura_rotterdam_suez

One call per run, on purpose. The run stops at the first error (the client's circuit breaker also opens). Order of events:
  1. the call is made through the quota-guarded client (a raw copy of the full response is written at once to backend/data/ais_raw/route_plans/, git-ignored);
  2. the result is checked against rough expectations (services/route_planning.py);
  3. only if every check passes, a derived entry (distance, days, provider, service, retrieval date; no waypoints) is added to data/ais_route_plans.json,
     which is committed because the app needs it after the key expires. routes.json is updated afterwards by tools/apply_route_plans.py.
A plan that is already stored is refused (it would waste a metered call) unless --again is given.
"""

import argparse
import json
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND / ".env")

from services import route_planning as rp  # noqa: E402
from services import shipfinder as sf  # noqa: E402

PLANS_FILE = BACKEND / "data" / "ais_route_plans.json"
RAW_DIR = BACKEND / "data" / "ais_raw" / "route_plans"


def load_plans() -> dict:
    if PLANS_FILE.exists():
        return json.loads(PLANS_FILE.read_text(encoding="utf-8"))
    return {"_meta": {"description": "Real sea distances from ShipFinder route planning for the representative voyages. Derived values only (no waypoints, no raw responses). "
                                     "Raw responses are kept in backend/data/ais_raw/route_plans/ (git-ignored).",
                      "provider": "ShipFinder (api.elaneglobal.com)", "speed_knots": rp.TANKER_KNOTS, "distance_unit": "nautical miles"}, "plans": {}}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--only", help="plan id")
    ap.add_argument("--again", action="store_true", help="repeat a plan that is already stored (spends another call)")
    args = ap.parse_args()
    store = load_plans()
    if args.list or not args.only:
        for p in rp.PLANS:
            done = store["plans"].get(p.id)
            print(f"{p.id:34} {p.service:11} {'STORED ' + format(done['distance_nm'], ',.0f') + ' nm' if done else 'not run':18} replaces {', '.join(p.replaces) or '-'}")
        return 0
    plan = rp.PLAN_BY_ID.get(args.only)
    if plan is None:
        print("unknown plan id; use --list")
        return 2
    if plan.id in store["plans"] and not args.again:
        print(f"{plan.id} is already stored ({store['plans'][plan.id]['distance_nm']:,.0f} nm); not calling again.")
        return 0

    client = sf.ShipFinderClient()
    p = plan.params
    try:
        if plan.service == "route_port":
            body = client.route_plan_port_to_port(p["start_port"], p["end_port"], avoid=p.get("avoid"), raw_dir=RAW_DIR, raw_name=plan.id)
        else:
            body = client.route_plan_point_to_point(p["start"], p["end"], raw_dir=RAW_DIR, raw_name=plan.id)
    except sf.AISError as e:
        print(f"STOPPED: {e.kind}: {e}")
        print("no result stored. Nothing else will be called.")
        return 2
    b = client.budget()[plan.service]
    data = body["data"]
    print(f"{plan.id}: provider returned {data.get('distance')} nm, {len(data.get('route') or [])} waypoints (raw copy saved). Budget {plan.service}: {b['used']} of {b['quota']} used.")
    problems = rp.check(plan, body, store["plans"])
    if problems:
        print("IMPLAUSIBLE, NOT STORED:")
        for x in problems:
            print("  -", x)
        return 3
    nm = float(data["distance"])
    store["plans"][plan.id] = {"distance_nm": round(nm, 1), "voyage_days_at_14kn": rp.voyage_days(nm), "waypoints": len(data["route"]), "service": plan.service,
                               "params": {k: v for k, v in p.items()}, "replaces": list(plan.replaces), "estimate_nm_before": plan.estimate_nm, "provider": "ShipFinder",
                               "retrieved_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "checks": "passed", "note": plan.note}
    PLANS_FILE.write_text(json.dumps(store, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"checks passed. Stored: {nm:,.0f} nm = {rp.voyage_days(nm)} days at 14 kn (was {plan.estimate_nm:,.0f} nm = {rp.voyage_days(plan.estimate_nm)} days).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
