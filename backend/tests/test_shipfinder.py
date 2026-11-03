"""ShipFinder client: quota guard, circuit breaker, min interval, kill switch, call log, and the key never leaking. Mock transport only; no test spends real quota."""
import json
import logging
from datetime import date

import httpx
import pytest

from services import price_feed, shipfinder as sf

FAKE_KEY = "SFTESTKEY" + "0123456789abcdef0123456"       # 32 characters, obviously not a real key
OK_ROUTE = {"status": 0, "msg": "", "data": {"distance": 6400.5, "route": [{"lng": 50.1, "lat": 26.7}, {"lng": 56.2, "lat": 26.5}]}}


class Clock:
    def __init__(self, t=1_000_000.0):
        self.t = t

    def __call__(self):
        return self.t

    def advance(self, s):
        self.t += s


class Provider:
    """Mock provider: counts requests, answers from a script."""

    def __init__(self, replies=None):
        self.replies = list(replies or [])
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        r = self.replies.pop(0) if self.replies else OK_ROUTE
        if isinstance(r, Exception):
            raise r
        if isinstance(r, httpx.Response):
            return r
        return httpx.Response(200, json=r)


def make(tmp_path, provider=None, clock=None, key=FAKE_KEY):
    provider = provider or Provider()
    clock = clock or Clock()
    c = sf.ShipFinderClient(key=key, transport=httpx.MockTransport(provider), state_dir=tmp_path / "state", log_path=tmp_path / "ais_calls.jsonl", clock=clock)
    return c, provider, clock


def test_success_sends_key_in_query_and_counts_a_metered_call(tmp_path):
    c, p, _ = make(tmp_path)
    body = c.route_plan_port_to_port("SARTA", "NLRTM", avoid=[2])
    assert body["data"]["distance"] == 6400.5
    req = p.requests[0]
    assert req.url.host == "api.elaneglobal.com" and req.url.path == "/v1/Prediction/RoutePlanPortToPort"
    q = dict(req.url.params)
    assert q["key"] == FAKE_KEY and q["start_port_code"] == "SARTA" and q["end_port_code"] == "NLRTM" and q["avoid"] == "2"
    assert c.budget()["route_port"]["used"] == 1 and c.budget()["route_port"]["left"] == 9


def test_point_to_point_puts_longitude_first(tmp_path):
    c, p, _ = make(tmp_path)
    c.route_plan_point_to_point((50.15, 26.7), (122.2, 29.9))
    q = dict(p.requests[0].url.params)
    assert q["start_point"] == "50.15,26.7" and q["end_point"] == "122.2,29.9"


# ------------------------------------------------------------------ circuit breaker
@pytest.mark.parametrize("reply", [{"status": 38, "msg": "The number of queries exceeded", "total": 0, "data": []}, {"status": 21, "msg": "no permission"},
                                   {"status": 6, "msg": "Key expired"}, {"status": 1, "msg": "fail"}])
def test_any_nonzero_status_stops_the_service_and_is_not_retried(tmp_path, reply):
    c, p, clock = make(tmp_path, Provider([reply]))
    with pytest.raises(sf.AISError) as e:
        c.call("port_info", {"keywords": "x"}, "t")
    assert e.value.kind == "provider_status" and e.value.status == reply["status"] and e.value.retry_after_s == 1800
    assert len(p.requests) == 1                                       # exactly one request: no retry
    with pytest.raises(sf.AISError) as e2:
        c.call("port_info", {"keywords": "x"}, "t")
    assert e2.value.kind == "breaker_open" and len(p.requests) == 1  # refused locally, nothing sent
    assert c.budget()["port_info"]["breaker"] == "open"


def test_breaker_is_per_service(tmp_path):
    c, p, clock = make(tmp_path, Provider([{"status": 38, "msg": "x"}]))
    with pytest.raises(sf.AISError):
        c.call("vessels_nearby", {"mmsi": 1}, "t")
    clock.advance(60)
    assert c.call("port_info", {"keywords": "x"}, "t")["status"] == 0   # port_info is unaffected


def test_backoff_starts_at_30_minutes_doubles_and_resets_on_success(tmp_path):
    fail = {"status": 38, "msg": "x"}
    c, p, clock = make(tmp_path, Provider([fail, fail, OK_ROUTE]))
    with pytest.raises(sf.AISError) as e1:
        c.call("port_info", {"keywords": "x"}, "t")
    assert e1.value.retry_after_s == 1800
    clock.advance(1799)
    with pytest.raises(sf.AISError) as e:
        c.call("port_info", {"keywords": "x"}, "t")
    assert e.value.kind == "breaker_open"
    clock.advance(2)                                                   # 30 minutes passed: one new attempt is allowed
    with pytest.raises(sf.AISError) as e2:
        c.call("port_info", {"keywords": "x"}, "t")
    assert e2.value.kind == "provider_status" and e2.value.retry_after_s == 3600   # second consecutive failure: 60 minutes
    clock.advance(3601)
    c.call("port_info", {"keywords": "x"}, "t")
    assert c.service_state("port_info")["consecutive_failures"] == 0 and c.budget()["port_info"]["breaker"] == "closed"
    assert len(p.requests) == 3


