"""Watchlist, labelled sample, freshness rule and snapshot. Hand-written fixtures, mock transport: nothing here calls the provider."""
import json

import httpx
import pytest

from services import ais_watchlist as wl
from services import shipfinder as sf
from tests.test_shipfinder import Clock, Provider, make

NOW = 1_800_000_000


def row(mmsi, ship_type=80, length=180, sog=0.0, last_age=120, name=None, **kw):
    base = {"mmsi": mmsi, "imo": 9_000_000 + mmsi % 1000, "call_sign": "CS", "ship_name": name or f"VESSEL {mmsi}", "data_source": 0, "last_time": NOW - last_age,
            "lat": 37.0, "lng": -6.9, "ship_type": ship_type, "length": length, "width": 30, "draught": 10.5, "dest": "ROTTERDAM ", "destcode": "NLRTM", "eta": 0,
            "navistat": 0, "sog": sog, "cog": 90.0, "hdg": 511, "rot": 0}
    base.update(kw)
    return base


SAMPLE = {"status": 0, "msg": "", "total": 12, "data": [
    row(538007007, 80, 274, 0.1, name="FRONT ALTAIR"),     # Marshall Islands
    row(636000001, 81, 250, 11.0),                          # Liberia, underway
    row(215000001, 89, 120, 0.0),                           # Malta
    row(210000001, 83, 95, 6.0),                            # Cyprus
    row(256000001, 80, 183, 0.0),                           # Malta (same flag as 215)
    row(248000001, 84, 330, 12.0),
    row(225000001, 85, 60, 0.0),
    row(311000001, 88, 200, 0.2),
    row(311000002, 80, 205, 9.0),
    row(477000001, 70, 190, 0.0),                           # cargo: never a tanker
    row(219000001, 36, 15, 5.0),                            # sailing
    row(205000001, 0, 0, 0.0),                              # unknown type
]}


# ------------------------------------------------------------------ the pick
def test_only_provider_typed_tankers_are_picked_and_at_most_eight():
    picked = wl.pick_watchlist(SAMPLE["data"])
    assert 1 <= len(picked) <= 8 and all(80 <= r["ship_type"] <= 89 for r in picked)
    assert {r["mmsi"] for r in picked}.isdisjoint({477000001, 219000001, 205000001})
    assert len(wl.pick_watchlist(SAMPLE["data"], n=3)) == 3


def test_the_pick_prefers_variety_in_flag_size_and_motion():
    picked = wl.pick_watchlist(SAMPLE["data"], n=4)
    flags = {wl.ais_feed.flag_from_mmsi(r["mmsi"]) or str(r["mmsi"])[:3] for r in picked}
    sizes = {wl.size_bucket(r["length"]) for r in picked}
    motion = {wl.moving(r) for r in picked}
    assert len(flags) == 4 and len(sizes) >= 3 and motion == {True, False}


def test_the_pick_is_deterministic_and_deduplicates_by_mmsi():
    rows = SAMPLE["data"] + [dict(SAMPLE["data"][0])]
    a = wl.pick_watchlist(rows)
    assert [r["mmsi"] for r in a] == [r["mmsi"] for r in wl.pick_watchlist(list(reversed(rows)))]      # input order does not matter
    assert len({r["mmsi"] for r in a}) == len(a)


def test_no_tankers_gives_an_empty_watchlist():
    assert wl.pick_watchlist([row(1, 70), row(2, 36)]) == []


# ------------------------------------------------------------------ cleaning sentinels
def test_provider_sentinels_become_none_and_nothing_is_invented():
    v = wl.clean_vessel(row(538007007, sog=-1, cog=-1, hdg=511, navistat=255, draught=0, dest="  ", imo=0, eta=0, length=0), NOW)
    assert v["sog_kn"] is None and v["cog_deg"] is None and v["heading_deg"] is None and v["nav_status"] == "not reported" and v["nav_status_code"] is None
    assert v["draught_m"] is None and v["destination"] is None and v["imo"] is None and v["eta"] is None and v["length_m"] is None


