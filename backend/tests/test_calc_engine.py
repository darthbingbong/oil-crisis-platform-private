"""Unit tests for services/calc_engine.py. Includes the brief's golden test (synthetic numbers)."""

from dataclasses import replace

import joblib
import pytest

from services import calc_engine as ce
from services.config import DEFAULT_CONFIG

# Golden-test config: synthetic world supply 100 Mb/d and 500 gal/yr/vehicle, as in the brief.
GOLD = replace(DEFAULT_CONFIG, global_supply_bpd=100_000_000.0, gal_per_vehicle_year=500.0)


def test_golden_chain_from_the_brief():
    flow, T, dt = 10_000_000, 20, 20
    assert ce.delivery_factor(T, dt) == pytest.approx(0.5)
    displaced = ce.displaced_bpd_detour(flow, T, dt)
    assert displaced == pytest.approx(5_000_000)
    loss = ce.supply_loss_pct(displaced, GOLD)
    assert loss == pytest.approx(5.0)
    assert ce.price_impact_pct(loss, GOLD) == pytest.approx(33.3333, abs=1e-3)
    evs = ce.vehicles_offset(displaced, 100, GOLD)
    assert evs == pytest.approx(71_175_000)
    assert evs * GOLD.lce_t_per_ev_project == pytest.approx(569_400)
    assert ce.transit_gap_barrels(flow, dt) == pytest.approx(200_000_000)


# ---- edge cases -----------------------------------------------------------
def test_zero_detour_displaces_nothing():
    assert ce.delivery_factor(20, 0) == 1.0
    assert ce.displaced_bpd_detour(10_000_000, 20, 0) == 0.0
    assert ce.transit_gap_barrels(10_000_000, 0) == 0.0


def test_negative_supply_oversupply_gives_price_fall_and_no_evs():
    assert ce.price_impact_pct(-3.0, GOLD) == pytest.approx(-20.0)
    assert ce.vehicles_offset(-1_000_000, 100, GOLD) == 0.0
    pt = ce.price_outlook_point(-20.0, cfg=GOLD)
    assert pt["day"] == 30 and pt["pct"] == -20.0  # one 30-day value, and it is the plain formula


def test_blocked_share_below_bypass_displaces_nothing():
    assert ce.displaced_bpd_blockade(10_000_000, 0.4, 5_000_000) == 0.0  # 4 Mb/d blocked < 5 Mb/d bypass
    assert ce.displaced_bpd_blockade(10_000_000, 1.0, 5_000_000) == 5_000_000


def test_blocked_share_above_bypass():
    assert ce.displaced_bpd_blockade(20_700_000, 1.0, 4_700_000) == 16_000_000
    assert ce.displaced_bpd_blockade(20_700_000, 1.0, 2_600_000) == 18_100_000


def test_lithium_availability_zero_means_full_deficit():
    r = ce.lithium_case(71_175_000, 0.008, availability_pct=0, horizon_years=5, cfg=GOLD)
    assert r["required_t_lce"] == pytest.approx(569_400)
    assert r["supply_cap_over_horizon_t_lce"] == 0
    assert r["deficit_t_lce"] == pytest.approx(569_400)


def test_lithium_full_availability_can_clear_the_deficit():
    r = ce.lithium_case(1_000_000, 0.008, availability_pct=100, horizon_years=5, cfg=DEFAULT_CONFIG)
    assert r["required_t_lce"] == 8_000
    assert r["deficit_t_lce"] == 0.0


def test_invalid_inputs_raise():
    with pytest.raises(ValueError):
        ce.displaced_bpd_blockade(1e7, 1.5, 0)
    with pytest.raises(ValueError):
        ce.delivery_factor(0, 5)
    with pytest.raises(ValueError):
        ce.delivery_factor(20, -1)


def test_fleet_not_constrained_removes_displacement_but_keeps_transit_gap():
    assert ce.displaced_bpd_detour(10_000_000, 20, 20, fleet_constrained=False) == 0.0
    assert ce.transit_gap_barrels(10_000_000, 20) > 0


# ---- other behaviour ------------------------------------------------------
def test_price_outlook_is_one_day_30_value_with_the_band():
    pt = ce.price_outlook_point(33.3, cfg=DEFAULT_CONFIG)
    assert pt["day"] == 30 and pt["pct"] == 33.3                          # the validated number, and nothing before day 30
    assert pt["high"] - pt["pct"] == pytest.approx(13.09) and pt["pct"] - pt["low"] == pytest.approx(13.09)


