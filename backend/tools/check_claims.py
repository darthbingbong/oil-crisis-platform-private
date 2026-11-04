"""Claims audit: every number the README, DEMO_SCRIPT and LIMITATIONS state is rebuilt from the running application or the data files, and the
document must contain exactly that text. Exit code 1 if any claim is missing or wrong.

    cd backend
    python tools\\check_claims.py

How a claim is checked: the expected string is FORMATTED FROM THE TRUTH (an API response, a data file, the config), then looked up in the document. So a
claim fails if the document drops the number or if the number in the document differs from what the app produces today.
Things that are historical measurements (latency, fps, dates of a past run) cannot be recomputed and are listed at the end as NOT CHECKED here.
"""

import json
import re
import sys
from pathlib import Path

import pandas as pd

BACKEND = Path(__file__).resolve().parent.parent
ROOT = BACKEND.parent
sys.path.insert(0, str(BACKEND))

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from services import news_feed  # noqa: E402
from services.config import DEFAULT_CONFIG as CFG  # noqa: E402

DOCS = {name: (ROOT / name).read_text(encoding="utf-8") for name in ("README.md", "DEMO_SCRIPT.md", "LIMITATIONS_AND_FUTURE_WORK.md")}
client = TestClient(main.app)
results: list[tuple[bool, str, str, str]] = []


def claim(doc: str, expected: str, label: str) -> None:
    ok = expected in DOCS[doc]
    results.append((ok, doc, label, expected))


def fmt(x: float) -> str:
    return f"{round(x):,}"


# ---------------------------------------------------------------------------------------------------------------- data files and config
events = pd.read_csv(BACKEND / "data" / "events.csv")
daily = events[events["resolution"] != "annual"]
claim("README.md", f"**{len(events)}** events", "events.csv rows")
claim("README.md", f"of which **{len(daily)}** have daily-resolution prices", "daily-resolution events")
claim("README.md", f"{CFG.price_band_pp:g}", "formula leave-one-out MAE (config)")
claim("README.md", "13.80", "model MAE from the Phase 1 rerun")
assert "13.80" in (BACKEND / "PHASE1_SUMMARY.md").read_text(encoding="utf-8") and f"{CFG.price_band_pp:g}" in (BACKEND / "PHASE1_SUMMARY.md").read_text(encoding="utf-8")
claim("README.md", f"{CFG.global_supply_bpd / 1e6:g} Mb/d", "world oil supply (EIA)")
claim("README.md", f"{CFG.lce_per_t_li:g}", "LCE per lithium")
claim("README.md", f"{fmt(CFG.world_li_production_t_li * CFG.lce_per_t_li)} t LCE", "world lithium production in LCE")
claim("README.md", f"{fmt(CFG.world_li_production_t_li)} t Li", "USGS 2025 world production")
claim("README.md", f"{CFG.gasoline_gal_per_bbl:g} gal of gasoline per barrel", "gasoline per barrel")
claim("README.md", f"{CFG.gal_per_vehicle_year:g} gal per vehicle-year", "gallons per vehicle-year")
claim("README.md", f"0.10 kg Li/kWh x {CFG.typical_pack_kwh:g} kWh", "sourced lithium per EV inputs")
per_ev = CFG.li_kg_per_kwh * CFG.typical_pack_kwh * CFG.lce_per_t_li / 1000
claim("README.md", f"{per_ev:.4f} t LCE", "sourced t LCE per EV")
claim("DEMO_SCRIPT.md", f"{per_ev:.6f} t LCE", "sourced t LCE per EV, 6 digits")

routes = client.get("/api/v1/routes").json()["routes"]
claim("README.md", f"{len(routes)} routes", "route count")
lit = json.loads((BACKEND / "data" / "lithium_usgs.json").read_text(encoding="utf-8"))
c = {x["iso3"]: x for x in lit["countries"]}
claim("README.md", f"{fmt(lit['world']['consumption_t_li']['2025'])} t Li", "USGS 2025 consumption")
claim("LIMITATIONS_AND_FUTURE_WORK.md", f"{fmt(lit['world']['mine_production_t_li']['2025'])} t Li) above consumption ({fmt(lit['world']['consumption_t_li']['2025'])} t Li) by "
      f"{fmt(lit['world']['mine_production_t_li']['2025'] - lit['world']['consumption_t_li']['2025'])} t, about "
      f"{round((lit['world']['mine_production_t_li']['2025'] - lit['world']['consumption_t_li']['2025']) / lit['world']['mine_production_t_li']['2025'] * 100)}% of production", "lithium headroom wording")
