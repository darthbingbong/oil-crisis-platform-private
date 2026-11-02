"""Endpoint tests: the /routes/{id} superset regression against the pre-change snapshots, and /simulate/report.

The snapshots in tests/snapshots/*_before.json were saved from the ORIGINAL GET /api/v1/routes/{chokepoint}
before any change. Every old key must still be present with an identical value and type.
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)
SNAP = Path(__file__).resolve().parent / "snapshots"

# M10: voyage lengths are ShipFinder planned distances (data/ais_route_plans.json) at 14 kn, not hand-waypoint sums. Expected values are derived from the stored
# distances, and pinned below so the change from v1.0 (Suez 21.2 -> 19.5 days, default detour 12.7 -> 14.0 days) is on record.
_PLANS = json.loads((Path(__file__).resolve().parent.parent / "data" / "ais_route_plans.json").read_text(encoding="utf-8"))["plans"]
SUEZ_T = round(_PLANS["ras_tanura_rotterdam_suez"]["distance_nm"] / 336, 1)
DEFAULT_DETOUR = round((_PLANS["ras_tanura_rotterdam_cape"]["distance_nm"] - _PLANS["ras_tanura_rotterdam_suez"]["distance_nm"]) / 336, 1)
assert (SUEZ_T, DEFAULT_DETOUR) == (19.5, 14.0)

# (url path exactly as a client could send it, snapshot file)
LEGACY_CALLS = [
    ("/api/v1/routes/hormuz", "routes_hormuz_before.json"),
    ("/api/v1/routes/suez", "routes_suez_before.json"),
    ("/api/v1/routes/malacca", "routes_malacca_before.json"),
    ("/api/v1/routes/bab%20el-mandeb", "routes_bab_el_mandeb_before.json"),      # URL-encoded space, as a browser sends it
    ("/api/v1/routes/bab%20el%2Dmandeb", "routes_bab_el_mandeb_before.json"),    # fully encoded hyphen
    ("/api/v1/routes/bab el-mandeb", "routes_bab_el_mandeb_before.json"),        # raw space (client encodes it)
]


def _same(old, new, path=""):
    assert type(old) is type(new), f"{path}: type {type(old).__name__} -> {type(new).__name__}"
    if isinstance(old, dict):
        assert list(old) == [k for k in new if k in old], f"{path}: key order/presence changed"
        for k in old:
            _same(old[k], new[k], f"{path}.{k}")
    elif isinstance(old, list):
        assert len(old) == len(new), f"{path}: length {len(old)} -> {len(new)}"
        for i, (a, b) in enumerate(zip(old, new)):
            _same(a, b, f"{path}[{i}]")
    else:
        assert old == new, f"{path}: {old!r} -> {new!r}"


@pytest.mark.parametrize("url,snapshot", LEGACY_CALLS)
def test_routes_id_is_a_superset_of_the_original_response(url, snapshot):
    old = json.loads((SNAP / snapshot).read_text(encoding="utf-8"))
    r = client.get(url)
    assert r.status_code == 200, r.text
    new = r.json()
    _same(old, new)                                   # every old key, same value, same type
    added = set(new) - set(old)
    assert {"id", "name", "type", "path", "annual_flow_bpd", "bypass_capacity_bpd", "source", "source_url",
            "data_year", "is_estimate", "if_closed_displaced_bpd"} <= added, "new stats missing"


@pytest.mark.parametrize("url,snapshot", [(u, s) for u, s in LEGACY_CALLS if "%2D" not in u and " " not in u])
def test_clean_bypass_path_returns_exactly_the_original_payload(url, snapshot):
    old = json.loads((SNAP / snapshot).read_text(encoding="utf-8"))
    r = client.get(url + "/bypass")
    assert r.status_code == 200
    assert r.json() == old


def test_new_style_ids_return_the_same_old_data():
    old = json.loads((SNAP / "routes_bab_el_mandeb_before.json").read_text(encoding="utf-8"))
    new = client.get("/api/v1/routes/bab_el_mandeb").json()
    for k in old:
        if k in ("chokepoint", "explanation"):
            continue  # these echo the path text the caller used ('bab_el_mandeb' vs 'bab el-mandeb')
        assert new[k] == old[k], k
    assert new["chokepoint"] == "bab el-mandeb"  # id form is mapped to the old name


def test_case_insensitive_like_the_original():
    assert client.get("/api/v1/routes/HORMUZ").status_code == 200
    assert client.get("/api/v1/routes/Hormuz").json()["chokepoint"] == "Hormuz"  # original echoed the path value


def test_unknown_route_keeps_the_original_404_message():
    r = client.get("/api/v1/routes/bogus")
    assert r.status_code == 404
    assert r.json() == {"detail": "Unknown chokepoint 'bogus'. Known: ['bab el-mandeb', 'hormuz', 'malacca', 'suez']"}


def test_new_routes_without_legacy_data_still_resolve():
    r = client.get("/api/v1/routes/turkish_straits")
    assert r.status_code == 200 and r.json()["id"] == "turkish_straits" and "bypass_options" not in r.json()
    assert client.get("/api/v1/routes/turkish_straits/bypass").status_code == 404


def test_pipeline_detail_says_nameplate_capacity_not_flow():
    j = client.get("/api/v1/routes/east_west").json()
    assert j["annual_flow_bpd"] is None and j["capacity_bpd"] == 5_000_000 and j["capacity_label"] == "nameplate capacity"
    assert j["if_closed_displaced_bpd"] is None


def test_hormuz_detail_has_headline_and_low_bypass_if_closed_stats():
    j = client.get("/api/v1/routes/hormuz").json()
    assert j["if_closed_displaced_bpd"] == 20_700_000 - 4_700_000
    assert j["if_closed_displaced_low_bypass_bpd"] == 20_700_000 - 2_600_000
    assert "closed since early 2026" in j["current_conditions"]["note"]


def test_route_list():
    j = client.get("/api/v1/routes").json()
    assert len(j["routes"]) == 14 and "ILLUSTRATIVE" in j["path_disclaimer"]
    assert all("path" in r for r in j["routes"])


def test_existing_endpoints_unchanged():
    r = client.post("/api/v1/simulate", json={"supply_loss_pct": 5, "conflict_intensity": 6})
    assert r.status_code == 200 and r.json()["predicted_price_change_pct"] == 33.33
    assert client.post("/api/v1/simulate", json={"supply_loss_pct": 50, "conflict_intensity": 6}).status_code == 422
    assert client.get("/api/v1/conflicts").status_code == 200
    assert client.get("/api/v1/refineries/at-risk/hormuz").json()["capacity_at_risk_bpd"] == 6_190_000.0


# ---------------------------------------------------------------------------
# /simulate/report
# ---------------------------------------------------------------------------
def post(**body):
    return client.post("/api/v1/simulate/report", json=body)


def test_report_hormuz_blockade_headline_and_sensitivity():
    r = post(route_id="hormuz", disruption_type="blockade", blocked_share_pct=100, duration_days=30)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["kpis"]["displaced_bpd"] == 16_000_000
    assert j["kpis"]["price_impact_pct"] == pytest.approx(16_000_000 / 103_300_000 * 100 / 0.15)
    assert j["baseline"]["year"] == 2024 and j["baseline"]["label"] == "Baseline year 2024"
    sens = j["sections"]["price"]["sensitivity"]
    assert [round(s["bypass_bpd"]) for s in sens] == [4_700_000, 2_600_000]
    assert sens[1]["price_impact_pct"] > sens[0]["price_impact_pct"]
    assert "depends on the bypass assumption" in j["sections"]["price"]["summary"]
    assert "closed since early 2026" in j["current_conditions"]["note"]
    assert set(j["sections"]) == {"barrels", "price", "evs", "lithium", "importers", "economy"}


def test_report_suez_detour_defaults_to_2023_baseline_and_derived_detour():
    j = post(route_id="suez", disruption_type="detour", duration_days=60).json()
    assert j["baseline"]["year"] == 2023 and j["baseline"]["flow_bpd"] == 8_800_000
    assert j["scenario"]["detour_days"] == pytest.approx(DEFAULT_DETOUR)
    T = j["sections"]["barrels"]["numbers"]["baseline_voyage_days"]
    assert T == pytest.approx(SUEZ_T)
    assert j["kpis"]["displaced_bpd"] == pytest.approx(8_800_000 * (1 - T / (T + DEFAULT_DETOUR)))


def test_report_baseline_year_override_shows_red_sea_depression():
    j = post(route_id="suez", disruption_type="detour", detour_days=20, baseline_year=2024).json()
    assert j["baseline"]["flow_bpd"] == 4_800_000 and j["baseline"]["depressed_by_red_sea"] is True


def test_report_lithium_shows_both_cases_with_sourced_as_headline():
    j = post(route_id="hormuz", duration_days=30).json()
    li = j["sections"]["lithium"]["chart"]
    assert li["headline_case"] == "sourced"
    ratio = li["cases"]["sourced"]["required_t_lce"] / li["cases"]["project"]["required_t_lce"]
    assert 3.5 < ratio < 4.5
    assert j["kpis"]["extra_lithium_t_lce"] == li["cases"]["sourced"]["required_t_lce"]


def test_report_lithium_availability_zero_gives_full_deficit():
    j = post(route_id="hormuz", lithium_availability_pct=0).json()
    c = j["sections"]["lithium"]["chart"]["cases"]["sourced"]
    assert c["deficit_t_lce"] == pytest.approx(c["required_t_lce"])


def test_report_importers_are_group_level_and_flag_derived():
    j = post(route_id="hormuz").json()
    imps = j["sections"]["importers"]["chart"]
    assert imps["label"] == "by region/group"
    assert [i["derived"] for i in imps["importers"]] == [False, True, True]
    assert sum(i["shortfall_bpd"] for i in imps["importers"]) == pytest.approx(j["kpis"]["displaced_bpd"])
    assert all(i["reserve_cover_days"] is None for i in imps["importers"])


def test_report_route_without_importer_data_does_not_invent_any():
    j = post(route_id="malacca", duration_days=10).json()  # only China is sourced; others absent
    assert [i["iso3"] for i in j["sections"]["importers"]["chart"]["importers"]] == ["CHN"]
    j2 = post(route_id="danish_straits", disruption_type="detour", detour_days=5).json()
    assert j2["sections"]["importers"]["chart"]["importers"] == []
    assert "No sourced importer breakdown" in j2["sections"]["importers"]["summary"]


def test_report_economy_shows_only_cited_coefficients_plus_hard_numbers():
    j = post(route_id="hormuz", duration_days=365).json()
    eco = j["sections"]["economy"]["chart"]
    assert {i["key"] for i in eco["items"]} == {"global_inflation_pp", "global_output_pct"}
    for i in eco["items"]:
        assert i["source_url"].startswith("https://www.imf.org/") and i["year"] and i["quote"]   # exact figure's source, year, link
    output = next(i for i in eco["items"] if i["key"] == "global_output_pct")
    assert output["low"] < output["high"]                                                     # IMF gave a range for output
    assert any(s["quantified"] is False and "No sourced coefficient" in s["note"] for s in eco["sectors"])
    assert {h["label"] for h in eco["hard_numbers"]} >= {"Barrels displaced per day", "Supply loss"}


def test_report_economy_never_uses_the_unverified_figures():
    j = post(route_id="hormuz", duration_days=365).json()
    text = json.dumps(j["sections"]["economy"])
    assert "World Bank PRWP" not in text.replace("Not shown", "") .split("assumptions")[0]    # not in any figure or summary
    assert "MENAP" not in j["sections"]["economy"]["summary"] and "importer" not in j["sections"]["economy"]["takeaway"].lower()


def test_cape_lane_is_rejected_as_not_a_route_you_would_disrupt():
    for body in (dict(route_id="cape_good_hope"), dict(route_id="cape_good_hope", disruption_type="detour", detour_days=5)):
        r = post(**body)
        assert r.status_code == 422 and "alternate lane" in r.json()["detail"]


def test_report_records_the_users_detour_days_next_to_the_route_default():
    user = post(route_id="suez", disruption_type="detour", detour_days=20).json()["scenario"]
    assert user["detour_days"] == 20 and user["detour_days_source"] == "user" and user["detour_days_default"] == pytest.approx(DEFAULT_DETOUR)
    dflt = post(route_id="suez", disruption_type="detour").json()["scenario"]
    assert dflt["detour_days"] == pytest.approx(DEFAULT_DETOUR) and dflt["detour_days_source"] == "route default"


def test_report_ev_section_compares_with_sourced_production_and_year():
    c = post(route_id="suez", disruption_type="detour", detour_days=20).json()["sections"]["evs"]
    assert c["chart"]["current_data_year"] == 2025 and c["chart"]["current_global_production"] == 22_000_000
    assert "2025" in c["summary"] and "IEA" in c["summary"] and "produced worldwide" in c["summary"]


def test_report_is_deterministic():
    body = dict(route_id="hormuz", duration_days=45, blocked_share_pct=60)
    assert post(**body).json() == post(**body).json()


def test_report_blockade_fully_covered_by_bypass_displaces_nothing():
    j = post(route_id="suez", blocked_share_pct=20).json()   # 1.76 Mb/d blocked < 2.5 Mb/d SUMED
    assert j["kpis"]["displaced_bpd"] == 0 and j["kpis"]["evs_required"] == 0 and j["kpis"]["lithium_deficit_t_lce"] == 0


def test_report_summary_numbers_match_the_numbers():
    j = post(route_id="hormuz", duration_days=30).json()
    assert f"{j['kpis']['displaced_bpd']:,.0f}" in j["sections"]["barrels"]["summary"]


def test_report_rejects_druzhba_pipelines_and_bad_input():
    assert post(route_id="druzhba").status_code == 422
    r = post(route_id="east_west")
    assert r.status_code == 422 and "nameplate capacity only" in r.json()["detail"]
    assert post(route_id="nope").status_code == 404
    assert post(route_id="hormuz", blocked_share_pct=150).status_code == 422
    assert post(route_id="danish_straits", disruption_type="detour", detour_days=0).status_code == 200
    assert post(route_id="cape_good_hope", disruption_type="detour", detour_days=5).status_code == 422  # no baseline voyage


def test_report_warns_when_outside_the_validated_range():
    j = post(route_id="hormuz").json()   # ~15.5% supply loss vs 8% max in the 21 events
    assert j["validated_supply_loss_max_pct"] == 8.0
    assert j["caveats"][0].startswith("Outside the validated range")
    small = post(route_id="suez", disruption_type="detour", detour_days=5).json()
    assert not any(c.startswith("Outside") for c in small["caveats"])


def test_report_default_lithium_availability_is_10_pct_and_produces_a_deficit_for_a_big_shock():
    j = post(route_id="hormuz").json()
    assert j["scenario"]["lithium_availability_pct"] == 10
    assert j["kpis"]["lithium_deficit_t_lce"] > 0


# ---------------------------------------------------------------------------
# Extreme scenarios: outside the validated range
# ---------------------------------------------------------------------------
def test_validated_reference_is_the_2026_iran_event_with_its_actual_move():
    j = post(route_id="hormuz").json()
    ref = j["validated_reference"]
    assert ref["supply_loss_pct"] == 8.0 and "2026" in ref["name"]
    assert ref["actual_price_move_pct"] == pytest.approx(57.76, abs=0.05)  # matches phase1_analysis.py output
    assert "ROUGH ESTIMATE" in ref["note"]


def test_band_hidden_and_flagged_outside_validated_range():
    j = post(route_id="hormuz").json()                      # ~15.5% supply loss
    p = j["sections"]["price"]
    assert j["kpis"]["outside_validated_range"] is True and j["kpis"]["price_band_pp"] is None
    assert "Outside the validated range" in j["kpis"]["validated_note"]
    assert p["chart"]["band_validated"] is False
    assert all(pt["low"] is None and pt["high"] is None for pt in p["chart"]["trajectory"])
    assert any(pt["beyond_validated"] for pt in p["chart"]["trajectory"])
    assert p["chart"]["validated_price_ceiling_pct"] == pytest.approx(8 / 0.15)
    assert "not validated at this magnitude" in p["summary"] and "is not shown" in p["summary"]


def test_band_shown_inside_validated_range():
    j = post(route_id="suez", disruption_type="detour", detour_days=5, duration_days=30).json()
    assert j["kpis"]["outside_validated_range"] is False and j["kpis"]["price_band_pp"] == 13.09
    traj = j["sections"]["price"]["chart"]["trajectory"]
    assert all(pt["low"] is not None for pt in traj) and not any(pt["beyond_validated"] for pt in traj)


def test_beyond_validated_flag_follows_the_decay_back_inside_the_range():
    traj = post(route_id="hormuz", duration_days=30).json()["sections"]["price"]["chart"]["trajectory"]
    assert traj[0]["beyond_validated"] and not traj[-1]["beyond_validated"]   # decays below the 53.3% ceiling by day 180


def test_summaries_say_implies_never_will():
    for body in (dict(route_id="hormuz"), dict(route_id="suez", disruption_type="detour", detour_days=5)):
        j = post(**body).json()
        text = " ".join(s["summary"] + " " + s["takeaway"] for s in j["sections"].values())
        assert "implies" in j["sections"]["price"]["summary"]
        assert "the price will" not in text.lower() and "prices will" not in text.lower()


def test_lithium_range_uses_other_iea_pack_sizes_and_states_the_chemistry_caveat():
    j = post(route_id="hormuz").json()
    c = j["sections"]["lithium"]["chart"]
    assert [x["pack_kwh"] for x in c["pack_cases"]] == [60, 70, 90]
    low, high = c["range_t_lce"]
    assert low == c["cases"]["sourced"]["required_t_lce"] and high / low == pytest.approx(90 / 60)
    assert j["kpis"]["extra_lithium_range_t_lce"] == [low, high]
    assert "NMC-811" in c["chemistry_caveat"] and "LFP" in c["chemistry_caveat"]
    # the caveat now lives beside the availability control (chart payload), not repeated inside the 2-4 sentence summary
    assert f"{low:,.0f} to {high:,.0f}" in j["sections"]["lithium"]["summary"]


def test_conflicts_default_is_only_the_real_historical_record():
    rows = client.get("/api/v1/conflicts").json()
    assert len(rows) == 24 and not any("[SIMULATED" in r["name"] for r in rows)
    with_sim = client.get("/api/v1/conflicts?include_simulated=true").json()
    assert len(with_sim) >= 24 and all(r["name"] in {x["name"] for x in with_sim} for r in rows)


# ---------------------------------------------------------------------------
# /health
# ---------------------------------------------------------------------------
def test_health_reports_each_feed_and_never_a_key(monkeypatch):
    monkeypatch.delenv("EIA_API_KEY", raising=False)
    monkeypatch.delenv("AISSTREAM_API_KEY", raising=False)
    from services import price_feed
    monkeypatch.setattr(price_feed, "_service", None, raising=False)
    j = client.get("/api/v1/health").json()
    assert set(j["feeds"]) == {"price", "news", "ais"} and j["overall"] in ("ok", "degraded", "fallback")
    assert j["feeds"]["price"]["state"] in ("ok", "fallback") and j["feeds"]["price"]["status"] in ("DAILY_CLOSE", "OFFLINE_FALLBACK", None)
    assert j["feeds"]["ais"]["state"] == "fallback" and j["feeds"]["ais"]["verified_against_live_feed"] is False
    assert j["feeds"]["news"]["state"] in ("ok", "degraded", "unknown")
    from services import news_feed
    assert j["feeds"]["news"]["snapshot_routes"] == len(news_feed.load_snapshot()["routes"]) == 4
    assert "LIVE" not in str(j).replace("UNVERIFIED against the live feed", "").replace("live quote", "").replace("live feed", "")
    monkeypatch.setenv("AISSTREAM_API_KEY", "health-test-secret-value-123")        # a configured key must never appear in the health output
    assert "health-test-secret-value-123" not in str(client.get("/api/v1/health").json())