def test_backoff_is_capped_at_four_hours(tmp_path):
    c, p, clock = make(tmp_path, Provider([{"status": 38, "msg": "x"}] * 8))
    last = 0
    for _ in range(7):
        clock.advance(5 * 3600)
        with pytest.raises(sf.AISError) as e:
            c.call("port_info", {"keywords": "x"}, "t")
        last = e.value.retry_after_s
    assert last == 4 * 3600


@pytest.mark.parametrize("reply,kind", [(httpx.ConnectTimeout("slow"), "timeout"), (httpx.ConnectError("refused"), "http_error"),
                                         (httpx.Response(200, text="<html>gateway</html>"), "bad_response"), (httpx.Response(200, json=[1, 2]), "bad_response"),
                                         (httpx.Response(502, json={"status": 0, "msg": ""}), "provider_status")])
def test_transport_problems_also_trip_the_breaker(tmp_path, reply, kind):
    c, p, _ = make(tmp_path, Provider([reply]))
    with pytest.raises(sf.AISError) as e:
        c.call("vessel_search", {"keywords": "x"}, "t")
    assert e.value.kind == kind and c.budget()["vessel_search"]["breaker"] == "open"


# ------------------------------------------------------------------ min interval
def test_min_interval_is_enforced_locally(tmp_path):
    c, p, clock = make(tmp_path)
    c.call("vessels_nearby", {"mmsi": 1}, "t")
    clock.advance(29)
    with pytest.raises(sf.AISError) as e:
        c.call("vessels_nearby", {"mmsi": 2}, "t")
    assert e.value.kind == "too_soon" and len(p.requests) == 1          # the owner's rule: at most one Nearby call per 30 s
    clock.advance(1.5)
    c.call("vessels_nearby", {"mmsi": 2}, "t")
    assert len(p.requests) == 2


# ------------------------------------------------------------------ quota
def test_development_cap_is_60_percent_and_the_reserve_needs_an_explicit_override(tmp_path):
    assert sf.SERVICES["vessel_track"].dev_cap == 6 and sf.SERVICES["vessel_position"].dev_cap == 30 and sf.SERVICES["route_port"].dev_cap == 6
    c, p, clock = make(tmp_path)
    for _ in range(6):
        clock.advance(11)
        c.call("vessel_track", {"mmsi": 1, "start_time": 1, "end_time": 2}, "t")
    clock.advance(11)
    with pytest.raises(sf.AISError) as e:
        c.call("vessel_track", {"mmsi": 1, "start_time": 1, "end_time": 2}, "t")
    assert e.value.kind == "quota_cap" and len(p.requests) == 6
    c.call("vessel_track", {"mmsi": 1, "start_time": 1, "end_time": 2}, "t", allow_beyond_dev_cap=True)   # explicit approval
    assert c.budget()["vessel_track"]["left"] == 3


def test_the_real_quota_is_never_exceeded_even_with_the_override(tmp_path):
    c, p, clock = make(tmp_path)
    for _ in range(10):
        clock.advance(11)
        c.call("vessel_track", {"mmsi": 1, "start_time": 1, "end_time": 2}, "t", allow_beyond_dev_cap=True)
    clock.advance(11)
    with pytest.raises(sf.AISError) as e:
        c.call("vessel_track", {"mmsi": 1, "start_time": 1, "end_time": 2}, "t", allow_beyond_dev_cap=True)
    assert e.value.kind == "quota_exhausted" and len(p.requests) == 10


def test_a_failed_call_still_counts_against_the_quota(tmp_path):
    c, p, _ = make(tmp_path, Provider([{"status": 1, "msg": "fail"}]))
    with pytest.raises(sf.AISError):
        c.route_plan_port_to_port("A", "B")
    assert c.budget()["route_port"]["used"] == 1


def test_a_call_refused_locally_does_not_count(tmp_path):
    c, p, _ = make(tmp_path, Provider([{"status": 38, "msg": "x"}]))
    with pytest.raises(sf.AISError):
        c.route_plan_port_to_port("A", "B")
    for _ in range(3):
        with pytest.raises(sf.AISError):
            c.route_plan_port_to_port("A", "B")                         # breaker open: refused before any request
    assert c.budget()["route_port"]["used"] == 1 and len(p.requests) == 1