def test_real_values_survive_and_age_is_computed_from_the_fetch_time():
    v = wl.clean_vessel(row(538007007, sog=0.0, navistat=1, last_age=600, dest="SINGAPORE, SG "), NOW)
    assert v["sog_kn"] == 0.0 and v["nav_status"] == "at anchor" and v["destination"] == "SINGAPORE, SG" and v["position_age_s"] == 600
    assert v["last_seen_utc"] == wl.utc_iso(NOW - 600) and v["source"] == "terrestrial AIS"


def test_navistat_15_is_not_reported():
    assert wl.clean_vessel(row(1, navistat=15), NOW)["nav_status"] == "not reported"


# ------------------------------------------------------------------ the freshness rule
@pytest.mark.parametrize("pos_age,fetch_age,state", [(60, 30, "LIVE"), (599, 119, "LIVE"), (601, 30, "DELAYED"), (3601, 30, "STALE"), (60, 121, "SNAPSHOT"),
                                                      (60, 86400, "SNAPSHOT"), (None, 10, "SNAPSHOT")])
def test_vessel_is_live_only_after_a_fresh_fetch_with_a_young_position(pos_age, fetch_age, state):
    assert wl.classify_vessel(pos_age, fetch_age) == state


def test_layer_is_live_only_when_the_median_position_age_is_under_ten_minutes_and_the_fetch_is_recent():
    assert wl.classify_layer([30, 60, 90, 4000], 60) == "LIVE"             # median 75 s even though one vessel is old
    assert wl.classify_layer([700, 800, 900], 60) == "DELAYED"
    assert wl.classify_layer([30, 60, 90], 300) == "SNAPSHOT"              # last fetch more than two poll intervals ago
    assert wl.classify_layer([], 10) == "SNAPSHOT"


# ------------------------------------------------------------------ exactly one Nearby call
def held_client(tmp_path, provider):
    c, p, clock = make(tmp_path, provider)
    c.set_hold("vessels_nearby", "owner rule")
    return c, p, clock


def test_nearby_sample_makes_exactly_one_call_saves_the_raw_response_and_restores_the_hold(tmp_path):
    c, p, clock = held_client(tmp_path, Provider([SAMPLE]))
    body = wl.capture_nearby_sample(c, 538007007, raw_dir=tmp_path / "raw")
    assert body["total"] == 12 and len(p.requests) == 1 and dict(p.requests[0].url.params)["mmsi"] == "538007007"
    saved = list((tmp_path / "raw").glob("nearby_538007007_*.json"))
    assert len(saved) == 1 and json.loads(saved[0].read_text(encoding="utf-8"))["response"]["total"] == 12
    assert "key" not in json.loads(saved[0].read_text(encoding="utf-8"))["params"]
    clock.advance(60)
    with pytest.raises(sf.AISError) as e:
        c.call("vessels_nearby", {"mmsi": 1}, "again")                       # the hold is back: a second call is refused locally
    assert e.value.kind == "on_hold" and len(p.requests) == 1


@pytest.mark.parametrize("reply", [{"status": 38, "msg": "The number of queries exceeded"}, httpx.ConnectTimeout("slow"), httpx.Response(200, text="<html>"), {"status": 21, "msg": "x"}])
def test_a_failed_nearby_sample_keeps_hold_and_breaker_and_is_not_retried(tmp_path, reply):
    c, p, clock = held_client(tmp_path, Provider([reply]))
    with pytest.raises(sf.AISError):
        wl.capture_nearby_sample(c, 538007007, raw_dir=tmp_path / "raw")
    b = c.budget()["vessels_nearby"]
    assert b["hold"] and b["breaker"] == "open" and len(p.requests) == 1
    clock.advance(10_000)
    with pytest.raises(sf.AISError) as e:
        c.call("vessels_nearby", {"mmsi": 1}, "t")                          # long after the back-off, the manual hold still refuses
    assert e.value.kind == "on_hold"


