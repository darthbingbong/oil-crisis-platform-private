"""Applies the M2 data decisions to data/routes.json and records the calculations.

Run from backend/:  python tools/derive_voyages.py

1. baseline_year: last normal pre-disruption year per route (Suez, Bab el-Mandeb and
   the Cape use 2023; the Red Sea attacks halved 2024 flows / inflated the Cape).
2. baseline_voyage_days: typical FULL voyage for cargoes using the route (not the
   chokepoint transit), = distance_nm / (14 kn * 24 h). Distance is the great-circle
   sum over our own illustrative waypoints, so it understates real sea distance and
   every derived value stays is_estimate=true.
3. default_detour_days (Red Sea / Suez): extra days of the Cape voyage vs the Suez voyage.
4. CPC duplicate GEM record resolved; Druzhba marked n/a and excluded from calculations.
"""

import json
import math
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data" / "routes.json"
TANKER_KNOTS = 14.0  # the project's tanker speed (brief section 4.5)
EARTH_RADIUS_NM = 3440.065

RAS_TANURA = (26.7, 50.15)
HORMUZ = (26.57, 56.25)
ARABIAN_SEA = [(23.5, 60.5), (15.0, 66.0)]
MALACCA_LEG = [(7.5, 76.0), (5.5, 80.5), (5.5, 90.0), (5.5, 97.5), (2.5, 101.3), (1.25, 103.8), (5.0, 108.5), (12.0, 112.5), (22.0, 119.0)]
NINGBO = (29.9, 122.2)
# Gulf of Aden -> Red Sea -> Suez -> Mediterranean -> Gibraltar -> Rotterdam
SUEZ_LEG = [(12.0, 45.0), (12.6, 43.3), (15.5, 41.8), (20.0, 38.5), (27.7, 33.6), (29.95, 32.55), (31.27, 32.31), (34.0, 28.0), (36.0, 14.0), (36.0, -5.5), (37.0, -9.5), (43.5, -9.5), (48.5, -5.5), (50.0, -2.0), (51.5, 2.5), (51.95, 4.1)]
# Cape alternative from the Arabian Sea to Rotterdam
CAPE_LEG = [(5.0, 55.0), (-10.0, 48.0), (-25.0, 38.0), (-33.5, 28.0), (-35.4, 20.0), (-34.5, 17.5), (-28.0, 13.0), (-15.0, 8.0), (0.0, 2.0), (15.0, -17.5), (30.0, -15.0), (37.0, -9.5), (43.5, -9.5), (48.5, -5.5), (50.0, -2.0), (51.5, 2.5), (51.95, 4.1)]
NOVOROSSIYSK = (44.7, 37.8)
TRIESTE = (45.65, 13.75)
TURKISH_VOYAGE = [NOVOROSSIYSK, (42.0, 29.0), (41.2, 29.1), (41.0, 29.0), (40.8, 28.5), (40.7, 27.5), (40.2, 26.4), (39.7, 25.5), (36.8, 23.3), (36.5, 19.0), (39.5, 18.5), (42.5, 16.0), (44.5, 13.3), TRIESTE]
PRIMORSK = (60.35, 28.6)
DANISH_VOYAGE = [PRIMORSK, (59.8, 24.0), (59.0, 20.0), (57.0, 18.5), (55.0, 14.0), (54.8, 12.5), (54.7, 11.0), (55.3, 10.9), (55.8, 11.0), (56.8, 11.3), (57.8, 10.7), (58.0, 8.0), (56.5, 3.5), (53.5, 3.5), (51.95, 4.1)]