assert (c["ARG"]["mine_production_t_li"]["2024"], c["CHL"]["mine_production_t_li"]["2024"], c["AUS"]["reserves_t_li"]) == (13800, 48900, 8400000)
claim("README.md", "37 Mt", "USGS reserves")

csv_last = pd.read_csv(BACKEND / "data" / "oil_daily_prices.csv").iloc[-1]
claim("README.md", f"**{csv_last['date']}**", "fallback CSV last date")
claim("LIMITATIONS_AND_FUTURE_WORK.md", f"WTI {csv_last['wti']} in the CSV", "fallback CSV WTI")
snap = news_feed.load_snapshot().get("routes", {})
claim("README.md", f"holds {len(snap)} of 14 routes", "demo snapshot route count")
assert len(snap) == 4, f"snapshot now holds {len(snap)} routes, the docs say 4"

# ---------------------------------------------------------------------------------------------------------------- the Suez worked example (API)
SUEZ = {"route_id": "suez", "disruption_type": "detour", "detour_days": 20, "duration_days": 60, "conflict_intensity": 5, "demand_change_pct": 0,
        "ev_substitution_rate_pct": 100, "lithium_availability_pct": 10, "horizon_years": 5}
s = client.post("/api/v1/simulate/report", json=SUEZ).json()
sb, k = s["sections"]["barrels"]["numbers"], s["kpis"]
eco = {i["key"]: i for i in s["sections"]["economy"]["numbers"]["items"]}
flow = s["baseline"]["flow_bpd"]
T, d = sb["baseline_voyage_days"], sb["detour_days"]
factor = T / (T + d)
# independent recomputation (not through the report builder) must agree with the API
assert abs(flow * (1 - factor) - sb["displaced_bpd"]) < 1e-6
assert abs(sb["displaced_bpd"] / CFG.global_supply_bpd * 100 - sb["supply_loss_pct"]) < 1e-9
assert abs(sb["supply_loss_pct"] / CFG.elasticity_abs - k["price_impact_pct"]) < 1e-9
assert abs(sb["displaced_bpd"] * CFG.gasoline_gal_per_bbl * 365 / CFG.gal_per_vehicle_year - k["evs_required"]) < 1e-3
assert abs(k["evs_required"] * per_ev - k["extra_lithium_t_lce"]) < 1e-3
cap = CFG.world_li_production_t_li * CFG.lce_per_t_li * 0.10 * 5
assert abs(k["extra_lithium_t_lce"] - cap - k["lithium_deficit_t_lce"]) < 1e-3
claim("README.md", f"{fmt(flow)} bpd ({flow / 1e6:g} Mb/d)", "Suez flow")
claim("README.md", f"{T:g} days", "Suez voyage days")
claim("README.md", f"= {factor:.4f}", "Suez delivery factor")
claim("README.md", f"{fmt(sb['displaced_bpd'])} bpd", "Suez barrels displaced")
claim("README.md", f"{sb['supply_loss_pct']:.3f}% of world supply", "Suez supply loss")
claim("README.md", f"**+{k['price_impact_pct']:.1f}%**", "Suez price impact")
claim("README.md", f"{fmt(k['evs_required'])} EVs", "Suez EVs")
claim("README.md", f"{fmt(k['extra_lithium_t_lce'])} t LCE", "Suez lithium")
claim("README.md", f"{fmt(cap)} t; deficit **{fmt(k['lithium_deficit_t_lce'])} t**", "Suez cap and deficit")
claim("README.md", f"+{sb['detour_days'] / T * 100:.1f}%", "Suez tonne-miles")
claim("README.md", f"{fmt(sb['transit_gap_bbl'])} barrels", "Suez transit gap")
claim("README.md", f"+{eco['global_inflation_pp']['low']:.2f} pp inflation", "Suez inflation effect")
claim("README.md", f"{s['scenario']['detour_days_default']:g} days", "Suez derived default detour")
for key, text in [("s_displaced", fmt(sb["displaced_bpd"])), ("s_evs", fmt(k["evs_required"])), ("s_li", fmt(k["extra_lithium_t_lce"])), ("s_cap", fmt(cap)),
                  ("s_deficit", fmt(k["lithium_deficit_t_lce"])), ("s_gap", fmt(sb["transit_gap_bbl"])), ("s_factor", f"{factor:.6f}"),
                  ("s_supply_loss", f"{sb['supply_loss_pct']:.3f}"), ("s_price", f"{k['price_impact_pct']:.1f}")]:
    claim("DEMO_SCRIPT.md", text, f"DEMO_SCRIPT {key}")

