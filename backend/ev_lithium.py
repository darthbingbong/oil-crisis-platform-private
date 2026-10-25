"""
EV / lithium conversion module.

Deterministic unit conversion, not a trained model -- no ML here on
purpose. Answers: "if a crisis knocks out X barrels/day of crude, how
does that translate into gasoline displaced, gasoline-vehicle-years of
fuel, and how much lithium (as LCE, lithium carbonate equivalent) would
be needed to build enough EV batteries to replace that many vehicles?"

All conversion factors are the ones specified in the project brief.
They are averages / rules of thumb, not certified constants -- flagged
inline where a number is an assumption rather than a physical fact.
"""

from dataclasses import dataclass

# ---------------------------------------------------------------------------
# Conversion constants -- ONE source of truth: services/config.py (DEFAULT_CONFIG).
# The names below are kept as read-only aliases so existing imports and tests keep
# working; no value is defined here. See config.py for each value's source/assumption.
# ---------------------------------------------------------------------------
from services.config import DEFAULT_CONFIG as _CFG

GALLONS_PER_BARREL = 42.0  # physical fact: a barrel of crude is 42 US gallons

GASOLINE_YIELD_GAL_PER_BBL = _CFG.gasoline_gal_per_bbl
ANNUAL_FUEL_GAL_PER_VEHICLE = _CFG.gal_per_vehicle_year

# Project assumption (0.008 t LCE per EV). /simulate keeps using this one; the sourced case
# (_CFG.li_kg_per_kwh x typical_pack_kwh x lce_per_t_li) is the headline of /simulate/report.
LCE_TONNES_PER_EV_BATTERY = _CFG.lce_t_per_ev_project

# World supply: EIA 103.3 Mb/d (2024). Was 101 Mb/d, an unsourced assumption.
DEFAULT_GLOBAL_DAILY_CRUDE_PRODUCTION_BBL = _CFG.global_supply_bpd

# World lithium production in tonnes of LCE. USGS reports lithium CONTENT (290,000 t Li, 2025 est.),
# so it is converted with 5.323. CORRECTED: this was 180,000 t labelled "LCE", which was lithium
# content, so the supply ratio was about 5.3x too high.
GLOBAL_ANNUAL_LITHIUM_PRODUCTION_TONNES = _CFG.world_li_production_t_li * _CFG.lce_per_t_li


# ---------------------------------------------------------------------------
# Pure conversion functions -- each does exactly one unit conversion,
# so each can be tested and trusted independently.
# ---------------------------------------------------------------------------

def barrels_to_gasoline_gallons(barrels: float) -> float:
    """Crude oil barrels -> gallons of gasoline actually refined from them."""
    return barrels * GASOLINE_YIELD_GAL_PER_BBL


def gasoline_gallons_to_vehicle_years(gallons: float) -> float:
    """Gallons of gasoline -> how many vehicle-years of driving that fuels."""
    return gallons / ANNUAL_FUEL_GAL_PER_VEHICLE


def vehicles_to_lithium_tonnes(vehicle_count: float) -> float:
    """Number of EV batteries needed -> tonnes of lithium (as LCE) required."""
    return vehicle_count * LCE_TONNES_PER_EV_BATTERY


# ---------------------------------------------------------------------------
# Composed conversions
# ---------------------------------------------------------------------------

@dataclass
class EvEquivalent:
    barrels_total: float
    gasoline_gallons_total: float
    gasoline_vehicle_years_displaced: float
    lithium_tonnes_required: float


def crude_barrels_to_ev_equivalent(barrels_per_day: float, days: float = 365.0) -> EvEquivalent:
    """
    Chain the three unit conversions over a time period: barrels/day lost,
    for `days` days, -> total gasoline displaced -> gasoline-vehicle-years
    displaced -> tonnes of lithium needed to replace that many vehicles
    with EVs for the same period.
    """
    barrels_total = barrels_per_day * days
    gasoline_gallons_total = barrels_to_gasoline_gallons(barrels_total)
    vehicle_years = gasoline_gallons_to_vehicle_years(gasoline_gallons_total)
    lithium_tonnes = vehicles_to_lithium_tonnes(vehicle_years)
    return EvEquivalent(
        barrels_total=barrels_total,
        gasoline_gallons_total=gasoline_gallons_total,
        gasoline_vehicle_years_displaced=vehicle_years,
        lithium_tonnes_required=lithium_tonnes,
    )


