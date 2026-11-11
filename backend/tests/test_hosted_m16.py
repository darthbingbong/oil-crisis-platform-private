"""M16 hosted mode: per-source flags, cache-only serving, the Claude caps, the guards, the estimated-distance set and the scheduled refresh.
No test reaches a provider: every network call is a counting fake."""

import asyncio
import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from news import claude_governor as gov
from news.models import Article
from services import hosted
from services.guards import FRIENDLY_500, HostedGuards, RateTable

ROOT = Path(__file__).resolve().parent.parent.parent


@pytest.fixture
def host(monkeypatch):
    monkeypatch.setenv("HOSTED_MODE", "1")
    for k in list(__import__("os").environ):
        if k.startswith("HOSTED_ENABLE_"):
            monkeypatch.delenv(k)


# ------------------------------------------------------------------------------------------------------------------------ flags
def test_local_mode_changes_nothing(monkeypatch):
    monkeypatch.delenv("HOSTED_MODE", raising=False)
    assert not hosted.hosted_mode() and not hosted.cache_only() and not hosted.estimated_distances()
    assert all(hosted.enabled(s) for s in hosted.SOURCES)
    assert hosted.cors_origins() == ["*"]


def test_hosted_defaults_are_the_safe_side(host):
    on = {s for s in hosted.SOURCES if hosted.enabled(s)}
    assert on == {"eia", "gdelt", "tradingview", "gem", "anthropic"}
    assert not any(hosted.enabled(s) for s in ("shipfinder", "aisstream", "newsapi", "alphavantage", "shipfinder_distances"))
    assert hosted.estimated_distances() and hosted.cors_origins() == []


def test_each_flag_is_separate_and_unknown_source_is_an_error(host, monkeypatch):
    monkeypatch.setenv("HOSTED_ENABLE_SHIPFINDER", "1")
    assert hosted.enabled("shipfinder") and not hosted.enabled("newsapi")
    monkeypatch.setenv("HOSTED_ENABLE_EIA", "0")
    assert not hosted.enabled("eia") and hosted.enabled("gdelt")
    with pytest.raises(KeyError):
        hosted.enabled("nope")


def test_cors_only_the_frontend_origin(host, monkeypatch):
    monkeypatch.setenv("FRONTEND_ORIGIN", "https://site.example/")
    assert hosted.cors_origins() == ["https://site.example"]


def test_public_config_has_no_secret(host, monkeypatch):
    for k in ("EIA_API_KEY", "ANTHROPIC_API_KEY", "AIS_API_KEY", "NEWSAPI_API_KEY", "AISSTREAM_API_KEY"):
        monkeypatch.setenv(k, "SECRETVALUE" + k)
    text = json.dumps(hosted.public_config())
    assert "SECRETVALUE" not in text
    cfg = hosted.public_config()
    assert cfg["vessels"] == "SIMULATED_ONLY" and cfg["voyage_distances"] == "estimated"
    assert cfg["sources"]["gem"]["attribution"] and "not confirmed" in cfg["sources"]["gem"]["attribution"]
    assert cfg["sources"]["shipfinder"]["attribution"] is None and cfg["sources"]["newsapi"]["enabled"] is False
    assert cfg["disclaimer"] == "Educational project. Figures are model estimates, not forecasts or financial advice."


# ------------------------------------------------------------------------------------------------------------ disabled sources
def test_shipfinder_off_hosted_blocks_calls_and_saved_data(host, monkeypatch):
    from services import ais_watchlist as wl
    from services import shipfinder as sf
    assert sf.enabled() is False
    assert wl.load_watchlist() is None and wl.load_track(538006502) is None
    client = sf.ShipFinderClient(key="k", transport=None)
    with pytest.raises(sf.AISError) as e:
        client.call("vessel_position", {"mmsi": 1}, "test")
    assert e.value.kind == "disabled"


def test_hosted_watchlist_endpoint_is_none(host):
    import main
    c = TestClient(main.app)
    assert c.get("/api/v1/vessels/watchlist").json()["status"] == "NONE"
    assert c.get("/api/v1/hosted").json()["vessels"] == "SIMULATED_ONLY"


def test_aisstream_and_newsapi_off_hosted(host, monkeypatch):
    from news import ingestion
    from services import ais_feed
    monkeypatch.setenv("AISSTREAM_API_KEY", "x")
    monkeypatch.setenv("NEWSAPI_API_KEY", "y")
    assert ais_feed.get_key() == ""
    monkeypatch.setattr(ingestion.httpx, "get", lambda *a, **k: pytest.fail("NewsAPI must not be called in hosted mode"))
    assert ingestion.fetch_live_articles() == []
    monkeypatch.setenv("HOSTED_ENABLE_AISSTREAM", "1")
    assert ais_feed.get_key() == "x"


