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


def test_positions_stop_at_the_hard_ceiling_of_23_calls(tmp_path):
    assert wl.POSITION_CALL_CEILING == 23 and wl.POSITION_ABSOLUTE_LIMIT == 23
    mmsis = list(range(300_000_001, 300_000_025))
    c, p, clock = make(tmp_path, Provider([position_reply(m) for m in mmsis]))
    got, why = wl.fetch_positions(c, mmsis, raw_dir=tmp_path / "raw", sleep=clock.advance)
    assert len(p.requests) == 23 and len(got) == 23 and "ceiling of 23" in why
    assert c.budget()["vessel_position"]["used"] == 23 and c.budget()["vessel_position"]["left"] == 27


def test_no_caller_can_push_positions_past_the_absolute_limit_of_23(tmp_path):
    mmsis = list(range(400_000_001, 400_000_030))
    c, p, clock = make(tmp_path, Provider([position_reply(m) for m in mmsis]))
    got, why = wl.fetch_positions(c, mmsis, raw_dir=tmp_path / "raw", ceiling=50, sleep=clock.advance)     # even asking for 50
    assert len(p.requests) == 23 and "ceiling of 23" in why


def test_positions_count_calls_from_earlier_runs(tmp_path):
    c, p, clock = make(tmp_path, Provider([position_reply(m) for m in range(30)]))
    wl.fetch_positions(c, list(range(100_000_001, 100_000_009)), raw_dir=tmp_path / "raw", sleep=clock.advance)       # 8 calls
    got, why = wl.fetch_positions(c, list(range(200_000_001, 200_000_021)), raw_dir=tmp_path / "raw", sleep=clock.advance)
    assert len(p.requests) == 23 and len(got) == 15 and "ceiling" in why


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


# ------------------------------------------------------------------ tracks: thinning, record, one call, saved copy survives the key
import math


def synthetic_track(n=3000, t0=1_793_000_000):
    """A voyage: out along a gentle arc, a loop, then a long straight leg, one point every 60 s."""
    pts = []
    for i in range(n):
        f = i / n
        lat = 36.0 + 2.0 * f + 0.2 * math.sin(f * 12)
        lng = -8.0 + 3.0 * f
        pts.append({"data_source": 0, "utc": t0 + 60 * i, "lng": lng, "lat": lat, "sog": 12.0 if f < 0.9 else 0.0, "cog": 45.0})
    return pts


def test_downsampling_keeps_the_ends_the_order_and_the_length_of_the_route():
    pts = synthetic_track()
    thin = wl.downsample_track(pts, 300)
    assert len(thin) <= 300 and thin[0] == pts[0] and thin[-1] == pts[-1]
    assert [p["utc"] for p in thin] == sorted(p["utc"] for p in thin)
    full = sum(wl._nm(a, b) for a, b in zip(pts, pts[1:]))
    short = sum(wl._nm(a, b) for a, b in zip(thin, thin[1:]))
    assert abs(full - short) / full < 0.02


def test_a_short_track_is_not_thinned():
    pts = synthetic_track(50)
    assert wl.downsample_track(pts, 500) == pts


def saved_raw(points, mmsi=224543980, retrieved="20261103T161033Z", now=1_793_722_232, window=7 * 86400):
    return {"service": "vessel_track", "params": {"mmsi": mmsi, "start_time": now - window, "end_time": now, "output": 1}, "retrieved_at_utc": retrieved,
            "response": {"status": 0, "msg": "", "data": points}}


def test_track_record_is_labelled_with_its_fetch_time_and_carries_honest_stats():
    rec = wl.build_track_record(saved_raw(synthetic_track()), "OIZMENDI", "Spain")
    assert rec["label"] == "past track, fetched at 2026-11-03 16:10 UTC" and rec["kind"] == "PAST TRACK"
    assert rec["points_provider"] == 3000 and rec["points_stored"] <= wl.TRACK_MAX_POINTS and rec["points"][0][2] < rec["points"][-1][2]
    assert rec["path_nm"] > rec["start_to_end_nm"] > 0 and rec["max_sog_kn"] == 12.0 and 80 <= rec["moving_share_pct"] <= 95
    assert rec["window_utc"][0] < rec["window_utc"][1] and "not a surveyed route" in rec["note"]
    assert rec["name"] == "OIZMENDI" and rec["flag"] == "Spain"


def test_track_record_ignores_unusable_points_and_refuses_an_empty_track():
    junk = [{"utc": 1, "lat": None, "lng": 2}, {"utc": "x", "lat": 1, "lng": 2}, {"lat": 1, "lng": 2}]
    with pytest.raises(ValueError):
        wl.build_track_record(saved_raw(junk), None)
    rec = wl.build_track_record(saved_raw(junk + synthetic_track(10)), None)
    assert rec["points_provider"] == 10


def test_fetch_track_makes_one_call_with_a_seven_day_window_and_saves_the_raw_response(tmp_path):
    c, p, clock = make(tmp_path, Provider([{"status": 0, "msg": "", "data": synthetic_track(20)}]))
    body = wl.fetch_track(c, 224543980, 1_793_722_232, raw_dir=tmp_path / "raw")
    q = dict(p.requests[0].url.params)
    assert len(body["data"]) == 20 and len(p.requests) == 1 and p.requests[0].url.path == "/v1/History/VesselHistoryTrack"
    assert int(q["end_time"]) - int(q["start_time"]) == 7 * 86400 and q["mmsi"] == "224543980" and q["output"] == "1"
    saved = list((tmp_path / "raw").glob("track_224543980_*.json"))
    assert len(saved) == 1 and "key" not in json.loads(saved[0].read_text(encoding="utf-8"))["params"]
    assert c.budget()["vessel_track"]["used"] == 1 and c.budget()["vessel_track"]["left"] == 9


