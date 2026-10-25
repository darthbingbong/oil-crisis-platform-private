"""Classifier and filters checked against REAL GDELT headlines (fetched 2026-10-25 by tools/fetch_headline_sample.py).

The hard-coded headlines below were reviewed by eye against the assigned tag (see the M4 report table). The fixture file holds
the raw headline metadata (title, source, date, link only, no article text) so the filters can be re-run offline.
"""

import json
from pathlib import Path

import pytest

from services import news_feed as nf
from services.news_classifier import TAGS, classify_headline

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "news_real_headlines.json"

# (real headline as shown to the user after cleanup, tag judged correct on review)
REVIEWED = [
    ("Trump keeps Iran strike option open, says deal possible; Tehran accuses US of derailing talks", "attack"),
    ("Trump Says US Could Strike Iran Soon, Hints at Deal", "attack"),
    ("Nigerian Oil Near US$115 a Barrel on Hormuz Attacks", "attack"),
    ("IRGC claims full control over Hormuz as US contemplates fresh strikes on Iran", "attack"),
    ("U. S. Orders Non - Emergency Diplomats to Leave Saudi Arabia Following Houthi Strikes", "attack"),
    ("Coalition intercepts two Houthi ballistic missiles on Saudi cities", "attack"),
    ("Heavy airstrikes hit Houthi-held Sanaa, Mocha amid escalating Yemen conflict", "attack"),
    ("Middle East mayhem: Oil prices jump US$3 on Houthi attacks, oil spill, highest settlement since April", "attack"),
    ("Three killed in attacks on Aramco oil field, Saudi airport", "attack"),
    ("Iran says 7 tankers damaged in Strait of Hormuz, and other Mideast news", "disruption"),
    ("Hambantota Port Poised to Reap Benefits as Global Shipping Returns to Suez Canal Route", "shipping"),
    ("Hapag - Lloyd expects more shipping services to return to Suez Canal", "shipping"),
    ("HIPG sees stronger opportunities as container shipping return to Suez gathers pace", "shipping"),
    ("Sri Lanka Hambantota Port Sees Bunker Demand Opportunity as Suez Return Gathers Pace", "shipping"),
    ("Fidan to meet Yemeni FM as fighting threatens key shipping routes", "shipping"),
    ("Global petrol market in turmoil; crude oil hits $117", "general"),
    ("Fuel Oil Becomes Asia Next Cost Shock", "general"),
    ("US issues travel advisories across Middle East citing Houthi threat", "general"),
    ("Ethiopia Calls for Shared Red Sea Security", "general"),
    ("Drinking water supplies dwindle in Yemeni city besieged by Houthi rebels", "general"),
    ("Panama Canal Sets Record for Annual Tonnage Driven by Shifts in Trade", "general"),
    ("APPO Seeks Stronger African Oil Firms As IOCs Secure Exploration Deals", "general"),
]


@pytest.mark.parametrize("headline,tag", REVIEWED)
def test_real_headline_gets_the_reviewed_tag(headline, tag):
    assert classify_headline(headline)[0] == tag


def test_at_least_twenty_real_headlines_are_covered():
    assert len(REVIEWED) >= 20 and {t for _, t in REVIEWED} <= set(TAGS)


@pytest.mark.xfail(strict=True, reason="Known limitation: a keyword tagger cannot see negation. 'will not attack Yemen' is not an attack.")
def test_negated_attack_is_not_tagged_attack():
    assert classify_headline("Sisi says Egypt will defend Saudi territory but will not attack Yemen")[0] != "attack"


@pytest.fixture(scope="module")
def fixture_routes():
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return {rid: r for rid, r in data["routes"].items() if r.get("raw_records")}


def test_fixture_holds_real_data_for_several_routes(fixture_routes):
    assert len(fixture_routes) >= 5
    assert sum(len(r["raw_records"]) for r in fixture_routes.values()) >= 200


def test_filters_on_real_records_keep_only_route_headlines_without_duplicates(fixture_routes):
    for rid, r in fixture_routes.items():
        rq = nf.ROUTE_QUERIES[rid]
        items = nf.normalize_articles(r["raw_records"], rq, limit=50)
        assert len(items) <= len(r["raw_records"])
        for i in items:
            assert nf.mentions_route(i["title"], rq), (rid, i["title"])
            assert i["tag"] in TAGS and set(i) == {"title", "source", "published_at", "url", "tag"}
        toks = [nf._title_tokens(i["title"]) for i in items]
        assert not any(nf.is_near_duplicate(a, b) for n, a in enumerate(toks) for b in toks[n + 1:]), rid


def test_real_noise_is_cut_hard(fixture_routes):
    """The Hormuz query returned 75 raw records; only a handful name the route in their headline, and syndicated copies collapse."""
    hz = fixture_routes["hormuz"]
    kept = nf.normalize_articles(hz["raw_records"], nf.ROUTE_QUERIES["hormuz"])
    assert len(hz["raw_records"]) >= 50 and len(kept) <= 6


def test_yemen_war_noise_is_not_shown_as_red_sea_route_news(fixture_routes):
    kept = [i["title"].lower() for i in nf.normalize_articles(fixture_routes["bab_el_mandeb"]["raw_records"], nf.ROUTE_QUERIES["bab_el_mandeb"])]
    assert not any("saudi cities" in t or "water" in t for t in kept)


def test_no_article_text_is_stored_in_the_fixture(fixture_routes):
    for r in fixture_routes.values():
        for rec in r["raw_records"]:
            assert set(rec) <= {"title", "url", "seendate", "domain", "language"}
            assert len(rec.get("title") or "") < 400