def test_counters_and_breaker_survive_a_restart(tmp_path):
    c1, p1, clock = make(tmp_path, Provider([OK_ROUTE, {"status": 38, "msg": "x"}]))
    c1.route_plan_port_to_port("A", "B")
    clock.advance(6)
    with pytest.raises(sf.AISError):
        c1.route_plan_port_to_port("A", "B")
    c2, p2, _ = make(tmp_path, clock=clock)                              # a new process reading the same state directory
    assert c2.budget()["route_port"]["used"] == 2 and c2.budget()["route_port"]["breaker"] == "open"
    with pytest.raises(sf.AISError) as e:
        c2.route_plan_port_to_port("A", "B")
    assert e.value.kind == "breaker_open" and p2.requests == []


# ------------------------------------------------------------------ kill switch and no key
def test_kill_switch_and_missing_key_make_no_request(tmp_path, monkeypatch):
    c, p, _ = make(tmp_path)
    monkeypatch.setenv("AIS_ENABLED", "0")
    with pytest.raises(sf.AISError) as e:
        c.port_info("x")
    assert e.value.kind == "disabled"
    monkeypatch.setenv("AIS_ENABLED", "1")
    c2, p2, _ = make(tmp_path, key="")
    with pytest.raises(sf.AISError) as e2:
        c2.port_info("x")
    assert e2.value.kind == "no_key" and p.requests == [] and p2.requests == []


def test_unknown_service_is_not_supported(tmp_path):
    c, p, _ = make(tmp_path)
    with pytest.raises(sf.NotSupported):
        c.call("vessels_in_zone", {}, "t")                              # disabled on this key: never implemented, never called
    assert p.requests == []


def test_key_expiry_countdown():
    assert sf.days_until_expiry(date(2026, 11, 2)) == 11 and sf.days_until_expiry(date(2026, 11, 13)) == 0 and sf.days_until_expiry(date(2026, 11, 14)) == -1


# ------------------------------------------------------------------ the key never leaks
def test_key_never_appears_in_errors_logs_call_log_state_or_raw_copy(tmp_path, caplog):
    price_feed.install_log_redaction()
    leak = httpx.ConnectError(f"cannot reach https://api.elaneglobal.com/v1/AIS/VesselSearch?key={FAKE_KEY}&keywords=x")
    c, p, clock = make(tmp_path, Provider([leak, {"status": 21, "msg": f"bad key {FAKE_KEY}"}, OK_ROUTE]))
    seen = []
    with caplog.at_level(logging.DEBUG):
        with pytest.raises(sf.AISError) as e1:
            c.vessel_search("x")
        seen.append(str(e1.value))
        clock.advance(2000)
        with pytest.raises(sf.AISError) as e2:
            c.vessel_search("x")
        seen.append(str(e2.value))
        clock.advance(4000)
        c.route_plan_port_to_port("A", "B", raw_dir=tmp_path / "raw", raw_name="plan")
    seen += [r.getMessage() for r in caplog.records]
    seen.append((tmp_path / "ais_calls.jsonl").read_text(encoding="utf-8"))
    seen.append((tmp_path / "state" / "ais_state.json").read_text(encoding="utf-8"))
    raw = list((tmp_path / "raw").glob("plan_*.json"))
    assert len(raw) == 1
    seen.append(raw[0].read_text(encoding="utf-8"))
    assert all(FAKE_KEY not in s for s in seen)
    assert json.loads(raw[0].read_text(encoding="utf-8"))["response"]["data"]["distance"] == 6400.5


