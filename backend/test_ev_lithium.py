"""
Unit tests for ev_lithium.py, run independently of the API layer.

Run with:  pytest test_ev_lithium.py -v
"""

import pytest

from ev_lithium import (
    ANNUAL_FUEL_GAL_PER_VEHICLE,
    GASOLINE_YIELD_GAL_PER_BBL,
    LCE_TONNES_PER_EV_BATTERY,
    barrels_to_gasoline_gallons,
    crude_barrels_to_ev_equivalent,
    gasoline_gallons_to_vehicle_years,
    supply_shock_to_ev_feasibility,
    vehicles_to_lithium_tonnes,
)


# ---------------------------------------------------------------------------
# Single-step conversions -- verify the exact conversion factors
# ---------------------------------------------------------------------------

def test_barrels_to_gasoline_gallons_single_barrel():
    assert barrels_to_gasoline_gallons(1) == GASOLINE_YIELD_GAL_PER_BBL == 19.5


def test_barrels_to_gasoline_gallons_scales_linearly():
    assert barrels_to_gasoline_gallons(1_000_000) == 19_500_000.0


def test_barrels_to_gasoline_gallons_zero():
    assert barrels_to_gasoline_gallons(0) == 0.0


def test_gasoline_gallons_to_vehicle_years_one_vehicle_year():
    assert gasoline_gallons_to_vehicle_years(ANNUAL_FUEL_GAL_PER_VEHICLE) == 1.0


def test_gasoline_gallons_to_vehicle_years_scales():
    assert gasoline_gallons_to_vehicle_years(5000) == pytest.approx(10.0)


def test_vehicles_to_lithium_tonnes_single_vehicle():
    assert vehicles_to_lithium_tonnes(1) == LCE_TONNES_PER_EV_BATTERY == 0.008


def test_vehicles_to_lithium_tonnes_thousand_vehicles():
    assert vehicles_to_lithium_tonnes(1000) == pytest.approx(8.0)


# ---------------------------------------------------------------------------
# Composed conversion: crude_barrels_to_ev_equivalent
# ---------------------------------------------------------------------------

def test_crude_barrels_to_ev_equivalent_chains_correctly():
    result = crude_barrels_to_ev_equivalent(barrels_per_day=1000, days=1)
    assert result.barrels_total == 1000
    assert result.gasoline_gallons_total == pytest.approx(1000 * 19.5)
    assert result.gasoline_vehicle_years_displaced == pytest.approx((1000 * 19.5) / 500)
    assert result.lithium_tonnes_required == pytest.approx(
        ((1000 * 19.5) / 500) * 0.008
    )


def test_crude_barrels_to_ev_equivalent_zero_barrels():
    result = crude_barrels_to_ev_equivalent(barrels_per_day=0, days=365)
    assert result.barrels_total == 0
    assert result.gasoline_gallons_total == 0
    assert result.gasoline_vehicle_years_displaced == 0
    assert result.lithium_tonnes_required == 0


def test_crude_barrels_to_ev_equivalent_over_a_year():
    result = crude_barrels_to_ev_equivalent(barrels_per_day=100_000, days=365)
    assert result.barrels_total == pytest.approx(36_500_000)
    assert result.gasoline_gallons_total == pytest.approx(36_500_000 * 19.5)


# ---------------------------------------------------------------------------
# supply_shock_to_ev_feasibility -- the function that ties into the
# /simulate endpoint's supply_loss_pct field
# ---------------------------------------------------------------------------

def test_supply_shock_zero_loss_returns_all_zero():
    result = supply_shock_to_ev_feasibility(supply_loss_pct=0)
    assert result.barrels_per_day_lost == 0
    assert result.equivalent.lithium_tonnes_required == 0
    assert "no supply loss" in result.explanation.lower()


def test_supply_shock_negative_loss_is_treated_as_no_op():
    """Negative supply_loss_pct means a surplus -- not a meaningful EV question."""
    result = supply_shock_to_ev_feasibility(supply_loss_pct=-5)
    assert result.barrels_per_day_lost == 0
    assert result.equivalent.lithium_tonnes_required == 0


def test_supply_shock_known_inputs_produce_expected_barrels_per_day():
    result = supply_shock_to_ev_feasibility(
        supply_loss_pct=5,
        global_daily_production_bbl=100_000_000,
        horizon_days=365,
    )
    assert result.barrels_per_day_lost == pytest.approx(5_000_000)
    expected_barrels_total = 5_000_000 * 365
    assert result.equivalent.barrels_total == pytest.approx(expected_barrels_total)


def test_supply_shock_explanation_mentions_key_numbers():
    result = supply_shock_to_ev_feasibility(
        supply_loss_pct=5,
        global_daily_production_bbl=100_000_000,
        horizon_days=365,
    )
    assert "5.0%" in result.explanation
    assert "lithium" in result.explanation.lower()


def test_supply_shock_default_global_production_is_positive():
    """Sanity check: the default global production assumption is a real,
    positive number so callers who don't override it don't silently get 0."""
    result = supply_shock_to_ev_feasibility(supply_loss_pct=1)
    assert result.barrels_per_day_lost > 0
    assert result.equivalent.lithium_tonnes_required > 0


def test_supply_shock_lithium_ratio_zero_when_no_loss():
    result = supply_shock_to_ev_feasibility(supply_loss_pct=0)
    assert result.lithium_supply_ratio == 0.0


def test_supply_shock_lithium_ratio_exceeds_world_supply_at_crisis_scale():
    """CORRECTED (see README changelog): world lithium production is now in true LCE
    (290,000 t Li x 5.323 = 1.54 Mt LCE), so a 5% shock needs about 37% of a year's output
    (it showed 3.2x before the unit fix). Exceeding a full year now takes roughly a 14%+ shock."""
    five = supply_shock_to_ev_feasibility(supply_loss_pct=5)
    assert 0.3 < five.lithium_supply_ratio < 0.45
    big = supply_shock_to_ev_feasibility(supply_loss_pct=15)
    assert big.lithium_supply_ratio > 1
    assert "x the world's entire annual lithium production" in big.explanation


def test_supply_shock_lithium_ratio_under_world_supply_for_small_shock():
    result = supply_shock_to_ev_feasibility(
        supply_loss_pct=0.1,
        global_daily_production_bbl=100_000_000,
    )
    assert 0 < result.lithium_supply_ratio < 1
    assert "% of the world's annual lithium production" in result.explanation
