"""M12 endpoints: budget from our own log, saved-first search with one explicit provider search, saved tracks, saved Nearby samples, and the expired-key behaviour
(tested by faking the date with AIS_TODAY, never by waiting for 2026-11-13). No test reaches the provider: the client gets a mock transport."""
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from main import app
from routers import ais as ais_router
from services import ais_watchlist as wl
from services import shipfinder as sf
from tests.test_ais_watchlist import MALACCA_SAMPLE, NOW, base_snapshot
from tests.test_shipfinder import FAKE_KEY, Clock, Provider

client = TestClient(app)


@pytest.fixture
def saved(tmp_path, monkeypatch):
    """A snapshot with both areas, two saved tracks (one that travelled, one that did not), an empty call log, and a client that talks to a mock provider."""
    snap = base_snapshot()
    seed_pos = {**wl.clean_vessel({"mmsi": 538007985, "ship_name": "SINGAPORE ENERGY", "ship_type": 80, "lat": 2.34, "lng": 101.96, "last_time": NOW - 120, "sog": 0.1, "navistat": 1,
                                   "length": 278}, NOW), "_fetched_at": NOW + 600}
    seed_raw = {"mmsi": 538007985, "ship_name": "SINGAPORE ENERGY", "ship_type": 80, "lat": 2.34, "lng": 101.96, "last_time": NOW - 120, "sog": 0.1, "navistat": 1, "length": 278, "data_source": 0}
    wl.add_location_sample(snap, MALACCA_SAMPLE, 538007985, NOW + 1200, {**seed_raw, "_fetched_at": NOW + 600}, "Strait of Malacca")
    del seed_pos
    wfile, tfile = tmp_path / "watchlist.json", tmp_path / "tracks.json"
    wl.save_snapshot(snap, wfile)
    track = lambda mmsi, name, s2e, moving: {"mmsi": mmsi, "name": name, "label": "past track, fetched at 2026-11-03 16:11 UTC", "fetched_utc": "2026-11-03T16:11:15Z", "start_to_end_nm": s2e,
                                              "moving_share_pct": moving, "path_nm": s2e + 5, "points": [[1.0, 2.0, 1, 0.0], [1.1, 2.1, 2, 5.0]], "points_stored": 2, "points_provider": 99}
    tfile.write_text(json.dumps({"tracks": [track(111111111, "TRAVELLER", 650.0, 67), track(222222222, "SITTER", 0.1, 0)]}), encoding="utf-8")
    monkeypatch.setattr(wl, "WATCHLIST_FILE", wfile)
    monkeypatch.setattr(wl, "TRACKS_FILE", tfile)
    monkeypatch.setattr(sf, "DEFAULT_CALL_LOG", tmp_path / "ais_calls.jsonl")
    provider = Provider()
    clock = Clock()
    made = sf.ShipFinderClient(key=FAKE_KEY, transport=httpx.MockTransport(provider), state_dir=tmp_path / "state", log_path=tmp_path / "ais_calls.jsonl", clock=clock)
    monkeypatch.setattr(ais_router, "_client", lambda: made)
    return {"snap": snap, "provider": provider, "clock": clock, "client": made, "tmp": tmp_path, "mmsis": [v["mmsi"] for v in snap["watchlist"]]}


# ------------------------------------------------------------------ the key's expiry date, faked
def test_the_client_refuses_every_call_from_the_expiry_date_and_sends_nothing(saved, monkeypatch):
    monkeypatch.setenv("AIS_TODAY", "2026-11-13")
    with pytest.raises(sf.AISError) as e:
        saved["client"].vessel_search("EAGLE")
    assert e.value.kind == "key_expired" and saved["provider"].requests == [] and saved["client"].budget()["vessel_search"]["used"] == 0


def test_the_day_before_expiry_still_works(saved, monkeypatch):
    monkeypatch.setenv("AIS_TODAY", "2026-11-12")
    saved["provider"].replies = [{"status": 0, "msg": "", "data": [{"mmsi": 477000001, "ship_name": "EAGLE ONE", "last_time": NOW}]}]
    assert saved["client"].vessel_search("EAGLE")[0]["ship_name"] == "EAGLE ONE" and len(saved["provider"].requests) == 1


@pytest.mark.parametrize("today,days,expired", [("2026-11-04", 9, False), ("2026-11-12", 1, False), ("2026-11-13", 0, True), ("2027-03-01", -108, True)])
def test_health_carries_the_key_line(saved, monkeypatch, today, days, expired):
    monkeypatch.setenv("AIS_TODAY", today)
    j = client.get("/api/v1/health").json()
    assert j["ais_key"]["expires_in_days"] == days and j["ais_key"]["expired"] is expired and j["ais_key_line"] == j["ais_key"]["line"]
    assert ("expired" in j["ais_key_line"]) is expired and (f"expires in {days} day" in j["ais_key_line"]) is (not expired)


