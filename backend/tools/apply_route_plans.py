r"""Apply the stored ShipFinder route-planning distances (data/ais_route_plans.json) to data/routes.json.

    cd backend
    python tools\apply_route_plans.py

Sets, for each route a plan replaces: baseline_voyage_days (planned distance / 14 kn), voyage_derivation (distance, provider, service, plan id, retrieval date,
the previous hand estimate), is_estimate false for that derivation, and removes baseline_voyage_days from the route's estimate_fields. Also derives the
default detour of the Suez and Bab el-Mandeb routes as (Cape distance - Suez distance) / (14 kn x 24 h). Idempotent. No network, no provider call.
tools/derive_voyages.py (the hand-waypoint method) must not be run again after this; it refuses to.
"""

import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from services.route_planning import TANKER_KNOTS, voyage_days  # noqa: E402

ROUTES = BACKEND / "data" / "routes.json"
PLANS = BACKEND / "data" / "ais_route_plans.json"
H = TANKER_KNOTS * 24


def day(iso: str) -> str:
    return iso[:10]


def main() -> None:
    doc = json.loads(ROUTES.read_text(encoding="utf-8"))
    plans = json.loads(PLANS.read_text(encoding="utf-8"))["plans"]
    by_id = {r["id"]: r for r in doc["routes"]}
    changed = []
    for pid, p in plans.items():
        for rid in p["replaces"]:
            r = by_id[rid]
            old = r.get("voyage_derivation", {})
            prev = old.get("previous_hand_estimate") or {"distance_nm": old.get("distance_nm"), "days": old.get("days"), "method": "great-circle sum over illustrative waypoints"}
            nm, days = p["distance_nm"], voyage_days(p["distance_nm"])
            a, b = p["params"].get("start_port", "start"), p["params"].get("end_port", "end")
            via = " (avoid=2, Suez Canal)" if p["params"].get("avoid") else ""
            derivation = {
                "representative_voyage": old.get("representative_voyage", p["note"]),
                "distance_nm": nm, "speed_knots": TANKER_KNOTS, "days": days,
                "calculation": f"{nm:g} nm / ({TANKER_KNOTS:g} kn x 24 h) = {days} days",
                "method_note": (f"Planned sea distance from ShipFinder Port-to-Port route planning, {a} to {b}{via}, retrieved {day(p['retrieved_at_utc'])}. "
                                f"Days = distance / {TANKER_KNOTS:g} kn, the project's tanker speed (an assumption). A planned route, not a measured voyage."),
                "is_estimate": False, "provider": p["provider"], "service": p["service"], "plan_id": pid, "retrieved_at_utc": p["retrieved_at_utc"],
                "previous_hand_estimate": prev,
            }
            r["voyage_derivation"] = derivation
            if rid != "cape_good_hope":
                r["baseline_voyage_days"] = days
                r["baseline_voyage_note"] = ("Typical FULL voyage for cargoes using this route (not the transit time through the chokepoint): planned sea distance "
                                             f"(ShipFinder, retrieved {day(p['retrieved_at_utc'])}) / 14 kn.")
                r["estimate_fields"] = [f for f in r.get("estimate_fields", []) if f != "baseline_voyage_days"]
            changed.append((rid, prev["days"], days))
    cape, suez = plans["ras_tanura_rotterdam_cape"], plans["ras_tanura_rotterdam_suez"]
    detour = round((cape["distance_nm"] - suez["distance_nm"]) / H, 1)
    for rid in ("suez", "bab_el_mandeb"):
        by_id[rid]["default_detour_days"] = detour
        by_id[rid]["default_detour_days_note"] = (f"Cape voyage {voyage_days(cape['distance_nm'])} d minus Suez voyage {voyage_days(suez['distance_nm'])} d, both ShipFinder planned "
                                                  f"distances ({cape['distance_nm']:g} nm and {suez['distance_nm']:g} nm, retrieved {day(suez['retrieved_at_utc'])}) at 14 kn: "
                                                  f"({cape['distance_nm']:g} - {suez['distance_nm']:g}) / 336 = {detour} days.")
    doc["_meta"]["voyage_distances"] = {
        "source": "ShipFinder route planning (api.elaneglobal.com), 5 Port-to-Port calls, 2 Point-to-Point cross-checks; derived values in data/ais_route_plans.json",
        "retrieved_at_utc": sorted(p["retrieved_at_utc"] for p in plans.values())[0], "speed_knots": TANKER_KNOTS,
        "replaces": "the great-circle sums over hand-placed waypoints used up to v1.0 (kept per route as voyage_derivation.previous_hand_estimate)",
        "note": "Routes are still drawn from illustrative waypoints; only the voyage length comes from the planner.",
    }
    ROUTES.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for rid, before, after in changed:
        print(f"{rid:16} voyage days {before} -> {after}")
    print(f"default detour (Suez and Bab el-Mandeb) -> {detour} days")


if __name__ == "__main__":
    main()
