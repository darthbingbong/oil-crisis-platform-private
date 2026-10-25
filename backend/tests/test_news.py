"""M4 route news: classifier, query building, filtering, de-duplication, cache, stale fallback, empty state, retries, endpoint.

No test here touches the real network: the GDELT call is injected or served by an httpx MockTransport.
"""

import asyncio

import httpx
import pytest
from fastapi.testclient import TestClient

from main import app
from services import news_feed as nf
from services.cache import TTLCache
from services.news_classifier import TAGS, classify_headline

HORMUZ = {"id": "hormuz", "name": "Strait of Hormuz"}
RQ = nf.ROUTE_QUERIES["hormuz"]


def rec(title, url=None, seen="20260824T101500Z", domain="example.com", language="English"):
    return {"title": title, "url": url or f"https://{domain}/{abs(hash(title))}", "seendate": seen, "domain": domain, "language": language,
            "socialimage": "x", "sourcecountry": "US"}


class Clock:
    def __init__(self, t=1_000_000.0):
        self.t = t

    def __call__(self):
        return self.t


@pytest.fixture(autouse=True)
def reset_simulation(tmp_path, monkeypatch):
    """Every test starts with the simulation off and its own empty cache directory."""
    nf.set_simulation("off")
    monkeypatch.setattr(nf, "_cache", TTLCache(tmp_path / "cache", nf.CACHE_TTL_SECONDS))
    yield
    nf.set_simulation("off")


# ------------------------------------------------------------------ classifier
@pytest.mark.parametrize("title,tag", [
    ("Houthi drone attack hits tanker near Bab el-Mandeb", "attack"),
    ("Missile strike damages oil vessel in Gulf of Oman", "attack"),
    ("Iran seizes tanker in Strait of Hormuz", "attack"),
    ("US imposes new sanctions on tankers carrying Iranian oil", "sanctions"),
    ("EU agrees oil price cap extension on Russian crude", "sanctions"),
    ("Strait of Hormuz closed to commercial shipping", "disruption"),
    ("Tankers rerouted around Africa as Red Sea transit halts", "disruption"),
    ("Suez Canal traffic delayed by congestion", "disruption"),
    ("VLCC freight rates climb on Hormuz risk premium", "shipping"),
    ("Crude exports through Malacca rise in July", "shipping"),
    ("Oil tanker passes through the Bosphorus", "shipping"),
    ("Government unveils new energy strategy", "general"),
])
def test_classifier_assigns_expected_tag(title, tag):
    assert classify_headline(title)[0] == tag


def test_classifier_priority_attack_beats_everything():
    assert classify_headline("Sanctions follow drone attack on tanker, shipping halted")[0] == "attack"
    assert classify_headline("Sanctions halt shipping of crude")[0] == "sanctions"


def test_classifier_is_whole_word_not_substring():
    assert classify_headline("Targeted sanctions announced")[0] == "sanctions"      # 'targeted' is not an attack word
    assert classify_headline("Closer ties between the two ports' owners")[0] == "shipping"  # 'closer' is not 'closed'
    assert classify_headline("Dronelike shapes in the lobby")[0] == "general"       # 'drone' only as a whole word


def test_classifier_tags_are_from_the_declared_set_and_it_is_pure():
    for t in ["a", "b tanker", "c attack", "", "SANCTIONS"]:
        tag, matched = classify_headline(t)
        assert tag in TAGS and (tag == "general") == (matched is None)
    assert classify_headline("drone attack") == classify_headline("drone attack")


# ------------------------------------------------------------------ queries and filtering
def test_query_has_phrases_context_and_english_filter():
    q = nf.build_query(RQ)
    assert q.startswith('("Strait of Hormuz" OR Hormuz) (oil OR tanker')
    assert q.endswith("sourcelang:english")
    assert nf.build_query(nf.ROUTE_QUERIES["cpc"]).count('"CPC pipeline"') == 1


def test_every_route_has_a_query_and_cpc_avoids_the_bare_ambiguous_acronym():
    from services.route_data import all_routes
    for r in all_routes():
        assert r["id"] in nf.ROUTE_QUERIES, r["id"]
    assert all(t != "cpc" for t in nf.ROUTE_QUERIES["cpc"].title_terms)


def test_parse_seendate():
    assert nf.parse_seendate("20260824T101500Z") == "2026-08-24T10:15:00Z"
    assert nf.parse_seendate("garbage") is None and nf.parse_seendate(None) is None


def test_headline_must_mention_the_route():
    raw = [rec("Hormuz tanker traffic slows"), rec("Oil prices rise on Middle East worries")]
    items = nf.normalize_articles(raw, RQ)
    assert [i["title"] for i in items] == ["Hormuz tanker traffic slows"]