# ---------------------------------------------------------------------------------------------------------------- the Hormuz blockade (API)
h = client.post("/api/v1/simulate/report", json={"route_id": "hormuz", "disruption_type": "blockade", "blocked_share_pct": 100, "duration_days": 30,
                                                   "conflict_intensity": 8, "demand_change_pct": 0, "ev_substitution_rate_pct": 100, "lithium_availability_pct": 10, "horizon_years": 5}).json()
hb = h["sections"]["barrels"]["numbers"]
hflow = h["baseline"]["flow_bpd"]
assert h["kpis"]["outside_validated_range"] is True and h["validated_supply_loss_max_pct"] == 8
claim("README.md", f"{hb['supply_loss_pct']:.1f}% supply loss", "Hormuz supply loss")
claim("README.md", f"+{h['kpis']['price_impact_pct']:.0f}%", "Hormuz price implied")
claim("DEMO_SCRIPT.md", f"{hflow / 1e6:g} Mb/d", "Hormuz flow")
claim("DEMO_SCRIPT.md", f"{(hflow - hb['displaced_bpd']) / 1e6:g} Mb/d that can go round", "Hormuz bypass")
claim("DEMO_SCRIPT.md", f"+{h['validated_reference']['actual_price_move_pct']:.1f}%", "2026 war actual move")
claim("DEMO_SCRIPT.md", f"+{8 / CFG.elasticity_abs:.1f}%", "formula at the validated edge")
sens = h["sections"]["price"]["sensitivity"]
claim("README.md", f"{sens[0]['bypass_bpd'] / 1e6:g} Mb/d", "Hormuz bypass headline")
claim("README.md", f"{sens[1]['bypass_bpd'] / 1e6:g} Mb/d", "Hormuz bypass sensitivity")

# ---------------------------------------------------------------------------------------------------------------- M15: endpoints, env vars, the vessels, the Markets card, the demo script as a whole
spec = main.app.openapi()
readme = DOCS["README.md"]
norm = lambda t: re.sub(r"\{[^}]*\}", "{}", t)
readme_n = norm(readme)
for path_ in sorted(spec["paths"]):
    if path_.startswith("/api/v1/"):
        results.append((norm(path_) in readme_n, "README.md", "every served endpoint is in the endpoint table", path_))
for line in (BACKEND / ".env.example").read_text(encoding="utf-8").splitlines():
    m_ = re.match(r"^([A-Z][A-Z0-9_]+)=", line)
    if m_:
        results.append((f"`{m_.group(1)}`" in readme, "README.md", "every variable in .env.example is in the environment table", m_.group(1)))

wl_ = client.get("/api/v1/vessels/watchlist").json()
trk_ = client.get("/api/v1/vessels/538006502/track").json()
# The saved AIS snapshot lives in git-ignored folders (DECISIONS D9), so a clean export has none: the vessel claims and the whole-script comparison need it and are
# skipped there (printed at the end), exactly as the AIS tests skip when the raw folder is absent.
have_ais = wl_.get("status") == "SNAPSHOT" and bool(wl_.get("captured_at_utc")) and trk_.get("status") == "SAVED"
cap_ = wl_["captured_at_utc"].replace("T", " ")[:16] + " UTC" if have_ais else ""
if have_ais:
  claim("DEMO_SCRIPT.md", f"SNAPSHOT {cap_} · {len(wl_['vessels'])} REAL TANKERS", "the real-tanker badge text (watchlist endpoint)")
