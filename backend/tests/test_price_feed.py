"""M6 live price: EIA adapter, CSV fallback, status labelling, merge/dedupe, and keeping the API key out of everything.

The EIA network layer is replaced by httpx.MockTransport returning the documented v2 reply shape
({"response": {"data": [{"period", "series", "value"}, ...]}}) and the error replies observed live
(HTTP 403 {"error": {"code": "API_KEY_MISSING" | "API_KEY_INVALID"}}). All the logic around it is the real code.
"""

import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from main import app
from services import price_feed as pf

SECRET = "SECRETKEY-ABC123xyz-9f8e7d"
NOW = datetime(2026, 10, 25, 12, 0, tzinfo=timezone.utc).timestamp()
BACKEND = Path(__file__).resolve().parent.parent
FRONTEND = BACKEND.parent / "frontend"


def run(coro):
    return asyncio.run(coro)


async def no_sleep(_):
    return None


def eia_reply(rows):
    """rows: [(date, wti, brent)] -> the v2 JSON body. A None price is sent as a blank string, like EIA does on market holidays."""
    data = []
    for d, w, b in rows:
        data.append({"period": d, "series": "RWTC", "series-description": "Cushing, OK WTI Spot Price FOB", "value": "" if w is None else str(w), "units": "$/BBL"})
        data.append({"period": d, "series": "RBRTE", "series-description": "Europe Brent Spot Price FOB", "value": "" if b is None else str(b), "units": "$/BBL"})
    return {"response": {"total": len(data), "dateFormat": "YYYY-MM-DD", "frequency": "daily", "data": data}, "apiVersion": "2.1.10"}


# the real EIA table, 13 to 20 Oct 2026, newest first as the API returns it (19 Oct is a Monday, 12 Oct a US holiday: blank)
EIA_ROWS = [("2026-10-20", 107.89, 115.22), ("2026-10-19", 110.01, 118.82), ("2026-10-16", 108.21, 119.33), ("2026-10-15", 104.71, 126.35),
            ("2026-10-14", 96.34, 126.55), ("2026-10-13", 95.39, 125.78), ("2026-10-12", None, None)]


class Recorder:
    """A MockTransport handler that records every request and replies with `reply(request)`."""

    def __init__(self, reply):
        self.reply, self.requests = reply, []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        out = self.reply(request)
        if isinstance(out, Exception):
            raise out
        return out


def service(handler, csv_path=None, clock=lambda: NOW):
    transport = httpx.MockTransport(handler)
    csv = pf.CsvProvider(csv_path) if csv_path else pf.CsvProvider()
    return pf.PriceService(csv=csv, clock=clock, provider_factory=lambda key: pf.EiaProvider(key, transport=transport, sleep=no_sleep))


@pytest.fixture(autouse=True)
def with_key(monkeypatch):
    monkeypatch.setenv("EIA_API_KEY", SECRET)


def ok(_req):
    return httpx.Response(200, json=eia_reply(EIA_ROWS))


# ------------------------------------------------------------------ success
def test_success_is_daily_close_with_correct_values_change_and_age():
    rec = Recorder(ok)
    j = run(service(rec).live())
    assert j["status"] == "DAILY_CLOSE" and j["fallback_reason"] is None and j["cached"] is False
    assert (j["wti"], j["brent"], j["as_of"]) == (107.89, 115.22, "2026-10-20")
    assert j["change"] == pytest.approx(107.89 - 110.01, abs=0.01) and j["change_pct"] == pytest.approx((107.89 - 110.01) / 110.01 * 100, abs=0.01)
    assert j["brent_change"] == pytest.approx(115.22 - 118.82, abs=0.01)
    assert j["age_days"] == 5 and "5 days old" in j["age_warning"] and "weekly release" in j["age_warning"]    # honest about the lag
    assert j["series"] == {"wti": "RWTC", "brent": "RBRTE"} and j["units"] == "USD per barrel"
    assert j["fetched_at"] == "2026-10-25T12:00:00Z"


def test_the_request_asks_for_the_right_series_route_and_sort():
    rec = Recorder(ok)
    run(service(rec).live())
    assert len(rec.requests) == 1
    q = rec.requests[0].url.params
    assert rec.requests[0].url.path == "/v2/petroleum/pri/spt/data/"
    assert q.get_list("facets[series][]") == ["RWTC", "RBRTE"] and q["frequency"] == "daily" and q["data[0]"] == "value"
    assert q["sort[0][column]"] == "period" and q["sort[0][direction]"] == "desc" and q["api_key"] == SECRET


