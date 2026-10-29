"""Scenario calculation engine: pure functions, no I/O, every constant comes from CalcConfig.

Chain:  route flow -> barrels displaced/day -> supply loss % -> price impact % (Phase 1 formula)
        -> vehicles to offset -> lithium (LCE) -> importer shortfall -> indicative macro ranges.
"""

from dataclasses import replace  # noqa: F401  (re-exported for tests that override config)
from math import floor, log10

from .config import DEFAULT_CONFIG, CalcConfig


# ---------------------------------------------------------------------------
# 1. Barrels displaced per day
# ---------------------------------------------------------------------------
def displaced_bpd_blockade(route_flow_bpd: float, blocked_share: float, bypass_capacity_bpd: float) -> float:
    """max(0, flow x blocked_share - bypass). blocked_share is a fraction 0..1."""
    if not 0 <= blocked_share <= 1:
        raise ValueError("blocked_share must be between 0 and 1")
    return max(0.0, route_flow_bpd * blocked_share - max(0.0, bypass_capacity_bpd))


def delivery_factor(baseline_voyage_days: float, detour_days: float) -> float:
    """With a fixed tanker fleet, delivery rate scales by T / (T + dt)."""
    if baseline_voyage_days <= 0:
        raise ValueError("baseline_voyage_days must be positive")
    if detour_days < 0:
        raise ValueError("detour_days cannot be negative")
    return baseline_voyage_days / (baseline_voyage_days + detour_days)


def displaced_bpd_detour(route_flow_bpd: float, baseline_voyage_days: float, detour_days: float,
                         fleet_constrained: bool = True) -> float:
    """flow x (1 - T/(T+dt)) when the fleet is fixed (worst case); 0 if the fleet can expand."""
    if not fleet_constrained:
        return 0.0
    return route_flow_bpd * (1.0 - delivery_factor(baseline_voyage_days, detour_days))


def transit_gap_barrels(route_flow_bpd: float, detour_days: float) -> float:
    """One-time barrels missing while the longer pipeline-of-ships refills: flow x dt."""
    return route_flow_bpd * detour_days


# ---------------------------------------------------------------------------
# 2-3. Supply loss and price
# ---------------------------------------------------------------------------
def supply_loss_pct(displaced_bpd: float, cfg: CalcConfig = DEFAULT_CONFIG) -> float:
    return displaced_bpd / cfg.global_supply_bpd * 100.0


def price_impact_pct(supply_loss: float, cfg: CalcConfig = DEFAULT_CONFIG) -> float:
    """Validated Phase 1 formula: %dP = %dS / |Ed|. Negative supply loss (oversupply) gives a price fall."""
    return supply_loss / cfg.elasticity_abs


def default_half_life_days(duration_days: float, cfg: CalcConfig = DEFAULT_CONFIG) -> float:
    return min(cfg.half_life_max_days, max(cfg.half_life_min_days, duration_days / 2.0))


def price_trajectory(peak_pct: float, duration_days: float, half_life_days: float | None = None,
                     cfg: CalcConfig = DEFAULT_CONFIG) -> list[dict]:
    """Daily price change vs baseline for day 0..trajectory_days.

    Held at the peak while the disruption lasts, then exponential decay toward baseline with the
    given half-life (ASSUMPTION). Band is +/- price_band_pp (Phase 1 leave-one-out MAE), constant in pp.
    """
    hl = half_life_days if half_life_days is not None else default_half_life_days(duration_days, cfg)
    if hl <= 0:
        raise ValueError("half_life_days must be positive")
    out = []
    for day in range(cfg.trajectory_days + 1):
        pct = peak_pct if day <= duration_days else peak_pct * 0.5 ** ((day - duration_days) / hl)
        out.append({"day": day, "pct": pct, "low": pct - cfg.price_band_pp, "high": pct + cfg.price_band_pp})
    return out


def displaced_series(displaced_bpd: float, duration_days: float, transit_gap: float = 0.0,
                     cfg: CalcConfig = DEFAULT_CONFIG) -> list[dict]:
    """Daily and cumulative barrels displaced, day 0..trajectory_days (supply restored after the duration)."""
    out, cum = [], transit_gap
    for day in range(cfg.trajectory_days + 1):
        daily = displaced_bpd if 0 < day <= duration_days else 0.0
        cum += daily
        out.append({"day": day, "daily_bbl": daily, "cumulative_bbl": cum})
    return out


# ---------------------------------------------------------------------------
# 4. EVs required
# ---------------------------------------------------------------------------
def vehicles_offset(displaced_bpd: float, substitution_rate_pct: float = 100.0,
                    cfg: CalcConfig = DEFAULT_CONFIG) -> float:
    """Gasoline cars whose fuel equals the displaced barrels: bpd x 19.5 gal x 365 / gal-per-vehicle-year.

    Zero (not negative) when nothing is displaced. substitution_rate_pct = share of that demand EVs replace.
    """
    if displaced_bpd <= 0:
        return 0.0
    full = displaced_bpd * cfg.gasoline_gal_per_bbl * 365.0 / cfg.gal_per_vehicle_year
    return full * substitution_rate_pct / 100.0


def ev_horizons(evs_total: float, cfg: CalcConfig = DEFAULT_CONFIG) -> list[dict]:
    """Total EVs and EVs per year over each horizon, against today's global EV sales."""
    return [{
        "years": h,
        "total_evs": evs_total,
        "evs_per_year": evs_total / h,
        "x_current_global_sales": evs_total / h / cfg.current_global_ev_sales_per_year,
        "x_current_global_production": evs_total / h / cfg.current_global_ev_production_per_year,
    } for h in cfg.horizons_years]