def test_after_expiry_the_watchlist_is_still_served_with_the_saved_on_label_and_no_error(saved, monkeypatch):
    monkeypatch.setenv("AIS_TODAY", "2026-11-14")
    r = client.get("/api/v1/vessels/watchlist")
    j = r.json()
    day = wl.utc_iso(NOW)[:10]
    assert r.status_code == 200 and j["status"] == "SNAPSHOT" and j["key_expired"] is True and len(j["vessels"]) == 7
    assert j["key_line"] == f"AIS key expired, showing data saved on {day}" and all(v["state"] == "SNAPSHOT" for v in j["vessels"])


def test_after_expiry_every_saved_view_still_answers_and_no_provider_call_is_made(saved, monkeypatch):
    monkeypatch.setenv("AIS_TODAY", "2026-11-20")
    m = saved["mmsis"][0]
    for url in ["/api/v1/ais/budget", "/api/v1/ais/search?q=a", "/api/v1/vessels/111111111/track", "/api/v1/vessels/999/track", f"/api/v1/vessels/{m}/near", "/api/v1/vessels/watchlist"]:
        assert client.get(url).status_code == 200, url
    r = client.post("/api/v1/ais/search/provider", json={"q": "EAGLE"})
    assert r.status_code == 200 and r.json()["status"] == "KEY_EXPIRED" and "expired" in r.json()["message"] and saved["provider"].requests == []
    t = client.get("/api/v1/vessels/111111111/track").json()
    assert t["status"] == "SAVED" and t["key"]["expired"] is True and t["key"]["line"] == "AIS key expired, showing data saved on 2026-11-03"
    assert client.get("/api/v1/ais/search?q=ab").json()["provider_search"]["available"] is False


# ------------------------------------------------------------------ budget
def test_budget_counts_from_the_call_log_and_computes_what_is_left(saved):
    log = saved["tmp"] / "ais_calls.jsonl"
    rows = [{"ts": "2026-11-03T10:00:00Z", "service": "vessel_position", "status": 0}] * 11 + [{"ts": "2026-11-03T11:00:00Z", "service": "vessel_track", "status": 0}] * 3 \
        + [{"ts": "2026-11-01T14:57:00Z", "service": "vessels_nearby", "status": 38}] * 2 + [{"ts": "2026-11-03T12:00:00Z", "service": "vessel_search", "status": 31}]
    log.write_text("\n".join(json.dumps(r) for r in rows) + "\nnot json\n", encoding="utf-8")
    j = client.get("/api/v1/ais/budget").json()
    s = j["services"]
    assert s["vessel_position"]["used"] == 11 and s["vessel_position"]["quota"] == 50 and s["vessel_position"]["left"] == 39
    assert s["vessel_track"]["used"] == 3 and s["vessel_track"]["left"] == 7
    assert s["vessels_nearby"]["used"] == 2 and s["vessels_nearby"]["failed"] == 2 and s["vessels_nearby"]["left"] is None and s["vessels_nearby"]["metered"] is False
    assert s["vessel_search"]["ok"] == 1 and s["vessel_search"]["failed"] == 0            # status 31 is an answer
    assert j["total_calls"] == 17 and j["key"]["expires_on"] == "2026-11-13" and "calls_per_service" not in j


def test_budget_without_a_log_is_all_zero_not_an_error(saved):
    j = client.get("/api/v1/ais/budget").json()
    assert j["total_calls"] == 0 and all(v["used"] == 0 for v in j["services"].values())


# ------------------------------------------------------------------ search: saved first, provider only on an explicit submit
def test_the_saved_search_matches_name_mmsi_and_imo_and_never_calls_the_provider(saved):
    v = saved["snap"]["watchlist"][0]
    name = (v["name"] or "").split()[0][:4] if v["name"] else str(v["mmsi"])[:5]
    by_name = client.get("/api/v1/ais/search", params={"q": name}).json()
    assert v["mmsi"] in [r["mmsi"] for r in by_name["results"]]
    assert [r["mmsi"] for r in client.get("/api/v1/ais/search", params={"q": str(v["mmsi"])}).json()["results"]] == [v["mmsi"]]
    j = client.get("/api/v1/ais/search", params={"q": "zzzzzz"}).json()
    assert j["results"] == [] and j["message"] == "No saved vessel matches." and j["source"] == "saved watchlist"
    assert client.get("/api/v1/ais/search", params={"q": "a"}).json()["results"] == []
    assert saved["provider"].requests == []


def test_a_provider_search_needs_three_characters_and_an_explicit_post(saved):
    r = client.post("/api/v1/ais/search/provider", json={"q": "ab"})
    assert r.json()["status"] == "TOO_SHORT" and saved["provider"].requests == []