def test_blank_holiday_prices_are_skipped_when_choosing_the_latest_and_the_previous_value():
    rows = [("2026-10-21", None, None), ("2026-10-20", 107.89, 115.22), ("2026-10-19", None, 118.82), ("2026-10-16", 108.21, 119.33)]
    j = run(service(Recorder(lambda r: httpx.Response(200, json=eia_reply(rows)))).live())
    assert j["as_of"] == "2026-10-20" and j["wti"] == 107.89
    assert j["change"] == pytest.approx(107.89 - 108.21, abs=0.01)             # previous WTI is 16 Oct: the blank 19 Oct is not used
    assert j["brent"] == 115.22 and j["brent_change"] == pytest.approx(115.22 - 118.82, abs=0.01)


def test_fresh_data_has_no_age_warning():
    j = run(service(Recorder(ok), clock=lambda: datetime(2026, 10, 21, 12, tzinfo=timezone.utc).timestamp()).live())
    assert j["age_days"] == 1 and j["age_warning"] is None and j["status"] == "DAILY_CLOSE"


def test_a_second_call_within_the_ttl_reuses_the_cache():
    rec = Recorder(ok)
    svc = service(rec)
    first, second = run(svc.live()), run(svc.live())
    assert len(rec.requests) == 1 and second["cached"] is True and second["status"] == "DAILY_CLOSE" and second["wti"] == first["wti"]


# ------------------------------------------------------------------ failures: all fall back to the CSV with its real date
def assert_csv_fallback(j, reason):
    assert j["status"] == "OFFLINE_FALLBACK" and j["fallback_reason"] == reason
    assert (j["as_of"], j["wti"], j["brent"]) == ("2026-08-18", 86.48, 95.29)        # the last real row of oil_daily_prices.csv
    assert j["age_days"] == 68 and "68 days old" in j["age_warning"] and j["cached"] is False
    assert "local CSV" in j["source"] and j["fallback_message"]


def test_api_failure_retries_then_falls_back_to_the_csv():
    rec = Recorder(lambda r: httpx.Response(503, text="upstream unavailable"))
    j = run(service(rec).live())
    assert len(rec.requests) == pf.EIA_RETRIES + 1                                 # retried with backoff
    assert_csv_fallback(j, "http_error")


def test_invalid_key_falls_back_without_retrying():
    body = {"error": {"code": "API_KEY_INVALID", "message": "An invalid api_key was supplied. Get one at https://api.eia.gov:443"}}
    rec = Recorder(lambda r: httpx.Response(403, json=body))
    j = run(service(rec).live())
    assert len(rec.requests) == 1                                                  # a bad key cannot be fixed by retrying
    assert_csv_fallback(j, "invalid_key")


def test_timeout_retries_then_falls_back():
    rec = Recorder(lambda r: httpx.ReadTimeout("took too long"))
    j = run(service(rec).live())
    assert len(rec.requests) == pf.EIA_RETRIES + 1
    assert_csv_fallback(j, "timeout")


def test_rate_limit_is_reported_as_such():
    j = run(service(Recorder(lambda r: httpx.Response(429, text="slow down"))).live())
    assert_csv_fallback(j, "rate_limited")


def test_garbage_reply_falls_back_without_retrying():
    rec = Recorder(lambda r: httpx.Response(200, text="<html>not json</html>"))
    j = run(service(rec).live())
    assert len(rec.requests) == 1
    assert_csv_fallback(j, "bad_response")


def test_no_key_makes_no_network_request_at_all(monkeypatch):
    monkeypatch.setenv("EIA_API_KEY", "")
    rec = Recorder(ok)
    j = run(service(rec).live())
    assert rec.requests == []
    assert_csv_fallback(j, "no_key")


def test_key_removed_entirely_is_the_same_as_empty(monkeypatch):
    monkeypatch.delenv("EIA_API_KEY", raising=False)
    rec = Recorder(ok)
    assert_csv_fallback(run(service(rec).live()), "no_key")
    assert rec.requests == []


def test_after_a_failure_a_recent_successful_answer_is_reused_and_still_labelled_by_its_real_source():
    state = {"fail": False}

    def reply(req):
        return httpx.Response(503) if state["fail"] else httpx.Response(200, json=eia_reply(EIA_ROWS))

    clock = {"t": NOW}
    svc = service(Recorder(reply), clock=lambda: clock["t"])
    run(svc.live())
    state["fail"] = True
    clock["t"] += 2 * 3600                                                         # cache expired, EIA down, answer is 2 h old
    j = run(svc.live())
    assert j["status"] == "DAILY_CLOSE" and j["cached"] is True and j["wti"] == 107.89 and j["fetched_at"] == "2026-10-25T12:00:00Z"
    clock["t"] += 30 * 3600                                                        # now older than 24 h: the CSV takes over
    assert run(svc.live())["status"] == "OFFLINE_FALLBACK"


