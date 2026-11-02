"""Builds the full scenario report for the Results page from the calc engine.

Summaries are deterministic templates filled with the computed numbers, so text and charts cannot disagree.
"""

from . import calc_engine as ce
from .config import DEFAULT_CONFIG, EIA_CHOKEPOINTS_URL, ICCT_URL, IEA_GEVO_URL, USGS_LITHIUM_URL, CalcConfig
from .route_data import lithium_doc, routes_doc, validated_reference, validated_supply_loss_max_pct


class ScenarioError(ValueError):
    """The scenario cannot be computed (unknown input combination); the router turns this into a 422."""


def _mb(x: float) -> str:
    return f"{x / 1e6:,.1f} million"


def _n(x: float) -> str:
    return f"{x:,.0f}"


def _a(text: str, source: str | None = None, url: str | None = None, is_estimate: bool = False) -> dict:
    return {"text": text, "source": source, "source_url": url, "is_estimate": is_estimate}


def _voyage_assumptions(route: dict) -> list[dict]:
    """Where the baseline voyage length comes from: a planned sea distance (sourced) and the 14-knot speed (assumption)."""
    d = route.get("voyage_derivation") or {}
    if d.get("provider"):
        return [_a(f"Baseline voyage length T is a planned sea distance of {d['distance_nm']:,.0f} nm (ShipFinder route planning, {d['representative_voyage']}, "
                   f"retrieved {d['retrieved_at_utc'][:10]}). A planned route, not a measured voyage.", "ShipFinder route planning"),
                _a("Tanker speed of 14 knots turns that distance into days (project assumption).", is_estimate=True)]
    return [_a("Baseline voyage length is derived from distance at 14 knots over illustrative waypoints, not a surveyed distance.", is_estimate=True)]


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

    if route["type"] == "sea_lane":
        raise ScenarioError(
            f"'{route['name']}' is the alternate lane used when Suez / Bab el-Mandeb traffic is rerouted, not a route you would "
            "disrupt. Simulate Suez or Bab el-Mandeb with a detour instead.")

    req = dict(req)
    year = str(req.get("baseline_year") or route["baseline_year"])
    flows = route["flow_by_year_bpd"]
    if year not in flows:
        raise ScenarioError(f"No {year} flow stored for '{route['id']}'. Available: {sorted(flows)}")
    flow = float(flows[year])
    user_detour = req.get("detour_days")
    if user_detour is None:
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
        "numbers": {"displaced_bpd": displaced, "supply_loss_pct": loss, "transit_gap_bbl": gap,
                    "global_supply_bpd": cfg.global_supply_bpd, "cumulative_bbl": dseries[-1]["cumulative_bbl"], **detail},
        "assumptions": [
            _a(f"Baseline flow {_n(flow)} bpd, {year}.", "EIA, World Oil Transit Chokepoints", EIA_CHOKEPOINTS_URL),
            _a(f"World supply {_n(cfg.global_supply_bpd)} bpd (2024).", "EIA, World Oil Transit Chokepoints, Table 1", EIA_CHOKEPOINTS_URL),
            _a("Supply is assumed fully restored the day the disruption ends.", is_estimate=True),
            *([_a("Bypass capacity not sourced for this route; treated as zero (worst case).", is_estimate=True)]
              if req["disruption_type"] == "blockade" and not bypass_known else []),
            *([_a(f"Fixed tanker fleet (worst case): fleet_constrained={req['fleet_constrained']}. Delivery rate scales by T/(T+dt) = "
                  f"{detail['delivery_factor']:.3f}, T = {detail['baseline_voyage_days']} days.", is_estimate=True),
               *_voyage_assumptions(route)] if req["disruption_type"] == "detour" else []),
        ],
    }

    pk = traj[int(min(dur, cfg.trajectory_days))]["pct"]
    core = (f"For a {loss:.2f}% supply loss the linear formula implies about a {price:+.1f}% price move (supply loss divided by {cfg.elasticity_abs}), "
            f"held for {format(dur, 'g')} days and then decaying toward baseline with a {hl:g}-day half-life.")
    if outside:
        second = (f"This is outside the validated range: the largest validated event, {ref['name']}, had a supply loss of {ref['supply_loss_pct']:g}% and an actual "
                  f"price move of {ref['actual_price_move_pct']:+.1f}%, and the plus or minus {cfg.price_band_pp:g} percentage point error band, measured only on events "
                  f"up to {vmax:g}% supply loss, is not validated at this magnitude and is not shown.")
    else:
        second = f"The shaded band is plus or minus {cfg.price_band_pp:g} percentage points, the formula's average error across {ref['n_events']} historical events."
    s_price = {
        "title": "Oil price trajectory",
        "summary": core + " " + second,
        "takeaway": (f"The linear formula implies a peak of {pk:+.1f}%, outside the validated range (largest validated event: {ref['actual_price_move_pct']:+.1f}% at {ref['supply_loss_pct']:g}% supply loss)."
                     if outside else f"The linear formula implies a peak of {pk:+.1f}%, with a ±{cfg.price_band_pp:g} pp band."),
        "chart": {"trajectory": traj, "half_life_days": hl, "band_validated": not outside,
                  "validated_price_ceiling_pct": ceiling_pct, "validated_reference": ref},
        "numbers": {"peak_pct": price, "band_pp": cfg.price_band_pp, "band_validated": not outside, "half_life_days": hl,
                    "outside_validated_range": outside, "validated_supply_loss_max_pct": vmax},
        "sensitivity": sensitivity,
        "assumptions": [
            _a(f"%dP = %dS / |Ed|, Ed = -{cfg.elasticity_abs} (borrowed textbook short-run value). Phase 1 tested a trained model on {ref['n_events']} events and it did not beat this formula.",
               "backend/PHASE1_SUMMARY.md; phase1_analysis.py"),
            _a(f"Band of ±{cfg.price_band_pp} pp = leave-one-out mean absolute error of the formula on {ref['n_events']} daily-resolution events, all with supply loss up to {vmax:g}% (small sample). It does not apply beyond that.",
               "phase1_analysis.py output: 13.09 pp"),
            _a(f"Exponential decay after the disruption with a {hl:g}-day half-life (default: half the duration, clamped to {cfg.half_life_min_days:g} to {cfg.half_life_max_days:g} days).",
               is_estimate=True),
            _a("Price is assumed to move linearly with supply loss; this is unverified for very large shocks and no nonlinear model or cap is applied.", is_estimate=True),
        ],
    }
    caveats = ce.price_caveats(loss, req["conflict_intensity"], req["demand_change_pct"])
    if outside:
        caveats.insert(0, (
            f"Outside the validated range: this scenario removes {loss:.1f}% of world supply, but the {ref['n_events']} events the formula's error band was "
            f"measured on reach at most {vmax:g}%. The linear formula is extrapolated far beyond that evidence, so treat the price figure as an "
            f"order-of-magnitude illustration; the ±{cfg.price_band_pp:g} pp band understates the real uncertainty here."))
    if sensitivity and len(sensitivity) > 1:
        lo_case = sensitivity[1]
        s_price["summary"] += (f" The blockade result depends on the bypass assumption: with the headline {_mb(sensitivity[0]['bypass_bpd'])} barrels per day of "
                               f"pipeline bypass the price impact is {sensitivity[0]['price_impact_pct']:+.1f}%, with the lower {_mb(lo_case['bypass_bpd'])} case it is "
                               f"{lo_case['price_impact_pct']:+.1f}%.")

    prod_x = [x["x_current_global_production"] for x in horizons]
    s_evs = {
        "title": "EVs required",
        "summary": (
            f"Offsetting {_n(displaced)} barrels per day of lost crude would take about {_mb(evs)} electric cars replacing gasoline cars "
            f"(at a {req['ev_substitution_rate_pct']:g}% substitution rate). Delivered over 1, 3 or 5 years that is "
            f"{_mb(horizons[0]['evs_per_year'])}, {_mb(horizons[1]['evs_per_year'])} or {_mb(horizons[2]['evs_per_year'])} extra EVs per year, "
            f"or {prod_x[0]:.1f}, {prod_x[1]:.1f} and {prod_x[2]:.1f} times the roughly {_mb(cfg.current_global_ev_production_per_year)} electric cars "
            f"produced worldwide in {cfg.current_ev_data_year} (IEA Global EV Outlook 2026)."),
        "takeaway": (f"{_mb(evs)} EVs needed; a {h}-year plan is {prod_x[[x['years'] for x in horizons].index(h)]:.1f}x the {cfg.current_ev_data_year} global EV production."
                     if h in cfg.horizons_years else f"{_mb(evs)} EVs needed."),
        "chart": {"horizons": horizons, "current_global_sales": cfg.current_global_ev_sales_per_year,
                  "current_global_production": cfg.current_global_ev_production_per_year,
                  "current_data_year": cfg.current_ev_data_year, "source": "IEA, Global EV Outlook 2026", "source_url": IEA_GEVO_URL},
        "numbers": {"vehicles_offset": evs},
        "assumptions": [
            _a(f"1 barrel of crude yields {cfg.gasoline_gal_per_bbl} gal of gasoline; one gasoline car burns {cfg.gal_per_vehicle_year:g} gal per year. "
               "500 gal is a US-style figure; the global average is lower, so the true EV count would be higher.", "Project brief", None, True),
            _a("Current EV sales: 'exceed 20 million in 2025'; almost 22 million produced.", "IEA, Global EV Outlook 2026", IEA_GEVO_URL),
            _a("Total EVs are treated as a fleet that must be in place to replace the lost fuel permanently; per-year figures divide that by the horizon.", is_estimate=True),
        ],
    }

    sourced_vs_project = ce.lce_per_ev_sourced(cfg) / cfg.lce_t_per_ev_project
    s_li = {
        "title": "Lithium required",
        "summary": (
            f"Building {_mb(evs)} EVs needs about {_n(cases_li['sourced']['required_t_lce'])} tonnes of lithium carbonate equivalent (LCE) using the sourced battery figure, "
            f"against {_n(cases_li['project']['required_t_lce'])} tonnes using the project's {cfg.lce_t_per_ev_project:g} t per EV assumption, which is about {sourced_vs_project:.1f} times lower. "
            f"Over {h} years the headline case needs {head['pct_of_world_production_per_year']:.0f}% of current world mine production each year ({_n(production_lce)} t LCE in 2025), "
            f"and with {req['lithium_availability_pct']:g}% of that production available the shortfall is {_n(head['deficit_t_lce'])} tonnes LCE. "
            f"Using the larger EU and US pack sizes instead of {cfg.typical_pack_kwh:g} kWh, the requirement ranges from {_n(range_low)} to {_n(range_high)} tonnes LCE."),
        "takeaway": f"Headline ({head_key}): {_n(head['required_t_lce'])} t LCE needed, deficit {_n(head['deficit_t_lce'])} t LCE.",
        "chart": {"cases": cases_li, "headline_case": head_key, "world_production_2025_t_lce": production_lce,
                  "countries": countries, "pack_cases": pack_cases, "range_t_lce": [range_low, range_high],
                  "chemistry_caveat": cfg.chemistry_caveat},
        "numbers": {"headline_case": head_key, "lce_t_per_ev_sourced": ce.lce_per_ev_sourced(cfg), "lce_t_per_ev_project": cfg.lce_t_per_ev_project,
                    "sourced_vs_project_ratio": sourced_vs_project},
        "assumptions": [
            _a(f"Sourced case: NMC-811 cathodes hold about {cfg.li_kg_per_kwh} kg lithium per kWh; {cfg.typical_pack_kwh:g} kWh pack (IEA: BEV packs below 60 kWh in China, close to 70 in the EU, 90 in the US); x{cfg.lce_per_t_li} to convert lithium to LCE.",
               "ICCT (Feb 2024) p.17; IEA GEVO 2026", ICCT_URL),
            _a("Project case 0.008 t LCE per EV (about 8 kg) comes from the project brief and has no source. It looks low against published battery figures.",
               "Project brief", None, True),
            _a(f"World mine production {_n(cfg.world_li_production_t_li)} t lithium content (2025 estimate, excl. US) converted to LCE; reserves {_n(cfg.world_li_reserves_t_li)} t.",
               "USGS Mineral Commodity Summaries 2026", USGS_LITHIUM_URL),
            _a(f"Supply cap = lithium availability % x current world production per year. Default {req['lithium_availability_pct']:g}%: USGS shows 2025 production "
               "(290,000 t Li) above consumption (263,000 t Li) by 27,000 t, about 9% of production, so little output is spare. Real redirectable supply is a scenario input, not a sourced value.",
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
    items = {i["key"]: i for i in macro["items"]}
    inf, out = items["global_inflation_pp"], items["global_output_pct"]
    hard_numbers = [
        {"label": "Barrels displaced per day", "value": displaced, "unit": "bpd"},
        {"label": "Supply loss", "value": loss, "unit": "% of world supply"},
        {"label": "Oil price change implied by the linear formula", "value": price, "unit": "%"},
    ]
    if tonne_mile is not None:
        hard_numbers.append({"label": "Tanker tonne-miles (longer voyages)", "value": tonne_mile, "unit": "% more"})
        hard_numbers.append({"label": "One-time transit gap", "value": gap, "unit": "barrels"})
    s_eco = {
        "title": "Economy and markets (indicative)",
        "summary": (
            f"The linear formula implies a {price:+.1f}% oil price move lasting {format(dur, 'g')} days. Scaling the IMF rule of thumb "
            f"(per +10% oil: about {inf['per_10pct_high']:+.1f} pp of global headline inflation and a {abs(out['per_10pct_high']):.1f} to "
            f"{abs(out['per_10pct_low']):.1f}% fall in global output, if the rise lasts most of a year) to this scenario implies about "
            f"{inf['low']:+.2f} pp of global inflation and {out['low']:+.2f}% to {out['high']:+.2f}% for global output. "
            + (f"Tanker demand in tonne-miles would rise about {tonne_mile:.0f}% because voyages are longer. " if tonne_mile is not None else "")
            + "These are rule-of-thumb illustrations, not forecasts, and the IMF gives inflation as a single figure, so no range is drawn around it."),
        "takeaway": (f"Global inflation about {inf['low']:+.2f} pp and global output {out['low']:+.2f}% to {out['high']:+.2f}% "
                     "(indicative, IMF rule of thumb)."),
        "chart": {
            "items": macro["items"],
            "hard_numbers": hard_numbers,
            "sectors": [
                {"sector": "Airlines", "direction": "negative", "quantified": False, "note": "No sourced coefficient."},
                {"sector": "Tanker shipping rates", "direction": "positive" if tonne_mile else "uncertain", "quantified": tonne_mile is not None,
                 "note": (f"Tonne-mile demand +{tonne_mile:.0f}% (derived: detour days / baseline voyage days); no sourced rate coefficient."
                          if tonne_mile is not None else "Not quantified for a blockade; no sourced coefficient.")},
                {"sector": "Energy equities", "direction": "positive", "quantified": False, "note": "No sourced coefficient."},
            ],
        },
        "numbers": macro,
        "assumptions": [
            *[_a(f"{i['label']}: \"{i['quote']}\"" + (f" Corroboration: {i['corroboration']}" if i["corroboration"] else ""),
                 f"{i['source']} ({i['year']})", i["source_url"]) for i in macro["items"]],
            _a(f"Effects scaled by price move / 10 and by duration / 365 days (scale = {scale:.3f}); the IMF figures assume a shock persisting most of a year, "
               "and give no figure for shorter shocks.", is_estimate=True),
            _a("Not shown: oil-importer-specific (MENAP) and World Bank figures. No primary source could be verified for them, so they are left out rather than guessed.",
               is_estimate=True),
            _a("These effects use the central price estimate and ignore the price uncertainty (and, beyond the validated range, the price itself is an extrapolation).",
               is_estimate=True),
        ],
    }

    return {
        "scenario": {**{k: v for k, v in req.items()}, "baseline_year": int(year), "route_name": route["name"],
                     "detour_days_default": route.get("default_detour_days"),
                     "detour_days_source": "user" if user_detour is not None else "route default"},
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