# ------------------------------------------------------------------ positions: hard ceiling, first error
def position_reply(mmsi):
    return {"status": 0, "msg": "", "data": row(mmsi, last_age=30)}


def test_positions_stop_at_the_hard_ceiling_of_14_calls(tmp_path):
    mmsis = list(range(300_000_001, 300_000_021))
    c, p, clock = make(tmp_path, Provider([position_reply(m) for m in mmsis]))
    got, why = wl.fetch_positions(c, mmsis, raw_dir=tmp_path / "raw", sleep=clock.advance)
    assert len(p.requests) == 14 and len(got) == 14 and "ceiling of 14" in why
    assert c.budget()["vessel_position"]["used"] == 14 and c.budget()["vessel_position"]["left"] == 36


def test_positions_count_calls_from_earlier_runs(tmp_path):
    c, p, clock = make(tmp_path, Provider([position_reply(m) for m in range(30)]))
    wl.fetch_positions(c, list(range(100_000_001, 100_000_009)), raw_dir=tmp_path / "raw", sleep=clock.advance)       # 8 calls
    got, why = wl.fetch_positions(c, list(range(200_000_001, 200_000_011)), raw_dir=tmp_path / "raw", sleep=clock.advance)
    assert len(p.requests) == 14 and len(got) == 6 and "ceiling" in why


def test_positions_stop_at_the_first_error_without_retry(tmp_path):
    c, p, clock = make(tmp_path, Provider([position_reply(1), {"status": 23, "msg": "frequency"}, position_reply(3)]))
    got, why = wl.fetch_positions(c, [1, 2, 3], raw_dir=tmp_path / "raw", sleep=clock.advance)
    assert list(got) == [1] and "first error" in why and len(p.requests) == 2


def test_flags_stop_at_the_first_error(tmp_path):
    c, p, clock = make(tmp_path, Provider([{"status": 0, "msg": "", "data": {"mmsi": 1, "registry": "Liberia"}}, {"status": 38, "msg": "x"}]))
    got, why = wl.fetch_flags(c, [1, 2, 3], raw_dir=tmp_path / "raw", sleep=clock.advance)
    assert got == {1: "Liberia"} and "first error" in why and len(p.requests) == 2


# ------------------------------------------------------------------ the snapshot
def test_snapshot_labels_the_sample_and_never_claims_coverage_or_cargo(tmp_path):
    picked = wl.pick_watchlist(SAMPLE["data"], n=3)
    positions = {picked[0]["mmsi"]: row(picked[0]["mmsi"], last_age=45, lat=37.05, lng=-6.95)}
    snap = wl.build_snapshot(SAMPLE, 538007007, NOW, picked, positions, NOW + 90, {picked[0]["mmsi"]: "Marshall Islands"}, ["note"], {"vessel_position": {"used": 1}})
    s = snap["sample"]
    assert s["label"] == f"vessels within 10 nm of FRONT ALTAIR, seen at {wl.utc_iso(NOW)[11:16]} UTC" and s["radius_nm"] == 10
    assert s["returned"] == 12 and s["tankers_typed_by_provider"] == 9 and "NOT coverage of a chokepoint" in s["caveat"]
    w = snap["watchlist"]
    assert len(w) == 3 and all(v["cargo_note"] == "cargo type not confirmed by AIS" and v["state_when_captured"] == "SNAPSHOT" for v in w)
    assert w[0]["position_confirmed_by"] == "Vessel Position" and w[0]["lat"] == 37.05 and w[0]["flag_registry"] == "Marshall Islands" and w[0]["position_age_s"] == 135
    assert w[1]["position_confirmed_by"] == "Vessels Nearby sample only"
    text = json.dumps(snap).lower()
    assert "crude carrier" not in text and "sanction" not in text and "dark fleet" not in text
    p = wl.save_snapshot(snap, tmp_path / "snap" / "watchlist.json")
    assert wl.load_watchlist(p)["sample"]["seed"]["mmsi"] == 538007007 and wl.load_watchlist(tmp_path / "nope.json") is None
