"""Regression test for switching /api/v1/simulate to the SOURCED per-EV lithium case (0.0319 t LCE per EV).

simulate_before_sourced_switch.json is the output immediately BEFORE the switch (news lithium index pinned to 1.0).
Required: every old key kept in place with the same type; only lithium values change; the project's 0.008 t case is
still reported under additive keys and reproduces the old values exactly.
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)
BEFORE = json.loads((Path(__file__).resolve().parent / "snapshots" / "simulate_before_sourced_switch.json").read_text(encoding="utf-8"))
RATIO = (0.1 * 60 * 5.323 / 1000) / 0.008   # sourced / project per-EV figure, about 3.99


@pytest.fixture(autouse=True)
def neutral_lithium_index(monkeypatch):
    from news import price_engine
    real = price_engine.get_state
    monkeypatch.setattr(price_engine, "get_state", lambda: {**real(), "lithium_supply_index": 1.0})


def _new(case):
    return client.post("/api/v1/simulate", json=case["input"]).json()


def test_old_keys_kept_same_order_and_types_new_keys_additive():
    for case in BEFORE:
        old, new = case["response"], _new(case)
        assert list(old) == [k for k in new if k in old]
        for k, v in old["ev_feasibility"].items():
            assert type(new["ev_feasibility"][k]) is type(v), k
        assert set(new["ev_feasibility"]) - set(old["ev_feasibility"]) == {
            "lce_tonnes_per_ev_used", "lce_tonnes_per_ev_project_assumption",
            "lithium_tonnes_required_project_assumption", "lithium_supply_ratio_project_assumption"}


def test_unchanged_values_stay_identical():
    for case in BEFORE:
        old, new = case["response"], _new(case)
        assert new["predicted_price_change_pct"] == old["predicted_price_change_pct"]
        for k in ("barrels_per_day_lost", "gasoline_vehicle_years_displaced"):
            assert new["ev_feasibility"][k] == old["ev_feasibility"][k], k


def test_sourced_values_are_about_four_times_the_old_ones():
    for case in BEFORE:
        old = case["response"]["ev_feasibility"]
        new = _new(case)["ev_feasibility"]
        if old["lithium_tonnes_required"] == 0:
            assert new["lithium_tonnes_required"] == 0 and new["lithium_supply_ratio"] == 0
            continue
        assert new["lithium_tonnes_required"] == pytest.approx(old["lithium_tonnes_required"] * RATIO, rel=2e-4)
        assert new["lithium_supply_ratio"] == pytest.approx(old["lithium_supply_ratio"] * RATIO, rel=2e-3)


def test_project_assumption_keys_reproduce_the_old_values_exactly():
    for case in BEFORE:
        old = case["response"]["ev_feasibility"]
        new = _new(case)["ev_feasibility"]
        assert new["lithium_tonnes_required_project_assumption"] == old["lithium_tonnes_required"]
        assert new["lithium_supply_ratio_project_assumption"] == old["lithium_supply_ratio"]
        assert new["lce_tonnes_per_ev_project_assumption"] == 0.008


def test_simulate_and_report_now_agree_on_lithium_for_the_same_displacement():
    from services import calc_engine as ce
    sim = client.post("/api/v1/simulate", json={"supply_loss_pct": 5, "conflict_intensity": 5}).json()["ev_feasibility"]
    evs = ce.vehicles_offset(sim["barrels_per_day_lost"])
    assert sim["lithium_tonnes_required"] == pytest.approx(evs * ce.lce_per_ev_sourced(), rel=1e-6)
    assert sim["lce_tonnes_per_ev_used"] == pytest.approx(ce.lce_per_ev_sourced(), abs=1e-6)


def test_explanation_states_its_basis():
    e = client.post("/api/v1/simulate", json={"supply_loss_pct": 5, "conflict_intensity": 5}).json()["ev_feasibility"]
    assert "0.0319 t LCE per EV" in e["explanation"] and "0.008" in e["explanation"]