def test_broad_terms_need_a_shipping_word_in_the_headline():
    bab = nf.ROUTE_QUERIES["bab_el_mandeb"]
    raw = [rec("Coalition intercepts Houthi missiles targeting Saudi cities"),           # Yemen war, not the route
           rec("Yemen Taiz faces water crisis as Houthis tighten siege"),
           rec("Houthi drone hits tanker in the Gulf of Aden", domain="b.com"),            # shipping word -> about the route
           rec("Oil prices jump on Houthi attacks", domain="c.com"),
           rec("Red Sea transit slows for tankers", domain="d.com")]                      # strict route term, no context needed
    titles = {i["title"] for i in nf.normalize_articles(raw, bab)}
    assert titles == {"Houthi drone hits tanker in the Gulf of Aden", "Oil prices jump on Houthi attacks", "Red Sea transit slows for tankers"}


def test_title_cleanup_removes_encoding_debris_and_tokenizer_spacing():
    assert nf.clean_title("Turkiye to tell Yemen FM Houthi attacks unacceptable  � The Frontier Post") == "Turkiye to tell Yemen FM Houthi attacks unacceptable"
    assert nf.clean_title("Oil prices jump US$3 on Houthi attacks , oil spill , highest since April") == "Oil prices jump US$3 on Houthi attacks, oil spill, highest since April"
    assert nf.clean_title("Plain headline stays plain") == "Plain headline stays plain"


def test_strike_is_military_by_default_and_a_labour_action_only_with_a_labour_word():
    # real headlines from the GDELT sample that were mis-tagged before this rule
    assert classify_headline("Trump Says US Could Strike Iran Soon, Hints at Deal")[0] == "attack"
    assert classify_headline("Diplomats leave Saudi Arabia following Houthi strikes")[0] == "attack"
    assert classify_headline("US contemplates fresh strikes on Iran")[0] == "attack"
    assert classify_headline("Port workers strike over pay")[0] == "disruption"
    assert classify_headline("Dockers walkout: union to strike at Rotterdam")[0] == "disruption"


def test_damaged_vessels_are_a_disruption_not_just_shipping():
    assert classify_headline("Iran says 7 tankers damaged in Strait of Hormuz, and other Mideast news")[0] == "disruption"


def test_publisher_tail_after_a_dash_or_dot_is_removed_but_a_long_last_segment_is_kept():
    assert nf.clean_title("Houthi Strikes – NaturalNews. com") == "Houthi Strikes"
    assert nf.clean_title("Hindu businessmen eye Asian Buyers · EMSNow") == "Hindu businessmen eye Asian Buyers"
    assert nf.clean_title("Heavy airstrikes hit Houthi - held Sanaa amid escalating Yemen conflict - Xinhua") == "Heavy airstrikes hit Houthi-held Sanaa amid escalating Yemen conflict"
    assert nf.clean_title("Oil falls - analysts say the market has priced in the whole supply risk") == "Oil falls - analysts say the market has priced in the whole supply risk"


def test_language_filter():
    raw = [rec("Hormuz tanker traffic slows"), rec("Tráfico de petroleros en Ormuz y Hormuz", language="Spanish"),
           rec("Hormuz shipping news", language="")]
    titles = [i["title"] for i in nf.normalize_articles(raw, RQ)]
    assert "Tráfico de petroleros en Ormuz y Hormuz" not in titles and len(titles) == 2


def test_near_duplicate_headlines_are_removed_but_distinct_ones_kept():
    raw = [
        rec("Iran threatens to close Strait of Hormuz to tankers - Reuters", seen="20260824T120000Z"),
        rec("Iran threatens to close Strait of Hormuz to tankers | Bloomberg", seen="20260824T110000Z", domain="b.com"),
        rec("Iran threatens to close the Strait of Hormuz to oil tankers", seen="20260824T100000Z", domain="c.com"),
        rec("Hormuz insurance premiums double for tanker owners", seen="20260824T090000Z", domain="d.com"),
    ]
    items = nf.normalize_articles(raw, RQ)
    assert len(items) == 2
    assert items[0]["published_at"] > items[1]["published_at"]            # newest first, the newest duplicate wins
    assert items[0]["source"] == "example.com"


def test_same_url_is_deduped_and_bad_records_skipped():
    raw = [rec("Hormuz tanker one", url="https://a.com/x"), rec("Hormuz tanker one again", url="https://a.com/x"),
           rec("", url="https://a.com/y"), rec("Hormuz no link", url="not-a-url"), rec("Hormuz bad date", seen="nope")]
    assert len(nf.normalize_articles(raw, RQ)) == 1