def test_no_decay_or_half_life_machinery_is_left():
    assert not hasattr(ce, "default_half_life_days") and not hasattr(ce, "price_trajectory") and not hasattr(ce, "price_outlook_path")
    assert not hasattr(DEFAULT_CONFIG, "half_life_min_days") and DEFAULT_CONFIG.price_horizon_days == 30


def test_displaced_series_cumulative_stops_after_duration():
    s = ce.displaced_series(1_000_000, 10, transit_gap=500, cfg=DEFAULT_CONFIG)
    assert [p["day"] for p in s] == list(range(11))                       # M14: the series ends with the disruption the user entered, not at 180 days
    assert s[10]["cumulative_bbl"] == 500 + 10_000_000 and s[0]["cumulative_bbl"] == 500
    assert [p["day"] for p in ce.displaced_series(1_000_000, 7.5, cfg=DEFAULT_CONFIG)][-1] == 8


def test_ev_horizons_per_year_and_ratio():
    h = ce.ev_horizons(60_000_000, DEFAULT_CONFIG)
    assert [x["years"] for x in h] == [1, 3, 5]
    assert h[1]["evs_per_year"] == pytest.approx(20_000_000)
    assert h[1]["x_current_global_sales"] == pytest.approx(1.0)


def test_substitution_rate_scales_evs():
    assert ce.vehicles_offset(5_000_000, 50, GOLD) == pytest.approx(71_175_000 / 2)


def test_sourced_lithium_case_is_about_four_times_the_project_assumption():
    sourced = ce.lce_per_ev_sourced()
    assert sourced == pytest.approx(0.1 * 60 * 5.323 / 1000)  # 0.0319 t LCE
    assert 3.5 < sourced / DEFAULT_CONFIG.lce_t_per_ev_project < 4.5


def test_importer_shortfall_uses_given_shares_only():
    imps = [{"country": "Group A", "iso3": None, "level": "group", "derived": False, "share_of_route_flow_pct": 69},
            {"country": "Group B", "iso3": None, "level": "group", "derived": True, "share_of_route_flow_pct": 31}]
    r = ce.importer_shortfall(1_000_000, imps)
    assert r[0]["shortfall_bpd"] == pytest.approx(690_000) and r[1]["derived"] is True
    assert sum(x["shortfall_bpd"] for x in r) == pytest.approx(1_000_000)
    assert all(x["reserve_cover_days"] is None for x in r)  # not sourced, never invented


def _items(m):
    return {i["key"]: i for i in m["items"]}


def test_macro_effects_use_only_cited_coefficients_and_scale_with_duration():
    full = _items(ce.macro_ranges(10.0, 365))
    assert set(full) == {"global_inflation_pp", "global_output_pct"}          # nothing without a verified source
    assert (full["global_inflation_pp"]["low"], full["global_inflation_pp"]["high"]) == pytest.approx((0.4, 0.4))
    assert (full["global_output_pct"]["low"], full["global_output_pct"]["high"]) == pytest.approx((-0.2, -0.1))
    half = _items(ce.macro_ranges(10.0, 182.5))
    assert half["global_inflation_pp"]["low"] == pytest.approx(0.2)
    assert half["global_output_pct"]["low"] == pytest.approx(-0.1)
    zero = _items(ce.macro_ranges(0.0, 100))
    assert zero["global_inflation_pp"]["high"] == 0.0 and zero["global_output_pct"]["low"] == 0.0


def test_a_single_point_source_stays_a_single_point_and_every_item_is_cited():
    for i in ce.macro_ranges(10.0, 365)["items"]:
        assert i["low"] <= i["high"]
        assert i["is_point"] == (i["per_10pct_low"] == i["per_10pct_high"])
        assert i["source_url"].startswith("https://") and i["year"] >= 2017 and i["quote"]
    inflation = next(i for i in ce.macro_ranges(10.0, 365)["items"] if i["key"] == "global_inflation_pp")
    assert inflation["is_point"] is True and "40 basis point" in inflation["quote"]    # IMF figure, no range invented


def test_tonne_mile_change():
    assert ce.tonne_mile_change_pct(20, 20) == 100.0


def test_caveats_match_main_py_conditions():
    assert ce.price_caveats(5, 5, 0) == []
    assert len(ce.price_caveats(1, 8, 0)) == 1
    assert len(ce.price_caveats(1, 8, 10)) == 2


def test_config_elasticity_matches_phase1_artifact():
    baseline = joblib.load("data/price_surge_baseline.joblib")
    assert DEFAULT_CONFIG.elasticity_abs == baseline["elasticity"]
