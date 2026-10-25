"""Builds the full scenario report for the Results page from the calc engine.

Summaries are deterministic templates filled with the computed numbers, so text and charts cannot disagree.
"""

from . import calc_engine as ce
from .config import DEFAULT_CONFIG, EIA_CHOKEPOINTS_URL, ICCT_URL, IEA_GEVO_URL, IMF_RULE_URL, USGS_LITHIUM_URL, CalcConfig
from .route_data import lithium_doc, routes_doc, validated_reference, validated_supply_loss_max_pct


class ScenarioError(ValueError):
    """The scenario cannot be computed (unknown input combination); the router turns this into a 422."""


def _mb(x: float) -> str:
    return f"{x / 1e6:,.1f} million"


def _n(x: float) -> str:
    return f"{x:,.0f}"


def _a(text: str, source: str | None = None, url: str | None = None, is_estimate: bool = False) -> dict:
    return {"text": text, "source": source, "source_url": url, "is_estimate": is_estimate}


def _displaced(route: dict, flow: float, req: dict, cfg: CalcConfig, bypass: float) -> tuple[float, float, dict]:
    """Returns (displaced_bpd, transit_gap_bbl, details) for the chosen disruption type."""
    if req["disruption_type"] == "blockade":
        share = req["blocked_share_pct"] / 100.0
        return ce.displaced_bpd_blockade(flow, share, bypass), 0.0, {"blocked_bpd": flow * share, "bypass_bpd": bypass}
    T = route.get("baseline_voyage_days")
    if not T:
        raise ScenarioError(f"Route '{route['id']}' has no baseline voyage length, so a detour cannot be modelled.")
    dt = req["detour_days"]
    factor = ce.delivery_factor(T, dt)
    return (ce.displaced_bpd_detour(flow, T, dt, req["fleet_constrained"]), ce.transit_gap_barrels(flow, dt),
            {"baseline_voyage_days": T, "detour_days": dt, "delivery_factor": factor})