def test_status_is_never_live():
    for handler in (ok, lambda r: httpx.Response(503), lambda r: httpx.Response(403, json={"error": {"code": "API_KEY_INVALID"}})):
        j = run(service(Recorder(handler)).live())
        assert j["status"] in ("DAILY_CLOSE", "OFFLINE_FALLBACK") and "LIVE" not in json.dumps(j).upper().replace("DELIVERY", "")


# ------------------------------------------------------------------ history: merge, no duplicate dates, holidays
@pytest.fixture
def small_csv(tmp_path):
    p = tmp_path / "prices.csv"
    p.write_text("date,wti,brent\n2026-09-28,80.0,90.0\n2026-09-29,,\n2026-09-30,81.0,91.0\n2026-10-12,,\n2026-10-13,70.0,71.0\n2026-10-14,,72.0\n", encoding="utf-8")
    return p


def test_history_merges_csv_and_eia_without_duplicate_dates_and_prefers_eia(small_csv):
    j = run(service(Recorder(ok), csv_path=small_csv).history(30))
    dates = [p["date"] for p in j["points"]]
    assert dates == sorted(set(dates)) and len(dates) == len(set(dates))                 # no duplicate dates, ascending
    by = {p["date"]: p for p in j["points"]}
    assert by["2026-10-13"]["wti"] == 95.39 and by["2026-10-13"]["source"] == "eia"      # both had 13 Oct: EIA wins
    assert by["2026-10-14"]["wti"] == 96.34 and by["2026-10-14"]["brent"] == 126.55      # CSV had a blank WTI there: EIA fills it
    assert j["status"] == "DAILY_CLOSE" and j["latest_date"] == "2026-10-20" and j["sources"]["dates_in_both_resolved_to_eia"] >= 2


def test_history_skips_blank_holiday_rows_and_never_returns_a_null_pair(small_csv):
    j = run(service(Recorder(ok), csv_path=small_csv).history(60))
    dates = {p["date"] for p in j["points"]}
    assert "2026-09-29" not in dates and "2026-10-12" not in dates                      # blank in every source
    assert all(p["wti"] is not None or p["brent"] is not None for p in j["points"])
    assert j["sources"]["blank_holiday_rows_skipped"] >= 2


def test_history_window_is_calendar_days_back_from_the_newest_point(small_csv):
    j = run(service(Recorder(ok), csv_path=small_csv).history(7))
    assert j["points"][0]["date"] >= "2026-10-14" and j["points"][-1]["date"] == "2026-10-20"


def test_history_without_a_key_is_csv_only_and_labelled_offline(monkeypatch):
    monkeypatch.setenv("EIA_API_KEY", "")
    j = run(service(Recorder(ok)).history(30))
    assert j["status"] == "OFFLINE_FALLBACK" and j["latest_date"] == "2026-08-18" and j["sources"]["eia_points"] == 0 and j["fallback_reason"] == "no_key"
    assert 15 <= len(j["points"]) <= 25                                                # ~30 calendar days of trading days
    assert len({p["date"] for p in j["points"]}) == len(j["points"])


def test_real_csv_blank_holiday_rows_become_none_not_nan():
    rows = pf.CsvProvider().all_rows()
    assert rows[-1] == {"date": "2026-08-18", "wti": 86.48, "brent": 95.29}
    assert all(r["wti"] is None or r["wti"] == r["wti"] for r in rows)                  # no NaN leaks through
    assert rows[0]["brent"] is None                                                     # Brent starts later than WTI


# ------------------------------------------------------------------ the endpoints
def test_endpoints_answer_with_the_csv_fallback_when_there_is_no_key(monkeypatch):
    monkeypatch.setenv("EIA_API_KEY", "")
    monkeypatch.setattr(pf, "_service", pf.PriceService())
    c = TestClient(app)
    live = c.get("/api/v1/price/live").json()
    assert live["status"] == "OFFLINE_FALLBACK" and live["as_of"] == "2026-08-18" and live["wti"] == 86.48
    hist = c.get("/api/v1/price/history?days=30").json()
    assert hist["status"] == "OFFLINE_FALLBACK" and hist["points"][-1]["date"] == "2026-08-18"
    assert c.get("/api/v1/price/history?days=2").status_code == 422                     # out of range


def test_endpoint_with_a_working_provider_reports_daily_close(monkeypatch):
    monkeypatch.setattr(pf, "_service", service(Recorder(ok)))
    live = TestClient(app).get("/api/v1/price/live").json()
    assert live["status"] == "DAILY_CLOSE" and live["as_of"] == "2026-10-20" and live["wti"] == 107.89


# ------------------------------------------------------------------ the key never leaks
def all_failure_modes():
    return [ok, lambda r: httpx.Response(503, text="boom"), lambda r: httpx.Response(403, json={"error": {"code": "API_KEY_INVALID", "message": "bad"}}),
            lambda r: httpx.ReadTimeout("slow"), lambda r: httpx.ConnectError("no route"), lambda r: httpx.Response(429), lambda r: httpx.Response(200, text="junk")]