# ------------------------------------------------------------------------------------------------------------------- distances
def test_estimated_set_equals_the_v1_numbers(host):
    from services.route_data import all_routes
    before = json.loads((ROOT / "docs" / "m10_voyage_before.json").read_text(encoding="utf-8"))["routes"]
    got = {r["id"]: r for r in all_routes()}
    for rid, b in before.items():
        if b.get("baseline_voyage_days") is not None:
            assert got[rid]["baseline_voyage_days"] == b["baseline_voyage_days"], rid
        if b.get("default_detour_days") is not None:
            assert got[rid]["default_detour_days"] == b["default_detour_days"], rid
    assert got["suez"]["voyage_derivation"]["is_estimate"] is True and "provider" not in got["suez"]["voyage_derivation"]
    assert "plan_id" not in json.dumps(got["suez"]["voyage_derivation"])


def test_local_mode_keeps_the_shipfinder_set(monkeypatch):
    monkeypatch.delenv("HOSTED_MODE", raising=False)
    from services.route_data import get_route
    raw = next(r for r in json.loads((ROOT / "backend" / "data" / "routes.json").read_text(encoding="utf-8"))["routes"] if r["id"] == "suez")
    assert get_route("suez")["baseline_voyage_days"] == raw["baseline_voyage_days"] and get_route("suez")["default_detour_days"] == raw["default_detour_days"]    # local mode serves the file as it is
    if raw["voyage_derivation"].get("provider"):                       # the author's copy
        assert raw["baseline_voyage_days"] == 19.5 and raw["default_detour_days"] == 14.0
    else:                                                              # the public edition: the earlier estimates
        assert raw["baseline_voyage_days"] == 21.2 and raw["default_detour_days"] == 12.7


def test_estimated_voyages_does_not_change_its_input():
    from services.voyage_sets import estimated_voyages
    doc = json.loads((ROOT / "backend" / "data" / "routes.json").read_text(encoding="utf-8"))
    snapshot = json.dumps(doc, sort_keys=True)
    estimated_voyages(doc)
    assert json.dumps(doc, sort_keys=True) == snapshot


# --------------------------------------------------------------------------------------------------------------- cache-only
def test_price_visitors_never_reach_eia_but_refresh_does(host, monkeypatch):
    from services import price_feed as pf
    monkeypatch.setenv("EIA_API_KEY", "k")
    calls = []

    class Fake:
        last_latency_ms = 5

        async def fetch_recent(self, days):
            calls.append(days)
            return [{"date": "2026-11-03", "wti": 99.0, "brent": 107.0}, {"date": "2026-11-02", "wti": 98.0, "brent": 106.0}]

    svc = pf.PriceService(provider_factory=lambda key: Fake())
    first = asyncio.run(svc.live())
    assert calls == [] and first["status"] == "OFFLINE_FALLBACK" and first["fallback_reason"] == "cache_only"
    assert "refresh" in first["fallback_message"]
    out = asyncio.run(svc.refresh())
    assert len(calls) == 1 and out["status"] == "DAILY_CLOSE"
    again = asyncio.run(svc.live())
    assert len(calls) == 1 and again["status"] == "DAILY_CLOSE" and again["cached"] is True


def test_news_visitors_never_reach_gdelt_but_refresh_does(host, tmp_path):
    from services import news_feed as nf
    from services.cache import TTLCache
    route = {"id": "suez", "name": "Suez Canal", "type": "chokepoint"}
    calls = []

    async def fake(query):
        calls.append(query)
        return [{"title": "Tanker rerouted around Suez Canal after attack", "url": "https://example.com/a", "seendate": "20261110T120000Z", "domain": "example.com", "language": "English"}]

    cache = TTLCache(tmp_path, nf.HOSTED_CACHE_TTL_SECONDS)
    empty = asyncio.run(nf.get_route_news(route, cache=cache, fetch=fake))
    assert calls == [] and empty["feed_status"] in ("snapshot", "unavailable")
    done = asyncio.run(nf.get_route_news(route, cache=cache, fetch=fake, force=True))
    assert len(calls) == 1 and done["feed_status"] == "ok"
    served = asyncio.run(nf.get_route_news(route, cache=cache, fetch=fake))
    assert len(calls) == 1 and served["feed_status"] == "ok" and served["refreshing"] is False