def build_report(route: dict, req: dict, cfg: CalcConfig = DEFAULT_CONFIG) -> dict:
    if route.get("excluded_from_calculations"):
        raise ScenarioError(f"Route '{route['id']}' is excluded from calculations: {route.get('exclusion_reason')}")
    if route["type"] == "pipeline" or not route.get("annual_flow_bpd"):
        raise ScenarioError(
            f"Route '{route['id']}' is a pipeline with nameplate capacity only; no sourced throughput exists, "
            "so a disruption cannot be sized. Simulate a chokepoint or sea lane instead.")

    req = dict(req)
    year = str(req.get("baseline_year") or route["baseline_year"])
    flows = route["flow_by_year_bpd"]
    if year not in flows:
        raise ScenarioError(f"No {year} flow stored for '{route['id']}'. Available: {sorted(flows)}")
    flow = float(flows[year])
    if req.get("detour_days") is None:
        req["detour_days"] = route.get("default_detour_days", 0.0)
    bypass_known = route.get("bypass_capacity_bpd") is not None
    bypass = float(route.get("bypass_capacity_bpd") or 0.0)

    displaced, gap, detail = _displaced(route, flow, req, cfg, bypass)
    loss = ce.supply_loss_pct(displaced, cfg)
    price = ce.price_impact_pct(loss, cfg)
    dur = req["duration_days"]
    hl = ce.default_half_life_days(dur, cfg)
    traj = ce.price_trajectory(price, dur, hl, cfg)
    dseries = ce.displaced_series(displaced, dur, gap, cfg)

    # --- validated range (Phase 1): the +/-13 pp band was measured only on events up to vmax supply loss ---
    ref = validated_reference()
    vmax = validated_supply_loss_max_pct()
    outside = abs(loss) > vmax
    ceiling_pct = vmax / cfg.elasticity_abs  # price move the formula gives at the edge of the validated range
    for pt in traj:
        pt["beyond_validated"] = abs(pt["pct"]) > ceiling_pct
        if outside:  # do not show the band as if it applied
            pt["low"] = pt["high"] = None

    # sensitivity: blockade with the low bypass estimate (Hormuz)
    sensitivity = []
    low = route.get("bypass_capacity_low_bpd")
    if req["disruption_type"] == "blockade":
        cases = [("Headline: EIA latest bypass estimate", bypass)]
        if low is not None and bypass_known:
            cases.append(("Sensitivity: older EIA 'effective unused' estimate", float(low)))
        for label, b in cases:
            d = ce.displaced_bpd_blockade(flow, req["blocked_share_pct"] / 100.0, b)
            s = ce.supply_loss_pct(d, cfg)
            sensitivity.append({"label": label, "bypass_bpd": b, "displaced_bpd": d,
                                "supply_loss_pct": s, "price_impact_pct": ce.price_impact_pct(s, cfg)})

    # EVs and lithium
    evs = ce.vehicles_offset(displaced, req["ev_substitution_rate_pct"], cfg)
    horizons = ce.ev_horizons(evs, cfg)
    h = req["horizon_years"]
    li = lithium_doc()
    cases_li = {
        "project": {**ce.lithium_case(evs, cfg.lce_t_per_ev_project, req["lithium_availability_pct"], h, cfg),
                    "label": "Project assumption (0.008 t LCE per EV, unsourced)"},
        "sourced": {**ce.lithium_case(evs, ce.lce_per_ev_sourced(cfg), req["lithium_availability_pct"], h, cfg),
                    "label": f"Sourced case ({cfg.li_kg_per_kwh} kg Li/kWh x {cfg.typical_pack_kwh:g} kWh x {cfg.lce_per_t_li})"},
    }
    pack_cases = []
    for label, kwh in cfg.pack_cases:
        t_ev = cfg.li_kg_per_kwh * kwh * cfg.lce_per_t_li / 1000.0
        c = ce.lithium_case(evs, t_ev, req["lithium_availability_pct"], h, cfg)
        pack_cases.append({"label": label, "pack_kwh": kwh, "lce_t_per_ev": t_ev, "required_t_lce": c["required_t_lce"],
                           "deficit_t_lce": c["deficit_t_lce"]})
    range_low = min(c["required_t_lce"] for c in pack_cases)
    range_high = max(c["required_t_lce"] for c in pack_cases)
    head_key = cfg.lithium_headline_case
    head = cases_li[head_key]
    production_lce = ce.world_li_production_lce(cfg)
    countries = [{"name": c["name"], "iso3": c["iso3"],
                  "reserves_t_lce": c["reserves_t_li"] * cfg.lce_per_t_li,
                  "production_2025_t_lce": (c["mine_production_t_li"]["2025"] or 0) * cfg.lce_per_t_li}
                 for c in li["countries"] if c["iso3"] or c["name"] != "Other countries"]

    importers = ce.importer_shortfall(displaced, route.get("top_importers", []))
    macro = ce.macro_ranges(price, dur, cfg)
    tonne_mile = ce.tonne_mile_change_pct(detail["baseline_voyage_days"], detail["detour_days"]) if req["disruption_type"] == "detour" else None

    base_year_note = route.get("baseline_year_note")
    depressed = route["id"] in ("suez", "bab_el_mandeb") and year == "2024"
    cur = routes_doc()["_meta"]["current_conditions"]
    where = f"{route['name']} ({'blockade of ' + format(req['blocked_share_pct'], 'g') + '%' if req['disruption_type'] == 'blockade' else format(req['detour_days'], 'g') + '-day detour'}, {format(dur, 'g')} days)"

    # ---------------- sections ------------------------------------------------
    s_barrels = {
        "title": "Barrels displaced",
        "summary": (
            f"{where} removes {_n(displaced)} barrels per day from the market, starting from a {year} baseline flow of "
            f"{_n(flow)} barrels per day. That is {loss:.2f}% of world supply ({_mb(cfg.global_supply_bpd)} barrels per day). "
            f"Over the {format(dur, 'g')}-day disruption about {_mb(dseries[-1]['cumulative_bbl'])} barrels are lost in total"
            + (f", including a one-time transit gap of {_mb(gap)} barrels while longer voyages refill." if gap else ".")),
        "takeaway": f"{_n(displaced)} barrels per day displaced ({loss:.2f}% of world supply).",
        "chart": {"series": dseries},
        "numbers": {"displaced_bpd": displaced, "supply_loss_pct": loss, "transit_gap_bbl": gap, **detail},
        "assumptions": [
            _a(f"Baseline flow {_n(flow)} bpd, {year}.", "EIA, World Oil Transit Chokepoints", EIA_CHOKEPOINTS_URL),
            _a(f"World supply {_n(cfg.global_supply_bpd)} bpd (2024).", "EIA, World Oil Transit Chokepoints, Table 1", EIA_CHOKEPOINTS_URL),
            _a("Supply is assumed fully restored the day the disruption ends.", is_estimate=True),
            *([_a("Bypass capacity not sourced for this route; treated as zero (worst case).", is_estimate=True)]
              if req["disruption_type"] == "blockade" and not bypass_known else []),
            *([_a(f"Fixed tanker fleet (worst case): fleet_constrained={req['fleet_constrained']}. Delivery rate scales by T/(T+dt) = "
                  f"{detail['delivery_factor']:.3f}, T = {detail['baseline_voyage_days']} days.", is_estimate=True),
               _a("Baseline voyage length is derived from distance at 14 knots over illustrative waypoints, not a surveyed distance.",
                  is_estimate=True)] if req["disruption_type"] == "detour" else []),
        ],
    }

    pk = traj[int(min(dur, cfg.trajectory_days))]["pct"]
    band_txt = (f"The shaded band is plus or minus {cfg.price_band_pp:g} percentage points, the formula's average error across 21 historical events."
                if not outside else
                f"The plus or minus {cfg.price_band_pp:g} percentage point error band is NOT shown: it was measured on events up to {vmax:g}% supply loss, and this "
                "scenario is beyond that, so the band is not validated at this magnitude.")
    s_price = {
        "title": "Oil price trajectory",
        "summary": (
            f"For a {loss:.2f}% supply loss the linear formula implies about a {price:+.1f}% price move (supply loss divided by {cfg.elasticity_abs}). "
            f"The formula holds that level for {format(dur, 'g')} days, then decays toward baseline with a {hl:g}-day half-life. " + band_txt
            + (f" This is outside the validated range: the largest validated event, {ref['name']}, had a {ref['supply_loss_pct']:g}% supply loss and an actual "
               f"price move of {ref['actual_price_move_pct']:+.1f}%. The linear formula implies {price:+.1f}% here, which is an extrapolation, not a forecast." if outside else "")),
        "takeaway": (f"The linear formula implies a peak of {pk:+.1f}%, outside the validated range (largest validated event: {ref['actual_price_move_pct']:+.1f}% at {ref['supply_loss_pct']:g}% supply loss)."
                     if outside else f"The linear formula implies a peak of {pk:+.1f}%, with a ±{cfg.price_band_pp:g} pp band."),
        "chart": {"trajectory": traj, "half_life_days": hl, "band_validated": not outside,
                  "validated_price_ceiling_pct": ceiling_pct, "validated_reference": ref},
        "numbers": {"peak_pct": price, "band_pp": cfg.price_band_pp, "band_validated": not outside, "half_life_days": hl,
                    "outside_validated_range": outside, "validated_supply_loss_max_pct": vmax},
        "sensitivity": sensitivity,
        "assumptions": [
            _a(f"%dP = %dS / |Ed|, Ed = -{cfg.elasticity_abs} (borrowed textbook short-run value). Phase 1 tested a trained model on 21 events and it did not beat this formula.",
               "backend/PHASE1_SUMMARY.md; phase1_analysis.py"),
            _a(f"Band of ±{cfg.price_band_pp} pp = leave-one-out mean absolute error of the formula on 21 daily-resolution events, all with supply loss up to {vmax:g}% (small sample). It does not apply beyond that.",
               "phase1_analysis.py output: 13.09 pp"),
            _a(f"Exponential decay after the disruption with a {hl:g}-day half-life (default: half the duration, clamped to {cfg.half_life_min_days:g} to {cfg.half_life_max_days:g} days).",
               is_estimate=True),
            _a("Price is assumed to move linearly with supply loss; this is unverified for very large shocks and no nonlinear model or cap is applied.", is_estimate=True),
        ],
    }
    caveats = ce.price_caveats(loss, req["conflict_intensity"], req["demand_change_pct"])
    if outside:
        caveats.insert(0, (
            f"Outside the validated range: this scenario removes {loss:.1f}% of world supply, but the 21 events the formula's error band was "
            f"measured on reach at most {vmax:g}%. The linear formula is extrapolated far beyond that evidence, so treat the price figure as an "
            "order-of-magnitude illustration; the ±13 pp band understates the real uncertainty here."))
    if sensitivity and len(sensitivity) > 1:
        lo_case = sensitivity[1]
        s_price["summary"] += (f" The blockade result depends on the bypass assumption: with the headline {_mb(sensitivity[0]['bypass_bpd'])} barrels per day of "
                               f"pipeline bypass the price impact is {sensitivity[0]['price_impact_pct']:+.1f}%, with the lower {_mb(lo_case['bypass_bpd'])} case it is "
                               f"{lo_case['price_impact_pct']:+.1f}%.")

    s_evs = {
        "title": "EVs required",
        "summary": (
            f"Offsetting {_n(displaced)} barrels per day of lost crude would take about {_mb(evs)} electric cars replacing gasoline cars "
            f"(at a {req['ev_substitution_rate_pct']:g}% substitution rate). Delivered over 1, 3 or 5 years that is "
            f"{_mb(horizons[0]['evs_per_year'])}, {_mb(horizons[1]['evs_per_year'])} or {_mb(horizons[2]['evs_per_year'])} extra EVs per year, "
            f"or {horizons[0]['x_current_global_sales']:.1f}, {horizons[1]['x_current_global_sales']:.1f} and {horizons[2]['x_current_global_sales']:.1f} times "
            f"today's global sales of about {_mb(cfg.current_global_ev_sales_per_year)} a year."),
        "takeaway": f"{_mb(evs)} EVs needed; a {h}-year plan is {horizons[[x['years'] for x in horizons].index(h)]['x_current_global_sales']:.1f}x today's annual sales."
        if h in cfg.horizons_years else f"{_mb(evs)} EVs needed.",
        "chart": {"horizons": horizons, "current_global_sales": cfg.current_global_ev_sales_per_year,
                  "current_global_production": cfg.current_global_ev_production_per_year},
        "numbers": {"vehicles_offset": evs},
        "assumptions": [
            _a(f"1 barrel of crude yields {cfg.gasoline_gal_per_bbl} gal of gasoline; one gasoline car burns {cfg.gal_per_vehicle_year:g} gal per year. "
               "500 gal is a US-style figure; the global average is lower, so the true EV count would be higher.", "Project brief", None, True),
            _a("Current EV sales: 'exceed 20 million in 2025'; almost 22 million produced.", "IEA, Global EV Outlook 2026", IEA_GEVO_URL),
            _a("Total EVs are treated as a fleet that must be in place to replace the lost fuel permanently; per-year figures divide that by the horizon.", is_estimate=True),
        ],
    }

    s_li = {
        "title": "Lithium required",
        "summary": (
            f"Building {_mb(evs)} EVs needs about {_n(cases_li['sourced']['required_t_lce'])} tonnes of lithium carbonate equivalent (LCE) using the sourced "
            f"battery figure, or {_n(cases_li['project']['required_t_lce'])} tonnes using the project's 0.008 t per EV assumption. The sourced case is the headline "
            f"because it rests on a published lithium-per-kWh figure; the project value is about "
            f"{cfg.lce_t_per_ev_project and ce.lce_per_ev_sourced(cfg) / cfg.lce_t_per_ev_project:.1f} times lower. Over {h} years the headline case needs "
            f"{head['pct_of_world_production_per_year']:.0f}% of current world mine production each year ({_n(production_lce)} t LCE in 2025). "
            f"With {req['lithium_availability_pct']:g}% of that production available the shortfall is {_n(head['deficit_t_lce'])} tonnes LCE. "
            f"Using the larger EU and US pack sizes instead of 60 kWh, the requirement ranges from {_n(range_low)} to {_n(range_high)} tonnes LCE. {cfg.chemistry_caveat}"),
        "takeaway": f"Headline ({head_key}): {_n(head['required_t_lce'])} t LCE needed, deficit {_n(head['deficit_t_lce'])} t LCE.",
        "chart": {"cases": cases_li, "headline_case": head_key, "world_production_2025_t_lce": production_lce,
                  "countries": countries, "pack_cases": pack_cases, "range_t_lce": [range_low, range_high],
                  "chemistry_caveat": cfg.chemistry_caveat},
        "numbers": {"headline_case": head_key, "lce_t_per_ev_sourced": ce.lce_per_ev_sourced(cfg), "lce_t_per_ev_project": cfg.lce_t_per_ev_project},
        "assumptions": [
            _a(f"Sourced case: NMC-811 cathodes hold about {cfg.li_kg_per_kwh} kg lithium per kWh; {cfg.typical_pack_kwh:g} kWh pack (IEA: BEV packs below 60 kWh in China, close to 70 in the EU, 90 in the US); x{cfg.lce_per_t_li} to convert lithium to LCE.",
               "ICCT (Feb 2024) p.17; IEA GEVO 2026", ICCT_URL),
            _a("Project case 0.008 t LCE per EV (about 8 kg) comes from the project brief and has no source. It looks low against published battery figures.",
               "Project brief", None, True),
            _a(f"World mine production {_n(cfg.world_li_production_t_li)} t lithium content (2025 estimate, excl. US) converted to LCE; reserves {_n(cfg.world_li_reserves_t_li)} t.",
               "USGS Mineral Commodity Summaries 2026", USGS_LITHIUM_URL),
            _a(f"Supply cap = lithium availability % x current world production per year. Default {req['lithium_availability_pct']:g}%: USGS shows 2025 production "
               "(290,000 t Li) above consumption (263,000 t Li) by only about 9%, so little output is spare. Real redirectable supply is a scenario input, not a sourced value.",
               "USGS Mineral Commodity Summaries 2026", USGS_LITHIUM_URL, True),
        ],
    }

    if importers:
        top = max(importers, key=lambda x: x["shortfall_bpd"])
        imp_summary = (f"The displaced barrels are allocated using EIA's published destination shares, which exist only at region or group level. "
                       f"The largest group, {top['name']}, takes {top['share_of_route_flow_pct']:g}% of route flow and would lose about {_n(top['shortfall_bpd'])} barrels per day. "
                       "Groups marked derived are simple subtractions of two published shares. Per-country figures and days of strategic reserve cover are not available from the sources used.")
        imp_take = f"Largest exposure: {top['name']} ({_n(top['shortfall_bpd'])} bpd)."
    else:
        imp_summary = ("No sourced importer breakdown exists for this route, so no shortfall is allocated. EIA publishes destination shares only for some routes "
                       "and only at group level; nothing is invented here.")
        imp_take = "No sourced importer shares for this route."
    s_imp = {
        "title": "Importer shortfall (by region/group)",
        "summary": imp_summary, "takeaway": imp_take,
        "chart": {"importers": importers, "label": "by region/group"},
        "numbers": {},
        "assumptions": [
            _a("Shortfall = displaced barrels x each group's share of route flow. Shares describe crude and condensate where stated.", "EIA", EIA_CHOKEPOINTS_URL),
            _a("Importers are allocated the loss pro rata; in reality buyers with spare cash or reserves would bid supplies away from others.", is_estimate=True),
        ],
    }

    scale = macro["scale_vs_10pct_year"]
    s_eco = {
        "title": "Economy and markets (indicative)",
        "summary": (
            f"Applying IMF rules of thumb to a {price:+.1f}% oil price move lasting {format(dur, 'g')} days implies a change in global GDP growth of roughly "
            f"{macro['global_gdp_growth_pp'][0]:+.2f} to {macro['global_gdp_growth_pp'][1]:+.2f} percentage points and global inflation by "
            f"{macro['global_inflation_pp'][0]:+.2f} to {macro['global_inflation_pp'][1]:+.2f} percentage points. Oil-importing economies in the Middle East, "
            f"Central Asia and Pakistan are implied to be hit harder (inflation {macro['oil_importer_inflation_pp'][0]:+.2f} pp). These are indicative ranges, not forecasts"
            + (f"; tanker demand in tonne-miles would rise about {tonne_mile:.0f}% because voyages are longer." if tonne_mile is not None else ".")),
        "takeaway": f"Global growth {macro['global_gdp_growth_pp'][0]:+.2f} to {macro['global_gdp_growth_pp'][1]:+.2f} pp (indicative).",
        "chart": {"ranges": [
            {"label": "Global GDP growth (pp)", "low": macro["global_gdp_growth_pp"][0], "high": macro["global_gdp_growth_pp"][1]},
            {"label": "Global inflation (pp)", "low": macro["global_inflation_pp"][0], "high": macro["global_inflation_pp"][1]},
            {"label": "Oil-importer GDP growth (pp)", "low": macro["oil_importer_gdp_growth_pp"][0], "high": macro["oil_importer_gdp_growth_pp"][1]},
            {"label": "Oil-importer inflation (pp)", "low": macro["oil_importer_inflation_pp"][0], "high": macro["oil_importer_inflation_pp"][1]},
        ], "sectors": [
            {"sector": "Airlines", "direction": "negative", "quantified": False, "note": "Fuel is a large share of costs; no sourced coefficient used."},
            {"sector": "Tanker shipping rates", "direction": "positive" if tonne_mile else "uncertain", "quantified": tonne_mile is not None,
             "note": (f"Tonne-mile demand +{tonne_mile:.0f}% (derived: detour days / baseline voyage days)." if tonne_mile is not None else "Not quantified for a blockade.")},
            {"sector": "Energy equities", "direction": "positive", "quantified": False, "note": "Directional only; no sourced coefficient used."},
        ]},
        "numbers": macro,
        "assumptions": [
            _a("Per +10% oil price sustained about a year: +0.4 pp global headline inflation, -0.1 to -0.2 global output (IMF, March 2026 as reported by Bloomberg). "
               "The sources differ on whether growth is in % or percentage points; treated as percentage points. Inflation upper bound 0.5 pp from a World Bank study over 2-3 years.",
               "IMF via Bloomberg, 6 Mar 2026; World Bank PRWP 10648", IMF_RULE_URL),
            _a("Oil-importing MENAP economies: about -0.5 pp output and +1.0 pp inflation per +10% (IMF regional outlook 2026); only a single point is published.", "IMF REO MCD/CCA 2026"),
            _a(f"Effects scaled by price move / 10 and by duration / 365 days (scale = {scale:.3f}); the IMF figures assume a shock persisting most of a year.", is_estimate=True),
            _a("Ranges use the central price estimate and ignore the ±13 pp price uncertainty, so true uncertainty is wider.", is_estimate=True),
        ],
    }

    return {
        "scenario": {**{k: v for k, v in req.items()}, "baseline_year": int(year), "route_name": route["name"]},
        "baseline": {"route_id": route["id"], "route_name": route["name"], "year": int(year), "flow_bpd": flow,
                     "label": f"Baseline year {year}", "note": base_year_note, "depressed_by_red_sea": depressed,
                     "flow_by_year_bpd": flows},
        "current_conditions": cur,
        "kpis": {
            "price_impact_pct": price, "price_band_pp": cfg.price_band_pp if not outside else None,
            "outside_validated_range": outside,
            "validated_note": (f"Outside the validated range: {loss:.1f}% supply loss; validated events reach {vmax:g}%. Linear-formula extrapolation, not a forecast."
                               if outside else None), "displaced_bpd": displaced,
            "evs_required": evs, "extra_lithium_t_lce": head["required_t_lce"], "extra_lithium_range_t_lce": [range_low, range_high], "lithium_deficit_t_lce": head["deficit_t_lce"],
            "lithium_headline_case": head_key, "horizon_years": h,
        },
        "sections": {"barrels": s_barrels, "price": s_price, "evs": s_evs, "lithium": s_li, "importers": s_imp, "economy": s_eco},
        "caveats": caveats,
        "validated_supply_loss_max_pct": vmax,
        "validated_reference": ref,
        "model_used": "elasticity_formula_baseline",
    }