def test_items_carry_only_headline_source_date_link_and_tag():
    item = nf.normalize_articles([rec("Hormuz tanker attack reported")], RQ)[0]
    assert set(item) == {"title", "source", "published_at", "url", "tag"}
    assert item["tag"] == "attack"


def test_list_is_capped():
    raw = [rec(f"Hormuz story number {i} with unique words {i*7919}", seen=f"202608{(i % 28) + 1:02d}T100000Z") for i in range(40)]
    assert len(nf.normalize_articles(raw, RQ)) <= nf.MAX_ITEMS


# ------------------------------------------------------------------ cache, stale, empty
def run(coro):
    return asyncio.run(coro)


def test_fresh_fetch_then_cache_hit_without_calling_the_feed_again():
    clock = Clock()
    cache = TTLCache(None, 1200, clock)
    calls = []

    async def fetch(q):
        calls.append(q)
        return [rec("Hormuz tanker traffic slows")]

    a = run(nf.get_route_news(HORMUZ, cache=cache, fetch=fetch))
    clock.t += 600
    b = run(nf.get_route_news(HORMUZ, cache=cache, fetch=fetch))
    assert len(calls) == 1 and a["stale"] is False and b["stale"] is False
    assert a["feed_status"] == "ok" and a["count"] == 1 and a["last_updated"] == b["last_updated"]


def test_cache_expires_after_ttl_and_refetches():
    clock = Clock()
    cache = TTLCache(None, 1200, clock)
    n = {"calls": 0}

    async def fetch(q):
        n["calls"] += 1
        return [rec("Hormuz tanker traffic slows")]

    run(nf.get_route_news(HORMUZ, cache=cache, fetch=fetch))
    clock.t += 1201
    run(nf.get_route_news(HORMUZ, cache=cache, fetch=fetch))
    assert n["calls"] == 2


def test_feed_failure_returns_last_cached_result_marked_stale_with_its_time():
    clock = Clock()
    cache = TTLCache(None, 1200, clock)

    async def good(q):
        return [rec("Hormuz tanker traffic slows")]

    async def broken(q):
        raise nf.FeedError("boom")

    first = run(nf.get_route_news(HORMUZ, cache=cache, fetch=good))
    clock.t += 5000                                               # well past the ttl
    stale = run(nf.get_route_news(HORMUZ, cache=cache, fetch=broken))
    assert stale["stale"] is True and stale["feed_status"] == "stale"
    assert stale["items"] == first["items"] and stale["last_updated"] == first["last_updated"]
    assert "not responding" in stale["message"] and first["last_updated"] in stale["message"]


def test_failure_with_nothing_cached_says_so():
    async def broken(q):
        raise nf.FeedError("boom")

    r = run(nf.get_route_news(HORMUZ, cache=TTLCache(None, 1200, Clock()), fetch=broken))
    assert r["feed_status"] == "unavailable" and r["items"] == [] and r["last_updated"] is None and r["stale"] is False
    assert "nothing has been cached" in r["message"]


def test_empty_result_has_a_clear_message_and_is_not_stale():
    async def empty(q):
        return [rec("Unrelated oil story with no route name")]

    r = run(nf.get_route_news(HORMUZ, cache=TTLCache(None, 1200, Clock()), fetch=empty))
    assert r["feed_status"] == "empty" and r["count"] == 0 and r["stale"] is False
    assert "No recent headlines" in r["message"] and r["last_updated"] is not None


def test_cache_survives_in_a_new_cache_object_via_disk(tmp_path):
    clock = Clock()
    c1 = TTLCache(tmp_path, 1200, clock)
    c1.put("k", {"items": [1]})
    c2 = TTLCache(tmp_path, 1200, clock)
    assert c2.get("k")["payload"] == {"items": [1]} and c2.is_fresh(c2.get("k"))


# ------------------------------------------------------------------ GDELT client: retries and backoff
_REAL_ASYNC_CLIENT = httpx.AsyncClient   # captured once, so patching twice in one test never wraps an already-patched client