@dataclass
class SupplyShockEvFeasibility:
    supply_loss_pct: float
    barrels_per_day_lost: float
    horizon_days: float
    equivalent: EvEquivalent
    lithium_supply_ratio: float
    explanation: str


def supply_shock_to_ev_feasibility(
    supply_loss_pct: float,
    global_daily_production_bbl: float = DEFAULT_GLOBAL_DAILY_CRUDE_PRODUCTION_BBL,
    horizon_days: float = 365.0,
    lithium_supply_index: float = 1.0,
) -> SupplyShockEvFeasibility:
    """
    Ties a crisis scenario's supply_loss_pct (same field the /simulate
    endpoint takes) to an EV/lithium feasibility picture: how many
    gasoline-vehicle-years of fuel does this crisis's lost supply
    represent, and how much lithium would it take to replace that many
    vehicles with EVs instead, over `horizon_days`.

    lithium_supply_index: a multiplier on GLOBAL_ANNUAL_LITHIUM_PRODUCTION_
    TONNES, 1.0 = the baseline assumption above, unchanged. This is the
    news pipeline's seam into this module (see main.py's /api/v1/simulate
    and news/price_engine.py): an ev_lithium_supply news event nudges this
    index the same way a chokepoint_disruption event nudges the simulated
    crude price, independently -- <1.0 means tighter real-world lithium
    supply than the baseline assumption (worse feasibility, higher ratio),
    >1.0 means easier supply (better feasibility, lower ratio). Defaults to
    1.0 so every existing caller/test is unaffected.

    supply_loss_pct <= 0 means no supply was lost (a surplus, or no
    scenario) -- returned as an all-zero, no-op result rather than a
    negative "supply gain" feasibility, since that's not a meaningful
    EV-substitution question.
    """
    if supply_loss_pct <= 0:
        zero = EvEquivalent(0.0, 0.0, 0.0, 0.0)
        return SupplyShockEvFeasibility(
            supply_loss_pct=supply_loss_pct,
            barrels_per_day_lost=0.0,
            horizon_days=horizon_days,
            equivalent=zero,
            lithium_supply_ratio=0.0,
            explanation="No supply loss in this scenario, so there's no oil demand for EVs to displace.",
        )

    barrels_per_day_lost = global_daily_production_bbl * (supply_loss_pct / 100.0)
    equivalent = crude_barrels_to_ev_equivalent(barrels_per_day_lost, horizon_days)

    years = horizon_days / 365.0
    lithium_available_over_horizon = GLOBAL_ANNUAL_LITHIUM_PRODUCTION_TONNES * lithium_supply_index * years
    lithium_supply_ratio = equivalent.lithium_tonnes_required / lithium_available_over_horizon

    if lithium_supply_ratio >= 1:
        lithium_clause = (
            f"{lithium_supply_ratio:.1f}x the world's entire annual lithium production, "
            f"so full EV substitution isn't realistic within a single year at this scale."
        )
    else:
        lithium_clause = f"about {lithium_supply_ratio * 100:.1f}% of the world's annual lithium production."

    index_note = ""
    if abs(lithium_supply_index - 1.0) > 0.01:
        direction = "tighter" if lithium_supply_index < 1.0 else "easier"
        index_note = (
            f" (adjusted for SIMULATED current lithium supply conditions, {direction} than baseline "
            f"due to recent classified news -- index {lithium_supply_index:.2f}, 1.00 = baseline)"
        )

    explanation = (
        f"A {supply_loss_pct:.1f}% loss of global crude supply removes about "
        f"{barrels_per_day_lost:,.0f} barrels/day. Over {years:.1f} year(s), that's "
        f"{equivalent.gasoline_gallons_total:,.0f} gallons of gasoline that won't get "
        f"refined -- roughly the annual fuel needs of {equivalent.gasoline_vehicle_years_displaced:,.0f} "
        f"gasoline vehicles. Replacing that many vehicles with EVs instead would need about "
        f"{equivalent.lithium_tonnes_required:,.0f} tonnes of lithium (as LCE) -- {lithium_clause}{index_note}"
    )

    return SupplyShockEvFeasibility(
        supply_loss_pct=supply_loss_pct,
        barrels_per_day_lost=barrels_per_day_lost,
        horizon_days=horizon_days,
        equivalent=equivalent,
        lithium_supply_ratio=lithium_supply_ratio,
        explanation=explanation,
    )
