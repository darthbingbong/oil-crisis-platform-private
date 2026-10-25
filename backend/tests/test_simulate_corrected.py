"""Regression test for the corrected /api/v1/simulate lithium and supply values (README: Changelog / corrected values).

simulate_before.json is the output BEFORE the fix. Shape and key names must be identical; only the wrong values changed:
  - world supply 101 Mb/d -> 103.3 Mb/d (EIA)            -> barrels_per_day_lost, vehicle-years, lithium tonnes
  - world lithium production 180,000 'LCE' -> 290,000 t Li x 5.323 = 1,543,670 t LCE (USGS) -> lithium_supply_ratio
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from main import app
from services.config import DEFAULT_CONFIG

client = TestClient(app)


@pytest.fixture(autouse=True)
def neutral_lithium_index(monkeypatch):
    """/simulate scales lithium supply by the news pipeline's live lithium_supply_index (about 1.004 right now).
    Pin it to 1.0 so these tests do not depend on database state."""
    from news import price_engine
    real = price_engine.get_state
    monkeypatch.setattr(price_engine, "get_state", lambda: {**real(), "lithium_supply_index": 1.0})


BEFORE = json.loads((Path(__file__).resolve().parent / "snapshots" / "simulate_before.json").read_text(encoding="utf-8"))

# Values are recomputed by hand in corrected(): bpd = 103.3e6 x loss%; vehicle-years = bpd x 19.5 x 365 / 500;
# lithium t = vehicle-years x (t LCE per EV); ratio = lithium t / (290,000 t Li x 5.323 = 1,543,670 t LCE).
# /simulate now uses the SOURCED per-EV case (0.10 kg Li/kWh x 60 kWh x 5.323 = 0.0319 t); the earlier fix's 0.008 t values
# are kept under the *_project_assumption keys, so this file guards both the unit fix and the per-EV switch.
SOURCED_PER_EV = 0.1 * 60 * 5.323 / 1000
PROJECT_PER_EV = 0.008


def corrected(loss, per_ev):
    bpd = 103_300_000 * loss / 100
    veh = bpd * 19.5 * 365 / 500
    li = veh * per_ev
    return bpd, veh, li, li / (290_000 * 5.323)


def test_original_keys_kept_in_order_and_new_keys_are_additive():
    added = {"lce_tonnes_per_ev_used", "lce_tonnes_per_ev_project_assumption",
             "lithium_tonnes_required_project_assumption", "lithium_supply_ratio_project_assumption"}
    for case in BEFORE:
        new = client.post("/api/v1/simulate", json=case["input"]).json()
        old = case["response"]
        assert list(old) == [k for k in new if k in old]                              # top-level: unchanged keys, same order
        old_ev, new_ev = old["ev_feasibility"], new["ev_feasibility"]
        assert list(old_ev) == [k for k in new_ev if k in old_ev]
        assert set(new_ev) - set(old_ev) == added                                      # only the four new keys
        assert new["model_used"] == old["model_used"]
        assert new["predicted_price_change_pct"] == old["predicted_price_change_pct"]  # price formula untouched


@pytest.mark.parametrize("loss", [0.5, 2, 5, 8])
def test_corrected_values(loss):
    e = client.post("/api/v1/simulate", json={"supply_loss_pct": loss, "conflict_intensity": 5}).json()["ev_feasibility"]
    bpd, veh, li, ratio = corrected(loss, SOURCED_PER_EV)
    _, _, li_p, ratio_p = corrected(loss, PROJECT_PER_EV)
    assert e["barrels_per_day_lost"] == pytest.approx(round(bpd), abs=1)
    assert e["gasoline_vehicle_years_displaced"] == pytest.approx(veh, rel=1e-6)
    assert e["lithium_tonnes_required"] == pytest.approx(li, rel=1e-5)
    assert e["lithium_supply_ratio"] == pytest.approx(ratio, abs=0.001)
    # the project's 0.008 case (= the previous fix's values) is still reported, for comparison
    assert e["lithium_tonnes_required_project_assumption"] == pytest.approx(li_p, rel=1e-6)
    assert e["lithium_supply_ratio_project_assumption"] == pytest.approx(ratio_p, abs=0.001)
    assert e["lce_tonnes_per_ev_used"] == pytest.approx(SOURCED_PER_EV, abs=1e-6)
    assert e["lce_tonnes_per_ev_project_assumption"] == PROJECT_PER_EV


def test_the_5x_error_is_gone_and_pinned():
    e = client.post("/api/v1/simulate", json={"supply_loss_pct": 5, "conflict_intensity": 5}).json()["ev_feasibility"]
    assert e["lithium_supply_ratio_project_assumption"] == pytest.approx(0.381, abs=0.001)  # the unit fix (was 3.181)
    assert e["lithium_supply_ratio"] == pytest.approx(1.521, abs=0.002)                      # sourced case: about 4x the 0.008 case
    # 5% of 103.3 Mb/d = 5,165,000 bpd -> 73,523,775 vehicle-years -> x 0.008 = 588,190 t (ratio 0.381); x 0.031938 = 2,348,229 t (ratio 1.521)


def test_oversupply_still_returns_zeros():
    e = client.post("/api/v1/simulate", json={"supply_loss_pct": -3, "conflict_intensity": 5}).json()["ev_feasibility"]
    assert e["barrels_per_day_lost"] == 0 and e["lithium_supply_ratio"] == 0


def test_simulate_and_report_share_one_set_of_constants():
    import ev_lithium
    from services import calc_engine as ce
    assert ev_lithium.DEFAULT_GLOBAL_DAILY_CRUDE_PRODUCTION_BBL == DEFAULT_CONFIG.global_supply_bpd == 103_300_000
    assert ev_lithium.GLOBAL_ANNUAL_LITHIUM_PRODUCTION_TONNES == pytest.approx(ce.world_li_production_lce(DEFAULT_CONFIG))
    assert ev_lithium.LCE_TONNES_PER_EV_BATTERY == pytest.approx(ce.lce_per_ev_sourced(DEFAULT_CONFIG))  # sourced case, as in /simulate/report
    assert ev_lithium.LCE_TONNES_PER_EV_PROJECT == DEFAULT_CONFIG.lce_t_per_ev_project == 0.008
    assert ev_lithium.GASOLINE_YIELD_GAL_PER_BBL == DEFAULT_CONFIG.gasoline_gal_per_bbl
    assert DEFAULT_CONFIG.lce_per_t_li == 5.323


def test_report_and_simulate_agree_on_displaced_barrels_for_the_same_supply_loss():
    sim = client.post("/api/v1/simulate", json={"supply_loss_pct": 5, "conflict_intensity": 5}).json()["ev_feasibility"]
    # same displaced barrels -> same vehicles; report's vehicles use the same constants
    from services import calc_engine as ce
    assert ce.vehicles_offset(sim["barrels_per_day_lost"]) == pytest.approx(sim["gasoline_vehicle_years_displaced"], rel=1e-9)