def test_provider_search_returns_rows_flags_saved_ones_and_says_there_is_no_position(saved):
    known = saved["mmsis"][0]
    saved["provider"].replies = [{"status": 0, "msg": "", "data": [{"mmsi": known, "ship_name": "KNOWN ", "imo": 9, "last_time": NOW}, {"mmsi": 477000001, "ship_name": "NEW ONE", "last_time": NOW}]}]
    j = client.post("/api/v1/ais/search/provider", json={"q": "known"}).json()
    assert j["status"] == "OK" and [r["in_watchlist"] for r in j["results"]] == [True, False] and "no position" in j["note"] and len(saved["provider"].requests) == 1
    assert j["results"][1]["flag"] and "lat" not in j["results"][1]


def test_status_31_is_shown_as_no_match_and_does_not_trip_the_breaker(saved):
    saved["provider"].replies = [{"status": 31, "msg": "no data"}]
    j = client.post("/api/v1/ais/search/provider", json={"q": "NOSUCH"}).json()
    assert j["status"] == "NO_MATCH" and j["message"] == "no match"
    assert saved["client"].budget()["vessel_search"]["breaker"] == "closed"


def test_the_per_minute_limit_and_the_minimum_interval_are_respected_and_reported_plainly(saved):
    saved["provider"].replies = [{"status": 0, "msg": "", "data": []}] * 30
    first = client.post("/api/v1/ais/search/provider", json={"q": "EAGLE"}).json()
    second = client.post("/api/v1/ais/search/provider", json={"q": "EAGLE"}).json()            # same instant: under the 1 s minimum interval
    assert first["status"] == "NO_MATCH" and second["status"] == "UNAVAILABLE" and second["kind"] == "too_soon" and len(saved["provider"].requests) == 1
    for _ in range(25):
        saved["clock"].advance(1.5)
        client.post("/api/v1/ais/search/provider", json={"q": "EAGLE"})
    assert len(saved["provider"].requests) <= 1 + 20                                           # never more than 20 inside any minute


def test_a_provider_error_trips_the_breaker_and_the_next_search_is_not_sent(saved):
    saved["provider"].replies = [{"status": 23, "msg": "frequency"}]
    a = client.post("/api/v1/ais/search/provider", json={"q": "EAGLE"}).json()
    saved["clock"].advance(5)
    b = client.post("/api/v1/ais/search/provider", json={"q": "EAGLE"}).json()
    assert a["status"] == "UNAVAILABLE" and b["status"] == "UNAVAILABLE" and b["kind"] == "breaker_open" and "paused" in b["message"] and len(saved["provider"].requests) == 1


# ------------------------------------------------------------------ tracks
def test_the_track_that_travelled_is_the_headline_and_the_one_that_did_not_is_labelled_stationary(saved):
    t, s = client.get("/api/v1/vessels/111111111/track").json(), client.get("/api/v1/vessels/222222222/track").json()
    assert t["headline"] is True and t["stationary"] is False and t["motion_note"] is None and t["label"] == "past track, fetched at 2026-11-03 16:11 UTC"
    assert s["headline"] is False and s["stationary"] is True and s["motion_note"] == "stationary during this window" and len(s["points"]) == 2


def test_a_vessel_without_a_saved_track_says_so_and_a_missing_file_is_not_an_error(saved):
    j = client.get("/api/v1/vessels/333333333/track").json()
    assert j["status"] == "NONE" and j["label"] == "no saved track" and j["points"] == []
    wl.TRACKS_FILE.unlink()
    assert client.get("/api/v1/vessels/111111111/track").json()["label"] == "no saved track"


# ------------------------------------------------------------------ saved Nearby samples
def test_near_shows_the_saved_sample_with_its_seed_and_time_sorted_by_distance_and_never_calls_nearby(saved):
    malacca = next(v for v in saved["snap"]["watchlist"] if v["area"] == "Strait of Malacca")
    j = client.get(f"/api/v1/vessels/{malacca['mmsi']}/near").json()
    assert j["status"] == "SAVED SAMPLE" and j["seed"]["name"] == "SINGAPORE ENERGY" and j["label"].startswith("vessels within 10 nm of SINGAPORE ENERGY, seen at")
    d = [x["distance_nm"] for x in j["vessels"]]
    assert d == sorted(d) and malacca["mmsi"] not in [x["mmsi"] for x in j["vessels"]] and "on hold" in j["note"] and "NOT coverage" in j["caveat"]
    assert all("count" not in k for k in j) and saved["provider"].requests == []
    huelva = next(v for v in saved["snap"]["watchlist"] if v["area"] == wl.HUELVA_AREA)
    assert "FRONT ALTAIR" in client.get(f"/api/v1/vessels/{huelva['mmsi']}/near").json()["label"]


def test_near_for_a_vessel_in_neither_sample_says_so(saved):
    j = client.get("/api/v1/vessels/123456789/near").json()
    assert j["status"] == "NOT_IN_SAMPLE" and j["vessels"] == [] and "on hold" in j["note"]
    wl.WATCHLIST_FILE.unlink()
    assert client.get("/api/v1/vessels/123456789/near").json()["status"] == "NONE"
