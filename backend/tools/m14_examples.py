"""M14: capture the price-outlook fields of the two worked examples (Suez 20-day detour, Hormuz blockade) and a short-disruption case, straight from the
running backend or the in-process app, so the before/after table is built from the API and not from memory.

    python tools/m14_examples.py <out.json>          (uses the in-process app, no server needed, no network, no AIS call)
"""
import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import main  # noqa: E402

EXAMPLES = {
    "suez_20_day_detour": dict(route_id="suez", disruption_type="detour", detour_days=20, duration_days=60, conflict_intensity=5, demand_change_pct=0,
                               ev_substitution_rate_pct=100, lithium_availability_pct=10, horizon_years=5),
    "hormuz_blockade": dict(route_id="hormuz", disruption_type="blockade", blocked_share_pct=100, duration_days=30, conflict_intensity=8, demand_change_pct=0,
                            ev_substitution_rate_pct=100, lithium_availability_pct=10, horizon_years=5),
    "suez_20_day_detour_lasting_10_days": dict(route_id="suez", disruption_type="detour", detour_days=20, duration_days=10, conflict_intensity=5, demand_change_pct=0,
                                               ev_substitution_rate_pct=100, lithium_availability_pct=10, horizon_years=5),
}


def pick(j: dict) -> dict:
    p = j["sections"]["price"]
    traj = p["chart"].get("trajectory", [])
    k = j["kpis"]
    return {
        "loss_pct": round(j["sections"]["barrels"]["numbers"]["supply_loss_pct"], 4),
        "kpi_price_impact_pct": round(k["price_impact_pct"], 4),
        "kpi_price_band_pp": k["price_band_pp"],
        "outside_validated_range": k["outside_validated_range"],
        "price_numbers_keys": sorted(p["numbers"].keys()),
        "price_chart_keys": sorted(p["chart"].keys()),
        "trajectory_points": len(traj),
        "trajectory_last_day": traj[-1]["day"] if traj else None,
        "trajectory_day_0_pct": round(traj[0]["pct"], 4) if traj else None,
        "trajectory_day_30_pct": round(next(t["pct"] for t in traj if t["day"] == 30), 4) if traj else None,
        "trajectory_last_pct": round(traj[-1]["pct"], 4) if traj else None,
        "half_life_days": p["numbers"].get("half_life_days"),
        "price_summary": p["summary"],
        "price_takeaway": p["takeaway"],
        "price_assumptions": [a["text"] if isinstance(a, dict) and "text" in a else a for a in p["assumptions"]],
        "barrels_series_points": len(j["sections"]["barrels"]["chart"]["series"]),
        "barrels_cumulative_bbl": j["sections"]["barrels"]["numbers"]["cumulative_bbl"],
    }


if __name__ == "__main__":
    out = Path(sys.argv[1])
    c = TestClient(main.app)
    res = {}
    for name, body in EXAMPLES.items():
        r = c.post("/api/v1/simulate/report", json=body)
        r.raise_for_status()
        res[name] = pick(r.json())
    out.write_text(json.dumps(res, indent=2, ensure_ascii=False), encoding="utf-8")
    for n, v in res.items():
        print(n, "| headline", v["kpi_price_impact_pct"], "| band", v["kpi_price_band_pp"], "| points", v["trajectory_points"], "| day30", v["trajectory_day_30_pct"], "| last", v["trajectory_last_pct"], "| half-life", v["half_life_days"])