def test_news_older_than_a_day_is_labelled_with_its_age_not_refetched(host, tmp_path):
    from services import news_feed as nf
    from services.cache import TTLCache
    route = {"id": "suez", "name": "Suez Canal", "type": "chokepoint"}
    clock = [1_000_000.0]
    cache = TTLCache(tmp_path, nf.HOSTED_CACHE_TTL_SECONDS, clock=lambda: clock[0])
    cache.put("news_suez", {"items": [{"title": "t", "source": "s", "published_at": "2026-11-10T00:00:00Z", "url": "https://e.com", "tag": "general"}]})
    clock[0] += nf.HOSTED_CACHE_TTL_SECONDS + 60

    async def boom(q):
        raise AssertionError("a visitor must not reach GDELT")

    r = asyncio.run(nf.get_route_news(route, cache=cache, fetch=boom, stale_while_revalidate=True))
    assert r["feed_status"] == "stale" and r["refreshing"] is False and r["count"] == 1 and r["last_updated"]


# ---------------------------------------------------------------------------------------------------------------- Claude caps
def art(title):
    return Article(title=title, description="d", url="https://example.com/" + title.replace(" ", "-"), source="s", published_at="2026-11-10")


def fake_call(counter):
    from news.classifier_rules import classify_article as rules

    def call(article):
        counter.append(article.title)
        return rules(article), 1000, 200
    return call


def test_each_headline_is_classified_once_then_cached(tmp_path, monkeypatch):
    for k in ("CLAUDE_DAILY_CALL_CAP", "CLAUDE_MONTHLY_USD_CAP"):
        monkeypatch.delenv(k, raising=False)
    led, n = tmp_path / "l.json", []
    a = art("Houthi missile attack on tanker in Red Sea closes Suez route")
    e1, who1 = gov.classify(a, ledger=led, call=fake_call(n))
    e2, who2 = gov.classify(art("houthi missile attack on tanker in red sea closes suez route"), ledger=led, call=fake_call(n))
    assert (who1, who2) == ("claude", "claude") and len(n) == 1 and e1 == e2
    u = gov.usage(led)
    assert u["calls_today"] == 1 and u["headlines_cached"] == 1 and u["usd_this_month"] == pytest.approx(0.01, abs=1e-4)


def test_daily_cap_falls_back_to_rules(tmp_path, monkeypatch):
    monkeypatch.setenv("CLAUDE_DAILY_CALL_CAP", "2")
    led, n = tmp_path / "l.json", []
    out = [gov.classify(art(f"Oil tanker attack number {i} near Hormuz"), ledger=led, call=fake_call(n))[1] for i in range(4)]
    assert out == ["claude", "claude", "rules", "rules"] and len(n) == 2


def test_monthly_spend_cap_falls_back_to_rules(tmp_path, monkeypatch):
    monkeypatch.setenv("CLAUDE_MONTHLY_USD_CAP", "0.012")           # one call costs $0.01 at 1000 in / 200 out and $5 / $25 per million
    led, n = tmp_path / "l.json", []
    out = [gov.classify(art(f"Crude supply outage report {i}"), ledger=led, call=fake_call(n))[1] for i in range(3)]
    assert out == ["claude", "claude", "rules"] and len(n) == 2 and gov.usage(led)["usd_this_month"] >= 0.012


def test_a_failed_call_falls_back_and_still_counts_as_a_call(tmp_path):
    led = tmp_path / "l.json"

    def boom(a):
        raise RuntimeError("api down")
    _, who = gov.classify(art("Sanctions on crude exports announced"), ledger=led, call=boom)
    assert who == "rules" and gov.usage(led)["calls_today"] == 1 and gov.usage(led)["headlines_cached"] == 0


def test_classifier_choice_follows_the_flag(host, monkeypatch):
    from news import classify
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    assert classify.active_classifier_name() == "claude"
    monkeypatch.setenv("HOSTED_ENABLE_ANTHROPIC", "0")
    assert classify.active_classifier_name() == "rules"


# ------------------------------------------------------------------------------------------------------------------- guards
def guarded_app(table):
    app = FastAPI()
    app.add_middleware(HostedGuards, table=table)

    @app.get("/api/v1/x")
    def x():
        return {"ok": True}

    @app.post("/api/v1/simulate")
    def sim():
        return {"ok": True}

    @app.post("/api/v1/news/poll-now")
    def poll():
        return {"polled": True}

    @app.get("/api/v1/boom")
    def boom():
        raise RuntimeError("secret path C:\\x\\y and key sk-ant-123")

    @app.get("/plain")
    def plain():
        return {"ok": True}
    return app


def test_rate_limit_and_retry_after(host):
    t = [0.0]
    c = TestClient(guarded_app(RateTable(clock=lambda: t[0])))
    codes = [c.get("/api/v1/x").status_code for _ in range(121)]
    assert codes[:120] == [200] * 120 and codes[120] == 429
    r = c.get("/api/v1/x")
    assert r.status_code == 429 and r.headers["retry-after"] and r.json()["error"] == "rate_limited" and "wait" in r.json()["message"]
    assert c.get("/plain").status_code == 200                     # not an API path
    t[0] += 61
    assert c.get("/api/v1/x").status_code == 200