if have_ais:
  claim("DEMO_SCRIPT.md", wl_["key_line"], "the AIS key line (watchlist endpoint)")
  claim("DEMO_SCRIPT.md", trk_["label"], "the saved track label (track endpoint)")
  claim("DEMO_SCRIPT.md", f"{trk_['path_nm']:g} nm sailed, {trk_['start_to_end_nm']:g} nm start to end", "the headline track distances (track endpoint)")
  claim("README.md", "Twelve **real** tankers", "twelve real tankers")
  assert len(wl_["vessels"]) == 12

# the one-point 30-day result of the Suez example, and the WTI scenario card's arithmetic
pj = client.get("/api/v1/price/live").json()
traj_ = s["sections"]["price"]["chart"]["trajectory"]
results.append((len(traj_) == 1 and traj_[0]["day"] == 30, "(API)", "the price result is one point, day 30", str(traj_[0]["day"])))
mv_ = round(5 / CFG.elasticity_abs, 2)
# the WTI card follows the EIA price, which differs between machines and days (with no EIA key the offline CSV row is used), so these two are checked only when this
# machine's price is the one the script was generated with (same as-of date)
if f"as of {pj['as_of']}" in DOCS["DEMO_SCRIPT.md"]:
  claim("DEMO_SCRIPT.md", f"${pj['wti'] * (1 + mv_ / 100):,.2f}** (+{mv_:.1f}%)", "the WTI scenario card at the default 5% supply loss")
  claim("DEMO_SCRIPT.md", f"range ${pj['wti'] * (1 + (mv_ - CFG.price_band_pp) / 100):,.2f} to ${pj['wti'] * (1 + (mv_ + CFG.price_band_pp) / 100):,.2f}", "the WTI scenario range (plus or minus the 13.09 pp)")
else:
  print("SKIPPED: this machine's WTI price is not the one the DEMO_SCRIPT was generated with, so the WTI scenario figures were not checked.")

# the whole DEMO_SCRIPT: regenerate it from the template and the API now, and it must equal the file (the date it was generated on is taken from the file itself)
if have_ais:
  import importlib.util  # noqa: E402
  spec_ = importlib.util.spec_from_file_location("make_demo_script", BACKEND / "tools" / "make_demo_script.py")
  mds = importlib.util.module_from_spec(spec_)
  spec_.loader.exec_module(mds)
  vals_ = mds.values(client)
  m_date = re.search(r"on (\d{4}-\d{2}-\d{2}) by `backend/tools/make_demo_script.py`", DOCS["DEMO_SCRIPT.md"])
  if m_date:
      vals_["generated_on"] = m_date.group(1)
  fresh = (BACKEND / "tools" / "demo_script_template.md").read_text(encoding="utf-8")
  for k_, v_ in vals_.items():
      fresh = fresh.replace(f"@@{k_}@@", v_)
  same = fresh.replace("\r\n", "\n").strip() == DOCS["DEMO_SCRIPT.md"].replace("\r\n", "\n").strip()
  results.append((same, "DEMO_SCRIPT.md", "the whole script equals what make_demo_script.py produces from the API now", "every number, every date"))

# ---------------------------------------------------------------------------------------------------------------- report
failed = [r for r in results if not r[0]]
width = max(len(r[2]) for r in results)
for ok, doc, label, expected in results:
    print(f"{'PASS' if ok else 'FAIL'}  {label:<{width}}  {doc:<32} {expected[:70]!r}")
print(f"\n{len(results) - len(failed)} of {len(results)} claims match the running app and the data files.")
if not have_ais:
    print("SKIPPED: no saved AIS snapshot in this checkout (git-ignored), so the vessel, track and whole-DEMO_SCRIPT claims were not checked.")
print("NOT CHECKED HERE (historical measurements, cannot be recomputed): EIA latency, observed data lag, fps numbers, page load times, "
      "the GDELT timings, the Phase 1 experiment rows other than 13.09 and 13.80, and everything about the live AIS feed.")
sys.exit(1 if failed else 0)