def test_call_log_has_one_line_per_real_call_and_the_expected_fields(tmp_path):
    c, p, clock = make(tmp_path, Provider([OK_ROUTE, {"status": 38, "msg": "x"}]))
    c.route_plan_port_to_port("A", "B")
    clock.advance(6)
    with pytest.raises(sf.AISError):
        c.route_plan_port_to_port("A", "B")
    with pytest.raises(sf.AISError):
        c.route_plan_port_to_port("A", "B")                              # refused locally: not a provider call, not logged
    lines = [json.loads(l) for l in (tmp_path / "ais_calls.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [(l["service"], l["status"], l["error"]) for l in lines] == [("route_port", 0, None), ("route_port", 38, "provider_status")]
    assert set(lines[0]) == {"ts", "service", "http", "status", "ms", "purpose", "error"}


def test_redaction_covers_a_key_query_parameter():
    assert price_feed.redact("GET /x?key=abcdef123456&max=5") == "GET /x?key=REDACTED&max=5"
    assert price_feed.redact("GET /x?api_key=abcdef&y=1") == "GET /x?api_key=REDACTED&y=1"
    assert price_feed.redact("monkey=banana") == "monkey=banana"


def test_manual_hold_blocks_a_service_until_cleared_and_survives_a_restart(tmp_path):
    c, p, clock = make(tmp_path)
    c.set_hold("vessels_nearby", "owner has not confirmed the console numbers")
    c2, p2, _ = make(tmp_path, clock=clock)                              # new process, same state directory
    with pytest.raises(sf.AISError) as e:
        c2.call("vessels_nearby", {"mmsi": 1}, "t")
    assert e.value.kind == "on_hold" and p2.requests == [] and c2.budget()["vessels_nearby"]["hold"]
    assert c2.call("port_info", {"keywords": "x"}, "t")["status"] == 0   # other services unaffected
    c2.clear_hold("vessels_nearby")
    clock.advance(31)
    assert c2.call("vessels_nearby", {"mmsi": 1}, "t")["status"] == 0


# ------------------------------------------------------------------ owner decision 2026-11-03: status 31 on Vessel Search is an empty result
NO_MATCH = {"status": 31, "msg": "", "total": 0, "data": []}


def test_search_status_31_is_an_empty_result_that_is_counted_and_logged_but_does_not_trip(tmp_path):
    c, p, clock = make(tmp_path, Provider([NO_MATCH, {"status": 0, "msg": "", "total": 1, "data": [{"mmsi": 1}]}]))
    assert c.vessel_search("NOSUCHSHIP") == []
    assert c.budget()["vessel_search"]["breaker"] == "closed" and c.budget()["vessel_search"]["used"] == 1
    assert c.service_state("vessel_search")["consecutive_failures"] == 0
    lines = [json.loads(l) for l in (tmp_path / "ais_calls.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [(l["service"], l["status"], l["error"]) for l in lines] == [("vessel_search", 31, None)]
    clock.advance(1.5)
    assert c.vessel_search("REAL") == [{"mmsi": 1}] and len(p.requests) == 2        # the next search is allowed straight away


def test_status_31_from_any_other_service_still_trips_the_breaker(tmp_path):
    c, p, clock = make(tmp_path, Provider([NO_MATCH]))
    with pytest.raises(sf.AISError) as e:
        c.port_info("x")
    assert e.value.kind == "provider_status" and e.value.status == 31 and c.budget()["port_info"]["breaker"] == "open"


@pytest.mark.parametrize("reply", [{"status": 38, "msg": "The number of queries exceeded"}, {"status": 21, "msg": "no permission"}, {"status": 6, "msg": "Key expired"}])
def test_every_other_search_failure_still_trips_the_breaker(tmp_path, reply):
    c, p, _ = make(tmp_path, Provider([reply]))
    with pytest.raises(sf.AISError) as e:
        c.vessel_search("x")
    assert e.value.kind == "provider_status" and c.budget()["vessel_search"]["breaker"] == "open"


def test_search_timeout_and_garbage_still_trip_even_though_31_does_not(tmp_path):
    c, p, clock = make(tmp_path, Provider([httpx.ConnectTimeout("slow")]))
    with pytest.raises(sf.AISError):
        c.vessel_search("x")
    assert c.budget()["vessel_search"]["breaker"] == "open"


def test_search_is_limited_to_20_calls_a_minute_and_refusals_are_not_sent_or_counted(tmp_path):
    assert sf.SERVICES["vessel_search"].max_per_minute == 20 and sf.SERVICES["vessel_search"].min_interval_s == 1.0
    c, p, clock = make(tmp_path, Provider([NO_MATCH] * 40))              # typing that matches nothing must not flood the provider either
    for _ in range(20):
        c.vessel_search("abc")
        clock.advance(1.1)                                              # 20 calls in 22 s: the minimum interval alone would allow 20 more
    with pytest.raises(sf.AISError) as e:
        c.vessel_search("abcd")
    assert e.value.kind == "rate_limited" and len(p.requests) == 20 and c.budget()["vessel_search"]["used"] == 20
    assert 0 < e.value.retry_after_s <= 60
    clock.advance(40)                                                   # the oldest calls are now more than a minute old
    c.vessel_search("abcde")
    assert len(p.requests) == 21


def test_the_per_minute_window_survives_a_restart(tmp_path):
    c1, p1, clock = make(tmp_path, Provider([NO_MATCH] * 25))
    for _ in range(20):
        c1.vessel_search("a")
        clock.advance(1.1)
    c2, p2, _ = make(tmp_path, clock=clock)
    with pytest.raises(sf.AISError) as e:
        c2.vessel_search("a")
    assert e.value.kind == "rate_limited" and p2.requests == []