def nm(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * EARTH_RADIUS_NM * math.asin(math.sqrt(h))


def chain_nm(pts):
    return sum(nm(a, b) for a, b in zip(pts, pts[1:]))


def voyage(label, pts):
    dist = chain_nm(pts)
    days = dist / (TANKER_KNOTS * 24)
    return {
        "representative_voyage": label,
        "waypoints_latlng": [list(p) for p in pts],
        "distance_nm": round(dist),
        "speed_knots": TANKER_KNOTS,
        "days": round(days, 1),
        "calculation": f"{round(dist)} nm / ({TANKER_KNOTS:g} kn x 24 h) = {days:.1f} days",
        "method_note": "Great-circle sum over illustrative waypoints. Real sea distance is longer, so days are a lower bound. Not a sourced distance.",
        "is_estimate": True,
    }


def main():
    doc = json.loads(DATA.read_text(encoding="utf-8"))
    routes = {r["id"]: r for r in doc["routes"]}

    ningbo = [RAS_TANURA, HORMUZ, *ARABIAN_SEA, *MALACCA_LEG, NINGBO]
    suez_v = [RAS_TANURA, HORMUZ, *ARABIAN_SEA, *SUEZ_LEG]
    cape_v = [RAS_TANURA, HORMUZ, *ARABIAN_SEA[:1], *CAPE_LEG]
    v = {
        "hormuz": voyage("Ras Tanura to Ningbo via Hormuz and Malacca (largest importer, China)", ningbo),
        "malacca": voyage("Ras Tanura to Ningbo via Hormuz and Malacca", ningbo),
        "bab_el_mandeb": voyage("Ras Tanura to Rotterdam via Hormuz, Bab el-Mandeb and Suez", suez_v),
        "suez": voyage("Ras Tanura to Rotterdam via Hormuz, Bab el-Mandeb and Suez", suez_v),
        "turkish_straits": voyage("Novorossiysk to Trieste via the Turkish Straits", TURKISH_VOYAGE),
        "danish_straits": voyage("Primorsk to Rotterdam via the Danish Straits", DANISH_VOYAGE),
    }
    cape = voyage("Ras Tanura to Rotterdam via the Cape of Good Hope", cape_v)
    detour_days = round(cape["days"] - v["suez"]["days"], 1)

    # --- baseline years -------------------------------------------------
    world = doc["_meta"]["global_reference"]
    world["world_maritime_oil_trade_bpd_by_year"] = {"2023": 80200000, "2024": 79700000}
    baseline_year = {"hormuz": 2024, "malacca": 2024, "turkish_straits": 2024, "danish_straits": 2024,
                     "bab_el_mandeb": 2023, "suez": 2023, "cape_good_hope": 2023}
    for rid, yr in baseline_year.items():
        r = routes[rid]
        r["baseline_year"] = yr
        r["annual_flow_bpd"] = round(r["flow_history_mbpd"][str(yr)] * 1e6)
        r["share_of_global_seaborne_oil_pct"] = round(r["annual_flow_bpd"] / world["world_maritime_oil_trade_bpd_by_year"][str(yr)] * 100, 1)
        r["data_year"] = yr
        r["flow_by_year_bpd"] = {y: round(m * 1e6) for y, m in r["flow_history_mbpd"].items()}
    for rid in ("bab_el_mandeb", "suez"):
        routes[rid]["baseline_year_note"] = ("2023 is the last normal year. EIA's 2024 figure is depressed by Red Sea attacks "
                                             f"({routes[rid]['flow_history_mbpd']['2024']} vs {routes[rid]['flow_history_mbpd']['2023']} Mb/d). Both stored in flow_by_year_bpd.")
        routes[rid]["default_detour_days"] = detour_days
        routes[rid]["default_detour_days_note"] = (f"Cape voyage {cape['days']} d minus Suez voyage {v['suez']['days']} d, same waypoint method (estimate, lower bound).")
    routes["cape_good_hope"]["baseline_year_note"] = "2023 (6.2 Mb/d) is the last year before Red Sea diversions; 2024 (9.3) is inflated by them."
    routes["cape_good_hope"]["voyage_derivation"] = cape
    routes["cape_good_hope"]["baseline_voyage_note"] = "Not applicable: this lane is the alternative. Its length is used to derive default_detour_days."
    for rid in ("hormuz", "malacca", "turkish_straits", "danish_straits"):
        routes[rid]["baseline_year_note"] = "Last full pre-disruption year in EIA's table (1H25 is also stored in flow_history_mbpd)."

    # --- voyage days ----------------------------------------------------
    for rid, d in v.items():
        r = routes[rid]
        r["baseline_voyage_days"] = d["days"]
        r["voyage_derivation"] = d
        r["baseline_voyage_note"] = ("Typical FULL voyage for cargoes using this route (not the transit time through the chokepoint): "
                                     "distance / 14 kn. Estimate: distance is from illustrative waypoints.")
        fields = [f for f in r["estimate_fields"] if f != "baseline_voyage_days"] + ["baseline_voyage_days"]
        r["estimate_fields"] = fields

    # --- CPC ------------------------------------------------------------
    cpc = routes["cpc"]
    cpc["capacity_bpd"] = 1340000
    cpc["capacity_upper_bpd"] = 1661315
    cpc["capacity_resolution"] = {
        "finding": "Second GEM record (P2044, 321,315 bpd) is a separate capacity INCREMENT, not a double-count.",
        "arithmetic": "At about 7.33 bbl per tonne: 1,340,000 bpd = 67 Mt/yr; 321,315 bpd = 16 Mt/yr; 67 + 16 = 83 Mt/yr.",
        "corroboration": "Interfax (2023) reports CPC debottlenecking to 83 Mt/yr; 2018 expansion reached 67 Mt/yr. EIA still cites about 1.4 Mb/d.",
        "decision": "capacity_bpd stays at the 1.34 Mb/d EIA-consistent figure (conservative). capacity_upper_bpd = 1.66 Mb/d is the case if the debottlenecking is fully realised. Sources are secondary, so this stays an estimate.",
        "is_estimate": True,
    }
    cpc["bypass_note"] = "See capacity_resolution. Owner list is partial."

    # --- Druzhba --------------------------------------------------------
    dz = routes["druzhba"]
    dz["status"] = "n/a"
    dz["excluded_from_calculations"] = True
    dz["exclusion_reason"] = "No sourced throughput or capacity. Kept out of every calculation until one exists."

    # --- current conditions ---------------------------------------------
    doc["_meta"]["current_conditions"] = {
        "note": ("Baseline data comes from the last pre-crisis year (2023 or 2024). Real conditions in 2026 differ: EIA reports the Strait of Hormuz "
                 "effectively closed since early 2026 with production shut-ins across Gulf producers. Treat results as a what-if from a normal baseline, not a forecast of current flows."),
        "links": [
            {"label": "EIA press release, 7 April 2026: Hormuz closure and related outages", "url": "https://www.eia.gov/pressroom/releases/press586.php"},
            {"label": "EIA Short-Term Energy Outlook (latest)", "url": "https://www.eia.gov/outlooks/steo/"}
        ],
        "source": "EIA press release 7 April 2026 and Short-Term Energy Outlook (October 2026), as returned by search; read the linked pages for current figures.",
        "is_estimate": False,
    }

    DATA.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for rid in ("hormuz", "bab_el_mandeb", "suez", "malacca", "turkish_straits", "danish_straits"):
        r = routes[rid]
        print(f"{rid:16} baseline {r['baseline_year']}  flow {r['annual_flow_bpd']/1e6:5.1f} Mb/d  share {r['share_of_global_seaborne_oil_pct']:>4}%  voyage {r['baseline_voyage_days']:>5} d  ({r['voyage_derivation']['calculation']})")
    print(f"cape_good_hope   baseline 2023  flow {routes['cape_good_hope']['annual_flow_bpd']/1e6:5.1f} Mb/d  voyage via Cape: {cape['calculation']}")
    print(f"default_detour_days (Suez->Cape): {detour_days}")


if __name__ == "__main__":
    main()
