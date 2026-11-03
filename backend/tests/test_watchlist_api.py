"""GET /api/v1/vessels/watchlist: the saved real-tanker snapshot. Never calls the provider, never fails, never shows a record as live unless it was just refreshed."""
import json
import time

import pytest
from fastapi.testclient import TestClient

from main import app
from services import ais_watchlist as wl
from tests.test_ais_watchlist import MALACCA_SAMPLE, NOW, SAMPLE, base_snapshot, row

client = TestClient(app)


@pytest.fixture
def snap_file(tmp_path, monkeypatch):
    path = tmp_path / "watchlist.json"
    monkeypatch.setattr(wl, "WATCHLIST_FILE", path)
    return path


def test_no_snapshot_gives_an_honest_empty_answer_not_an_error(snap_file):
    r = client.get("/api/v1/vessels/watchlist")
    j = r.json()
    assert r.status_code == 200 and j["status"] == "NONE" and j["vessels"] == [] and j["samples"] == [] and "simulated" in j["note"].lower()
    assert isinstance(j["key_expires_in_days"], int)


@pytest.mark.parametrize("content", ["{not json", "[]", '{"watchlist": "oops"}', "{}"])
def test_a_broken_snapshot_file_is_treated_as_no_snapshot(snap_file, content):
    snap_file.write_text(content, encoding="utf-8")
    r = client.get("/api/v1/vessels/watchlist")
    assert r.status_code == 200 and r.json()["status"] == "NONE" and r.json()["vessels"] == []


def test_a_saved_snapshot_is_served_as_snapshot_with_ages_measured_now(snap_file):
    snap = base_snapshot()
    for v in snap["watchlist"]:
        v["record_fetched_utc"] = wl.utc_iso(time.time() - 3600)         # ages are measured against the time of the request
    snap["watchlist"][0]["position_age_s"] = 100
    wl.save_snapshot(snap, snap_file)
    j = client.get("/api/v1/vessels/watchlist").json()
    assert j["status"] == "SNAPSHOT" and len(j["vessels"]) == 3
    v = j["vessels"][0]
    assert v["state"] == "SNAPSHOT" and 3600 + 100 <= v["last_seen_age_s_now"] <= 3600 + 130        # one hour old plus the 100 s the position already had
    assert v["cargo_note"] == "cargo type not confirmed by AIS" and v["area"] == wl.HUELVA_AREA
    assert all(x["state"] == "SNAPSHOT" for x in j["vessels"])


def test_a_record_is_live_only_if_it_was_refreshed_seconds_ago_and_its_position_is_young(snap_file):
    snap = base_snapshot()
    snap["watchlist"][0].update(record_fetched_utc=wl.utc_iso(time.time() - 20), position_age_s=45)
    snap["watchlist"][1].update(record_fetched_utc=wl.utc_iso(time.time() - 20), position_age_s=900)        # fresh fetch, old position
    snap["watchlist"][2].update(record_fetched_utc=wl.utc_iso(time.time() - 600), position_age_s=45)        # young position, but fetched ten minutes ago
    wl.save_snapshot(snap, snap_file)
    states = [v["state"] for v in client.get("/api/v1/vessels/watchlist").json()["vessels"]]
    assert states == ["LIVE", "DELAYED", "SNAPSHOT"]


def test_flag_comes_from_the_provider_registry_when_there_is_one_and_says_where_it_came_from(snap_file):
    snap = base_snapshot()
    snap["watchlist"][0].update(flag_registry="Cayman Islands", flag_from_mmsi_prefix=None)
    snap["watchlist"][1].update(flag_registry=None, flag_from_mmsi_prefix="Panama")
    snap["watchlist"][2].update(flag_registry=None, flag_from_mmsi_prefix=None)
    wl.save_snapshot(snap, snap_file)
    v = client.get("/api/v1/vessels/watchlist").json()["vessels"]
    assert (v[0]["flag"], v[0]["flag_source"]) == ("Cayman Islands", "provider registry (Vessel Flag Information)")
    assert v[1]["flag"] == "Panama" and "MMSI prefix" in v[1]["flag_source"] and v[2]["flag"] is None and v[2]["flag_source"] is None


def test_samples_are_listed_by_label_only_and_never_as_coverage(snap_file):
    snap = base_snapshot()
    seed_pos = {**row(538007985, 80, 278, 0.1, name="SINGAPORE ENERGY", lat=2.34, lng=101.96), "_fetched_at": NOW}
    wl.add_location_sample(snap, MALACCA_SAMPLE, 538007985, NOW + 900, seed_pos, "Strait of Malacca")
    wl.save_snapshot(snap, snap_file)
    j = client.get("/api/v1/vessels/watchlist").json()
    assert len(j["samples"]) == 2 and all("vessels" not in s for s in j["samples"])
    assert j["samples"][0]["label"].startswith("vessels within 10 nm of FRONT ALTAIR") and j["samples"][1]["area"] == "Strait of Malacca"
    assert all("NOT coverage" in s["caveat"] for s in j["samples"])
    assert "Not chokepoint traffic" in j["label"]
    assert {v["area"] for v in j["vessels"]} == {wl.HUELVA_AREA, "Strait of Malacca"}
    text = json.dumps(j).lower()
    assert "tankers within" not in text and "crude carrier" not in text and "sanction" not in text and "dark fleet" not in text


def test_vessels_without_a_usable_position_are_left_out(snap_file):
    snap = base_snapshot()
    snap["watchlist"][0]["lat"] = None
    wl.save_snapshot(snap, snap_file)
    assert len(client.get("/api/v1/vessels/watchlist").json()["vessels"]) == 2


def test_the_endpoint_never_touches_the_provider(snap_file, monkeypatch):
    def boom(*a, **k):
        raise AssertionError("the watchlist endpoint must not call the provider")
    monkeypatch.setattr("services.shipfinder.ShipFinderClient.call", boom)
    wl.save_snapshot(base_snapshot(), snap_file)
    assert client.get("/api/v1/vessels/watchlist").status_code == 200
    snap_file.unlink()
    assert client.get("/api/v1/vessels/watchlist").status_code == 200


def test_a_record_dated_in_the_future_is_never_live(snap_file):
    snap = base_snapshot()                                                # the fixture's times are in the future relative to now
    snap["watchlist"][0].update(record_fetched_utc=wl.utc_iso(time.time() + 3600), position_age_s=10)
    wl.save_snapshot(snap, snap_file)
    assert client.get("/api/v1/vessels/watchlist").json()["vessels"][0]["state"] == "SNAPSHOT"