# ---------------------------------------------------------------------------
# 5. Lithium
# ---------------------------------------------------------------------------
def lce_per_ev_sourced(cfg: CalcConfig = DEFAULT_CONFIG) -> float:
    """t LCE per EV = kg Li/kWh x kWh x 5.323 / 1000."""
    return cfg.li_kg_per_kwh * cfg.typical_pack_kwh * cfg.lce_per_t_li / 1000.0


def world_li_production_lce(cfg: CalcConfig = DEFAULT_CONFIG) -> float:
    return cfg.world_li_production_t_li * cfg.lce_per_t_li


def lithium_case(evs: float, lce_t_per_ev: float, availability_pct: float, horizon_years: float,
                 cfg: CalcConfig = DEFAULT_CONFIG) -> dict:
    """Lithium needed for `evs` vehicles, vs a supply cap.

    Cap per year = availability_pct % of current world mine production (in LCE). Over a horizon of h
    years the cap is cap_per_year x h. deficit = max(0, required - cap x h).
    """
    required = evs * lce_t_per_ev
    production = world_li_production_lce(cfg)
    cap_per_year = production * availability_pct / 100.0
    return {
        "lce_t_per_ev": lce_t_per_ev,
        "required_t_lce": required,
        "required_per_year_t_lce": required / horizon_years,
        "pct_of_world_production_per_year": required / horizon_years / production * 100.0,
        "pct_of_world_reserves": required / (cfg.world_li_reserves_t_li * cfg.lce_per_t_li) * 100.0,
        "supply_cap_per_year_t_lce": cap_per_year,
        "supply_cap_over_horizon_t_lce": cap_per_year * horizon_years,
        "deficit_t_lce": max(0.0, required - cap_per_year * horizon_years),
        "horizon_years": horizon_years,
    }


# ---------------------------------------------------------------------------
# 6. Importer shortfall
# ---------------------------------------------------------------------------
def importer_shortfall(displaced_bpd: float, importers: list[dict]) -> list[dict]:
    """Allocate displaced barrels by each importer group's share of route flow. Shares are used as given
    (group-level, some derived); nothing is invented. Reserve cover is not sourced, so it is None."""
    return [{
        "name": i["country"], "iso3": i.get("iso3"), "level": i.get("level", "group"),
        "derived": bool(i.get("derived", False)), "share_of_route_flow_pct": i["share_of_route_flow_pct"],
        "shortfall_bpd": displaced_bpd * i["share_of_route_flow_pct"] / 100.0,
        "reserve_cover_days": None,
    } for i in importers]


# ---------------------------------------------------------------------------
# 7. Economy and markets (indicative ranges only)
# ---------------------------------------------------------------------------
def macro_ranges(price_impact: float, duration_days: float, cfg: CalcConfig = DEFAULT_CONFIG) -> dict:
    """Indicative effects from the CITED coefficients in config (cfg.macro_coefficients), nothing else.

    Each coefficient is "effect of a +10% oil price rise, if it lasts most of a year". Effects scale with the price move per 10% and
    with how much of a year the shock lasts (ASSUMPTION, labelled). A coefficient the source gives as a single point stays a
    single point (is_point=True); no range is invented around it. Returns {'scale_vs_10pct_year', 'items': [...]} where each item
    carries the source, year, link and quoted sentence so the page can cite it."""
    scale = price_impact / 10.0 * min(duration_days, cfg.macro_full_effect_days) / cfg.macro_full_effect_days
    items = []
    for c in cfg.macro_coefficients:
        a, b = c.low * scale, c.high * scale
        items.append({
            "key": c.key, "label": c.label, "unit": c.unit,
            "low": min(a, b), "high": max(a, b), "is_point": c.low == c.high,
            "per_10pct_low": c.low, "per_10pct_high": c.high,
            "source": c.source, "source_url": c.source_url, "year": c.year, "quote": c.quote, "corroboration": c.corroboration,
        })
    return {"scale_vs_10pct_year": scale, "items": items}


def tonne_mile_change_pct(baseline_voyage_days: float, detour_days: float) -> float:
    """Detour raises tanker demand: tonne-miles scale with voyage length, +dt/T. Derived, not a macro coefficient."""
    return detour_days / baseline_voyage_days * 100.0


# ---------------------------------------------------------------------------
# Caveats carried over from main.py's /simulate
# ---------------------------------------------------------------------------
def price_caveats(supply_loss: float, conflict_intensity: float, demand_change_pct: float) -> list[str]:
    notes = []
    if demand_change_pct != 0:
        notes.append(
            f"This scenario also involves a {demand_change_pct:.1f}% demand change. Phase 1 testing found demand-driven "
            "events (like 2020 COVID or 2008) behave differently from pure supply shocks, and this formula does not yet "
            "account for that, so treat the price estimate as less reliable when demand_change_pct is far from zero.")
    if conflict_intensity >= 7 and supply_loss < 2:
        notes.append(
            f"Conflict intensity is high ({conflict_intensity:g}) but modeled supply loss is low. Historically (e.g. the "
            "2025 Israel-Iran war) this pattern produces a real but short-lived price spike that fades once markets "
            "confirm no physical disruption occurred.")
    return notes


def round_sig(x: float, sig: int = 3) -> float:
    """Round to `sig` significant figures for summary text (never used for the numbers themselves)."""
    if x == 0:
        return 0.0
    return round(x, sig - 1 - floor(log10(abs(x))))