@pytest.mark.parametrize("reply", [{"status": 28, "msg": "Track query time exceeds limit"}, httpx.ConnectTimeout("slow"), httpx.Response(200, text="oops")])
def test_a_failed_track_call_stops_and_is_not_retried(tmp_path, reply):
    c, p, clock = make(tmp_path, Provider([reply]))
    with pytest.raises(sf.AISError):
        wl.fetch_track(c, 224543980, 1_793_722_232, raw_dir=tmp_path / "raw")
    assert len(p.requests) == 1 and c.budget()["vessel_track"]["breaker"] == "open" and not list((tmp_path / "raw").glob("*"))


def test_the_saved_track_is_served_from_disk_with_no_provider_and_no_key(tmp_path, monkeypatch):
    """After 2026-11-13 the panel reads this file: no key, kill switch on, provider unreachable, and it still returns the track with its date."""
    rec = wl.build_track_record(saved_raw(synthetic_track(200)), "OIZMENDI", "Spain")
    path = wl.save_tracks([rec], tmp_path / "tracks.json")
    monkeypatch.setenv("AIS_ENABLED", "0")
    monkeypatch.delenv("AIS_API_KEY", raising=False)
    got = wl.load_track(224543980, path)
    assert got["label"].startswith("past track, fetched at 2026-11-03") and len(got["points"]) == 200
    assert wl.load_track(1, path) is None and wl.load_track(224543980, tmp_path / "missing.json") is None
    (tmp_path / "broken.json").write_text("{not json", encoding="utf-8")
    assert wl.load_track(224543980, tmp_path / "broken.json") is None            # never an error


# ------------------------------------------------------------------ second sample for location variety
def base_snapshot():
    picked = wl.pick_watchlist(SAMPLE["data"], n=3)
    return wl.build_snapshot(SAMPLE, 538007007, NOW, picked, {}, None, {}, [], {})


MALACCA_SAMPLE = {"status": 0, "msg": "", "total": 9, "data": [
    row(538007985, 80, 278, 0.1, name="SINGAPORE ENERGY", lat=2.34, lng=101.96),
    row(563000001, 81, 240, 12.0, lat=2.40, lng=101.90), row(477000009, 83, 180, 0.0, lat=2.30, lng=102.00), row(565000003, 80, 110, 7.0, lat=2.35, lng=101.97),
    row(525000004, 89, 90, 0.0, lat=2.33, lng=101.99), row(412000005, 70, 200, 11.0), row(431000006, 36, 20, 4.0)]}


def test_location_sample_adds_the_seed_and_up_to_three_tankers_with_honest_provenance():
    snap = base_snapshot()
    seed_pos = {**row(538007985, 80, 278, 0.1, name="SINGAPORE ENERGY", lat=2.34, lng=101.96, last_age=120), "_fetched_at": NOW + 600}
    wl.add_location_sample(snap, MALACCA_SAMPLE, 538007985, NOW + 1200, seed_pos, "Strait of Malacca")
    assert len(snap["watchlist"]) == 3 + 4                                            # the seed plus 3 chosen tankers
    new = [v for v in snap["watchlist"] if v["area"] == "Strait of Malacca"]
    assert new[0]["mmsi"] == 538007985 and new[0]["position_confirmed_by"] == "Vessel Position"
    assert all(v["position_confirmed_by"] == "Vessels Nearby sample only" for v in new[1:])
    assert all(80 <= v["ship_type"] <= 89 for v in new) and {v["mmsi"] for v in new}.isdisjoint({412000005, 431000006})
    assert all(v["area"] == wl.HUELVA_AREA for v in snap["watchlist"][:3])
    extra = snap["extra_samples"][0]
    assert extra["label"] == f"vessels within 10 nm of SINGAPORE ENERGY, seen at {wl.utc_iso(NOW + 1200)[11:16]} UTC" and extra["returned"] == 7 and "NOT coverage" in extra["caveat"]
    assert "Not chokepoint traffic" in snap["watchlist_label"] and "Huelva" in snap["watchlist_label"]
    assert all(v["state_when_captured"] == "SNAPSHOT" and v["cargo_note"] == "cargo type not confirmed by AIS" for v in new)


def test_a_seed_that_is_not_a_tanker_is_not_added_but_its_sample_still_is():
    snap = base_snapshot()
    wl.add_location_sample(snap, MALACCA_SAMPLE, 412000005, NOW + 1200, {**row(412000005, 70), "_fetched_at": NOW}, "Strait of Malacca")
    assert 412000005 not in {v["mmsi"] for v in snap["watchlist"]} and len(snap["extra_samples"]) == 1


def test_nearby_calls_are_spaced_by_thirty_minutes():
    assert wl.nearby_spacing_wait_s(None, NOW) == 0
    assert wl.nearby_spacing_wait_s(NOW - 600, NOW) == 1200
    assert wl.nearby_spacing_wait_s(NOW - 1800, NOW) == 0 and wl.nearby_spacing_wait_s(NOW - 5000, NOW) == 0
