"""Generate DEMO_SCRIPT.md from the running application's own output, so no number in it is typed from memory.

    cd backend
    python tools\\make_demo_script.py            # writes ..\\DEMO_SCRIPT.md

It calls POST /api/v1/simulate/report for the Suez 20-day detour and the Hormuz blockade (through FastAPI's TestClient, without starting the server's
background tasks), reads the constants from services/config.py, asks /api/v1/price/live for the ticker line, and fills tools/demo_script_template.md.
"""

import sys
from datetime import date
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from services.config import DEFAULT_CONFIG as CFG  # noqa: E402

SUEZ = {"route_id": "suez", "disruption_type": "detour", "detour_days": 20, "duration_days": 60, "conflict_intensity": 5, "demand_change_pct": 0,
        "ev_substitution_rate_pct": 100, "lithium_availability_pct": 10, "horizon_years": 5}
HORMUZ = {"route_id": "hormuz", "disruption_type": "blockade", "blocked_share_pct": 100, "duration_days": 30, "conflict_intensity": 8, "demand_change_pct": 0,
          "ev_substitution_rate_pct": 100, "lithium_availability_pct": 10, "horizon_years": 5}
SUEZ_URL = "http://localhost:5173/results?route=suez&type=detour&detour=20&dur=60&conf=5&dem=0&ev=100&li=10&horizon=5"
HORMUZ_URL = "http://localhost:5173/results?route=hormuz&type=blockade&share=100&dur=30&conf=8&dem=0&ev=100&li=10&horizon=5"


def n(x: float) -> str:
    return f"{round(x):,}"


def values(client: TestClient) -> dict[str, str]:
    s = client.post("/api/v1/simulate/report", json=SUEZ).json()
    h = client.post("/api/v1/simulate/report", json=HORMUZ).json()
    sb, hb = s["sections"]["barrels"]["numbers"], h["sections"]["barrels"]["numbers"]
    sl = s["sections"]["lithium"]["numbers"]
    k, hk = s["kpis"], h["kpis"]
    li_lce = CFG.world_li_production_t_li * CFG.lce_per_t_li
    cap = CFG.world_li_production_t_li * CFG.lce_per_t_li * 0.10 * 5
    h_flow = h["baseline"]["flow_bpd"]
    price = client.get("/api/v1/price/live").json()
    if price["status"] == "DAILY_CLOSE":
        say = (f"WTI {price['wti']:.2f} and Brent {price['brent']:.2f} dollars a barrel, as of {price['as_of']}, {price['age_days']} days old "
               f"(figures at the time this script was generated).")
    else:
        say = (f"On this machine EIA could not be used when this script was generated, so it showed the last row of a local file, dated {price['as_of']} "
               f"({price['age_days']} days old). Say that plainly.")
    return {
        "generated_on": date.today().isoformat(), "suez_url": SUEZ_URL, "hormuz_url": HORMUZ_URL,
        "ticker_status": price["status"], "ticker_say": say,
        "suez_flow_mbd": f"{s['baseline']['flow_bpd'] / 1e6:g}", "s_flow": n(s["baseline"]["flow_bpd"]),
        "s_T": f"{sb['baseline_voyage_days']:g}", "s_detour": f"{sb['detour_days']:g}", "s_factor": f"{sb['delivery_factor']:.6f}",
        "s_displaced_exact": f"{sb['displaced_bpd']:,.2f}",
        "s_evs_by_hand": n(round(sb["displaced_bpd"]) * CFG.gasoline_gal_per_bbl * 365 / CFG.gal_per_vehicle_year * 1.0),
        "s_displaced": n(sb["displaced_bpd"]), "s_supply_loss": f"{sb['supply_loss_pct']:.3f}", "s_price": f"{k['price_impact_pct']:.1f}",
        "s_evs": n(k["evs_required"]), "s_evs_m": f"{k['evs_required'] / 1e6:.1f}", "s_li": n(k["extra_lithium_t_lce"]), "s_li_mt": f"{k['extra_lithium_t_lce'] / 1e6:.2f}",
        "s_li_hi_mt": f"{k['extra_lithium_range_t_lce'][1] / 1e6:.2f}", "s_cap": n(cap), "s_deficit": n(k["lithium_deficit_t_lce"]),
        "s_deficit_mt": f"{k['lithium_deficit_t_lce'] / 1e6:.2f}", "s_gap": n(sb["transit_gap_bbl"]),
        "world_supply": n(CFG.global_supply_bpd), "band": f"{CFG.price_band_pp:g}", "gal_bbl": f"{CFG.gasoline_gal_per_bbl:g}", "gal_veh": f"{CFG.gal_per_vehicle_year:g}",
        "pack": f"{CFG.typical_pack_kwh:g}", "lce": f"{CFG.lce_per_t_li:g}", "li_per_ev": f"{sl['lce_t_per_ev_sourced']:.6f}", "li_ratio": f"{sl['sourced_vs_project_ratio']:.1f}",
        "avail": "10", "world_li_lce": n(li_lce),
        "h_flow_mbd": f"{h_flow / 1e6:g}", "h_bypass_mbd": f"{(h_flow - hb['displaced_bpd']) / 1e6:g}", "h_displaced_mbd": f"{hb['displaced_bpd'] / 1e6:g}",
        "h_supply_loss": f"{hb['supply_loss_pct']:.1f}", "h_price": f"{hk['price_impact_pct']:.0f}", "validated_max": f"{h['validated_supply_loss_max_pct']:g}",
        "edge_price": f"{h['validated_supply_loss_max_pct'] / CFG.elasticity_abs / 1.0:.1f}", "ref_move": f"{h['validated_reference']['actual_price_move_pct']:.1f}",
    }


def main_() -> None:
    client = TestClient(main.app)          # no `with`: do not start the NewsAPI poller or the GDELT warm-up
    vals = values(client)
    if not client.post("/api/v1/simulate/report", json=HORMUZ).json()["kpis"]["outside_validated_range"]:
        raise SystemExit("Hormuz is expected to be outside the validated range; the script text assumes it")
    text = (BACKEND / "tools" / "demo_script_template.md").read_text(encoding="utf-8")
    for key, v in vals.items():
        text = text.replace(f"@@{key}@@", v)
    left = sorted(set(__import__("re").findall(r"@@(\w+)@@", text)))
    if left:
        raise SystemExit(f"unfilled placeholders: {left}")
    out = BACKEND.parent / "DEMO_SCRIPT.md"
    out.write_text(text, encoding="utf-8")
    print(f"wrote {out} ({len(text.splitlines())} lines, {len(vals)} generated values)")


if __name__ == "__main__":
    main_()