def _patch_transport(monkeypatch, handler):
    monkeypatch.setattr(nf.httpx, "AsyncClient", lambda **kw: _REAL_ASYNC_CLIENT(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(nf, "MIN_REQUEST_INTERVAL_SECONDS", 0.0)
    monkeypatch.setattr(nf, "BACKOFF_BASE_SECONDS", 0.0)


def test_gdelt_client_retries_then_succeeds(monkeypatch):
    seen = []

    def handler(request):
        seen.append(request.url.params)
        if len(seen) < 3:
            return httpx.Response(503)
        return httpx.Response(200, json={"articles": [rec("Hormuz tanker traffic slows")]})

    _patch_transport(monkeypatch, handler)
    out = run(nf.gdelt_fetch("(Hormuz) (oil) sourcelang:english"))
    assert len(out) == 1 and len(seen) == 3
    p = seen[0]
    assert p["mode"] == "artlist" and p["format"] == "json" and p["timespan"] == "7d" and p["sort"] == "datedesc"


def test_gdelt_429_uses_the_longer_rate_limit_backoff_and_reports_the_reason(monkeypatch):
    sleeps = []
    real_sleep = asyncio.sleep

    async def fake_sleep(s):
        sleeps.append(s)
        await real_sleep(0)

    _patch_transport(monkeypatch, lambda r: httpx.Response(429, text="Please limit requests to one every 5 seconds"))
    monkeypatch.setattr(nf.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(nf, "RATE_LIMIT_BACKOFF_SECONDS", 15.0)
    with pytest.raises(nf.FeedError) as err:
        run(nf.gdelt_fetch("q"))
    assert "HTTP 429" in str(err.value) and "5 seconds" in str(err.value)
    assert 15.0 in sleeps and nf.RETRIES == len([s for s in sleeps if s == 15.0])   # one long wait before each retry


def test_gdelt_client_gives_up_after_retries_with_a_feed_error(monkeypatch):
    calls = []

    def handler(request):
        calls.append(1)
        raise httpx.ConnectTimeout("slow")

    _patch_transport(monkeypatch, handler)
    with pytest.raises(nf.FeedError):
        run(nf.gdelt_fetch("q"))
    assert len(calls) == nf.RETRIES + 1


def test_gdelt_client_handles_empty_body_and_non_json(monkeypatch):
    _patch_transport(monkeypatch, lambda r: httpx.Response(200, text=""))
    assert run(nf.gdelt_fetch("q")) == []
    _patch_transport(monkeypatch, lambda r: httpx.Response(200, text="The specified phrase is too short."))
    with pytest.raises(nf.FeedError):
        run(nf.gdelt_fetch("q"))


# ------------------------------------------------------------------ endpoint and the dev failure switch
client = TestClient(app)


def _patch_feed(monkeypatch, records):
    async def fake(q):
        return records

    monkeypatch.setattr(nf, "gdelt_fetch", fake)


def test_endpoint_returns_tagged_headlines(monkeypatch):
    _patch_feed(monkeypatch, [rec("Hormuz tanker attack reported"), rec("Hormuz sanctions widen on tankers", domain="b.com")])
    j = client.get("/api/v1/routes/hormuz/news").json()
    assert j["route_id"] == "hormuz" and j["count"] == 2 and j["stale"] is False and j["feed"] == "gdelt"
    assert {i["tag"] for i in j["items"]} == {"attack", "sanctions"}
    assert "GDELT" in j["attribution"]


def test_endpoint_accepts_old_style_spellings_and_404s_unknown(monkeypatch):
    _patch_feed(monkeypatch, [])
    assert client.get("/api/v1/routes/bab%20el-mandeb/news").status_code == 200
    assert client.get("/api/v1/routes/nope/news").status_code == 404


def test_simulated_failure_serves_stale_then_recovers(monkeypatch):
    _patch_feed(monkeypatch, [rec("Hormuz tanker traffic slows")])
    ok = client.get("/api/v1/routes/hormuz/news").json()
    assert ok["feed_status"] == "ok"
    client.post("/api/v1/dev/news-feed", json={"mode": "fail", "expire_cache": True})
    stale = client.get("/api/v1/routes/hormuz/news").json()
    assert stale["stale"] is True and stale["items"] == ok["items"] and stale["last_updated"] == ok["last_updated"]
    client.post("/api/v1/dev/news-feed", json={"mode": "off"})
    again = client.get("/api/v1/routes/hormuz/news").json()
    assert again["stale"] is False and again["feed_status"] == "ok"


def test_simulated_empty_feed_shows_the_empty_message_and_keeps_the_real_cache(monkeypatch):
    _patch_feed(monkeypatch, [rec("Hormuz tanker traffic slows")])
    client.get("/api/v1/routes/hormuz/news")
    client.post("/api/v1/dev/news-feed", json={"mode": "empty", "expire_cache": True})
    empty = client.get("/api/v1/routes/hormuz/news").json()
    assert empty["feed_status"] == "empty" and empty["count"] == 0 and "No recent headlines" in empty["message"]
    client.post("/api/v1/dev/news-feed", json={"mode": "fail"})
    stale = client.get("/api/v1/routes/hormuz/news").json()
    assert stale["stale"] is True and stale["count"] == 1        # the empty simulation did not overwrite the cache


def test_dev_switch_rejects_unknown_modes():
    assert client.post("/api/v1/dev/news-feed", json={"mode": "chaos"}).status_code == 422