def test_calculator_has_its_own_lower_limit(host):
    c = TestClient(guarded_app(RateTable(clock=lambda: 0.0)))
    codes = [c.post("/api/v1/simulate").status_code for _ in range(31)]
    assert codes[:30] == [200] * 30 and codes[30] == 429


def test_developer_endpoints_are_closed_when_hosted(host):
    c = TestClient(guarded_app(RateTable()))
    r = c.post("/api/v1/news/poll-now")
    assert r.status_code == 404 and r.json()["error"] == "not_available"


def test_guards_do_nothing_in_local_mode(monkeypatch):
    monkeypatch.delenv("HOSTED_MODE", raising=False)
    c = TestClient(guarded_app(RateTable()))
    assert all(c.get("/api/v1/x").status_code == 200 for _ in range(150))
    assert c.post("/api/v1/news/poll-now").status_code == 200


def test_unexpected_error_is_a_friendly_sentence_without_secrets(host):
    c = TestClient(guarded_app(RateTable()), raise_server_exceptions=False)
    r = c.get("/api/v1/boom")
    assert r.status_code == 500 and r.json() == {"error": "server_error", "message": FRIENDLY_500}
    assert "sk-ant" not in r.text and "C:\\" not in r.text and "Traceback" not in r.text


def test_the_real_app_has_the_friendly_handler_in_every_mode():
    import main
    from services.guards import friendly_500
    assert main.app.exception_handlers.get(Exception) is friendly_500


# ------------------------------------------------------------------------------------------------------------------- schedule
def test_scheduled_refresh_runs_each_step_and_isolates_failures(host):
    from services import refresh
    seen = {"price": 0, "news": [], "classify": []}

    async def price():
        seen["price"] += 1
        return {"status": "DAILY_CLOSE"}

    async def news(route, force=False):
        assert force is True
        seen["news"].append(route["id"])
        if route["id"] == "malacca":
            raise RuntimeError("gdelt down")
        return {"feed_status": "ok" if route["id"] != "suez" else "unavailable", "items": [{"title": route["id"]}]}

    async def cls(items):
        seen["classify"].append(items[0]["title"])
        return 1
    rep = asyncio.run(refresh.refresh_all(gap=0, price_fn=price, news_fn=news, classify_fn=cls))
    assert seen["price"] == 1 and rep["price"] == "DAILY_CLOSE"
    assert rep["news"]["malacca"] == "FAILED" and rep["news"]["suez"] == "unavailable" and rep["news"]["hormuz"] == "ok"
    assert "suez" not in seen["classify"] and "malacca" not in seen["classify"] and "hormuz" in seen["classify"]
    assert len(seen["news"]) == len(set(seen["news"])) >= 6


def test_refresh_respects_the_source_flags(host, monkeypatch):
    from services import refresh
    monkeypatch.setenv("HOSTED_ENABLE_EIA", "0")
    monkeypatch.setenv("HOSTED_ENABLE_GDELT", "0")

    async def nope(*a, **k):
        raise AssertionError("a disabled source must not be called")
    rep = asyncio.run(refresh.refresh_all(gap=0, price_fn=nope, news_fn=nope, classify_fn=nope))
    assert rep == {"price": None, "news": {}, "classified": 0}


def test_refresh_interval(monkeypatch):
    from services import refresh
    monkeypatch.delenv("REFRESH_INTERVAL_HOURS", raising=False)
    assert refresh.interval_seconds() == 24 * 3600
    monkeypatch.setenv("REFRESH_INTERVAL_HOURS", "6")
    assert refresh.interval_seconds() == 6 * 3600
    monkeypatch.setenv("REFRESH_INTERVAL_HOURS", "junk")
    assert refresh.interval_seconds() == 24 * 3600


def test_estimated_set_carries_no_provider_wording_except_the_one_disclosure():
    """Found by the hosted browser run: the default-detour note still said 'ShipFinder planned distances' while the numbers were the estimates."""
    from services.voyage_sets import estimated_voyages
    doc = estimated_voyages(json.loads((ROOT / "backend" / "data" / "routes.json").read_text(encoding="utf-8")))
    meta_note = doc["_meta"]["voyage_distances"]["note"]
    body = json.dumps({**doc, "_meta": {k: v for k, v in doc["_meta"].items() if k != "voyage_distances"}})
    for banned in ("ShipFinder", "elaneglobal", "plan_id", "ais_route_plans", "planned sea distance", "retrieved 2026-11-02"):
        assert banned not in body, banned
    assert "ShipFinder" in meta_note and "not republished" in meta_note
    suez = next(r for r in doc["routes"] if r["id"] == "suez")
    assert "earlier estimates" in suez["default_detour_days_note"] and suez["default_detour_days"] == 12.7
