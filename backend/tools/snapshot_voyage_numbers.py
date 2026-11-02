r"""Capture every number that depends on the baseline voyage days, from the application itself (TestClient, no network, no provider call).

    cd backend
    python tools\snapshot_voyage_numbers.py docs\m10_voyage_before.json     # before the route-planning distances are applied
    python tools\snapshot_voyage_numbers.py docs\m10_voyage_after.json      # after
    python tools\route_before_after.py                                       # writes docs/m10_route_planning_before_after.md

Each snapshot holds, per route, the baseline voyage days and default detour, and for the worked examples the report API's KPIs and barrel arithmetic.
"""

import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

client = TestClient(main.app)
BASE = {"conflict_intensity": 5, "demand_change_pct": 0, "ev_substitution_rate_pct": 100, "lithium_availability_pct": 10, "horizon_years": 5}
CASES = {
    "suez_20d_detour_60d": {"route_id": "suez", "disruption_type": "detour", "detour_days": 20, "duration_days": 60},
    "suez_default_detour_60d": {"route_id": "suez", "disruption_type": "detour", "duration_days": 60},
    "bab_el_mandeb_20d_detour_60d": {"route_id": "bab_el_mandeb", "disruption_type": "detour", "detour_days": 20, "duration_days": 60},
    "hormuz_blockade_100pct_30d": {"route_id": "hormuz", "disruption_type": "blockade", "blocked_share_pct": 100, "duration_days": 30, "conflict_intensity": 8},
    "turkish_straits_10d_detour_60d": {"route_id": "turkish_straits", "disruption_type": "detour", "detour_days": 10, "duration_days": 60},
}


def main_() -> None:
    out = {"routes": {}, "cases": {}}
    for rid in [r["id"] for r in client.get("/api/v1/routes").json()["routes"]]:
        r = client.get(f"/api/v1/routes/{rid}").json()          # the list view carries summary fields only
        out["routes"][rid] = {"baseline_voyage_days": r.get("baseline_voyage_days"), "default_detour_days": r.get("default_detour_days"),
                              "is_estimate": r.get("is_estimate"), "estimate_fields": r.get("estimate_fields")}
    for name, body in CASES.items():
        resp = client.post("/api/v1/simulate/report", json={**BASE, **body})
        if resp.status_code != 200:
            out["cases"][name] = {"error": resp.status_code}
            continue
        j = resp.json()
        b = j["sections"]["barrels"]["numbers"]
        k = j["kpis"]
        out["cases"][name] = {"request": body, "baseline_voyage_days": b.get("baseline_voyage_days"), "detour_days": b.get("detour_days"),
                              "displaced_bpd": b.get("displaced_bpd"), "supply_loss_pct": b.get("supply_loss_pct"), "transit_gap_bbl": b.get("transit_gap_bbl"),
                              "price_impact_pct": k.get("price_impact_pct"), "evs_required": k.get("evs_required"), "extra_lithium_t_lce": k.get("extra_lithium_t_lce"),
                              "lithium_deficit_t_lce": k.get("lithium_deficit_t_lce")}
    Path(sys.argv[1]).write_text(json.dumps(out, indent=1), encoding="utf-8")
    print("wrote", sys.argv[1], "|", len(out["routes"]), "routes,", sum("error" not in c for c in out["cases"].values()), "of", len(CASES), "cases")


if __name__ == "__main__":
    main_()