def test_the_key_never_appears_in_any_response_or_any_log_line(caplog, monkeypatch):
    caplog.set_level(logging.DEBUG)                                                     # capture EVERY logger, httpx and httpcore included
    monkeypatch.setattr(pf, "_service", None)
    texts = []
    for handler in all_failure_modes():
        svc = service(Recorder(handler))
        texts.append(json.dumps(run(svc.live())))
        texts.append(json.dumps(run(svc.history(30))))
        monkeypatch.setattr(pf, "_service", svc)
        c = TestClient(app)
        for path in ("/api/v1/price/live", "/api/v1/price/history?days=30"):
            r = c.get(path)
            texts.append(r.text + json.dumps(dict(r.headers)))
    assert not any(SECRET in t for t in texts), "the API key appeared in a response"
    assert not any("api_key" in t.lower() for t in texts), "an api_key parameter appeared in a response"
    assert SECRET not in caplog.text, "the API key appeared in a log line"
    assert "api_key=" + SECRET not in caplog.text


def test_exceptions_raised_by_the_adapter_never_contain_the_key_or_a_url():
    transport = httpx.MockTransport(Recorder(lambda r: httpx.ConnectError("could not connect to host")))
    p = pf.EiaProvider(SECRET, transport=transport, sleep=no_sleep)
    with pytest.raises(pf.PriceFeedError) as e:
        run(p.fetch_recent(30))
    assert SECRET not in str(e.value) and "http" not in str(e.value).lower() and "api_key" not in str(e.value)


def test_the_log_redaction_removes_a_key_even_if_some_code_logs_the_full_url(caplog, monkeypatch):
    caplog.set_level(logging.DEBUG)
    logging.getLogger("anything").info("GET https://api.eia.gov/v2/x?api_key=%s&frequency=daily", SECRET)
    logging.getLogger("anything").warning("plain mention of %s without the parameter name", SECRET)
    assert SECRET not in caplog.text and "api_key=REDACTED" in caplog.text and caplog.text.count("REDACTED") >= 2
    assert pf.redact(f"x api_key=abcdef&y=1") == "x api_key=REDACTED&y=1"


def test_httpx_info_logging_that_carries_urls_is_switched_off():
    assert logging.getLogger("httpx").level >= logging.WARNING


def _scan(root: Path, needles: list[str], suffixes=(".ts", ".tsx", ".js", ".mjs", ".css", ".html", ".json", ".map")):
    hits = []
    for p in root.rglob("*"):
        if p.is_file() and p.suffix in suffixes and "node_modules" not in p.parts and p.stat().st_size < 8_000_000:
            text = p.read_text(encoding="utf-8", errors="ignore")
            for n in needles:
                if n and n in text:
                    hits.append((str(p.relative_to(FRONTEND)), n[:8] + "..."))
    return hits


def real_key():
    m = re.search(r"^\s*EIA_API_KEY\s*=\s*(.+)$", (BACKEND / ".env").read_text(encoding="utf-8"), re.M) if (BACKEND / ".env").exists() else None
    return m.group(1).strip().strip("\"'") if m else ""


def test_the_frontend_source_and_built_bundle_never_contain_a_key_or_the_variable_name():
    needles = [SECRET, "EIA_API_KEY", "api_key=", real_key()]
    sources = [FRONTEND / "src", FRONTEND / "dist", FRONTEND / "index.html"]
    hits = []
    for s in sources:
        if s.is_dir():
            hits += _scan(s, needles)
        elif s.is_file():
            hits += [(s.name, n[:8]) for n in needles if n and n in s.read_text(encoding="utf-8", errors="ignore")]
    assert not hits, f"key material found in the frontend: {hits}"


def test_the_hazard_is_real_without_the_protections_httpx_logs_the_key(caplog):
    """Guard the guard: with redaction and the httpx log level undone, a plain request DOES put the key into a log line.
    This is why the protections exist, and it proves the leak tests above are capable of failing."""
    saved_factory, saved_level = logging.getLogRecordFactory(), logging.getLogger("httpx").level
    try:
        logging.setLogRecordFactory(logging.LogRecord)                  # remove the redacting factory
        logging.getLogger("httpx").setLevel(logging.INFO)               # httpx logs 'HTTP Request: GET <full url>' at INFO
        caplog.set_level(logging.INFO)
        p = pf.EiaProvider(SECRET, transport=httpx.MockTransport(Recorder(ok)), sleep=no_sleep)
        run(p.fetch_recent(30))
        assert SECRET in caplog.text, "expected httpx to log the key when unprotected; the leak tests would be meaningless otherwise"
    finally:
        logging.setLogRecordFactory(saved_factory)
        logging.getLogger("httpx").setLevel(saved_level)
