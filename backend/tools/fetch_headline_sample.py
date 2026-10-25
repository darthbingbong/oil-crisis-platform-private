"""Fetch REAL headlines from GDELT through the production code path and save a sample for the classifier review table.

Run from backend/:  python tools/fetch_headline_sample.py
Writes tests/fixtures/news_real_headlines.json (headline, source, date, link, tag per route) and prints the raw-vs-filtered
counts so the effect of the quality filters is visible. Headline metadata only; no article text is requested.
"""

import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import news_feed as nf  # noqa: E402
from services.news_classifier import classify_headline  # noqa: E402

ROUTES = ["hormuz", "bab_el_mandeb", "suez", "malacca", "turkish_straits", "danish_straits", "druzhba", "cpc", "btc", "east_west"]
OUT = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "news_real_headlines.json"


async def main():
    result = {"fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "feed": "gdelt", "routes": {}}
    print(f"{'route':16} {'raw':>4} {'english':>8} {'mention route':>14} {'after dedupe':>13}")
    for rid in ROUTES:
        rq = nf.ROUTE_QUERIES[rid]
        query = nf.build_query(rq)
        try:
            raw = await nf.gdelt_fetch(query)
        except nf.FeedError as e:
            print(f"{rid:16} FEED ERROR: {e}")
            result["routes"][rid] = {"query": query, "error": str(e), "items": []}
            continue
        english = [r for r in raw if nf.is_english(r)]
        mention = [r for r in english if nf.mentions_route((r.get("title") or ""), rq)]
        items = nf.normalize_articles(raw, rq, limit=50)
        # every headline that names the route, before near-duplicate removal, so the classifier review has enough variety
        seen_titles, mentions = set(), []
        for r in mention:
            t = (r.get("title") or "").strip()
            if t and t not in seen_titles:
                seen_titles.add(t)
                mentions.append({"title": t, "source": r.get("domain"), "published_at": nf.parse_seendate(r.get("seendate", "")),
                                 "url": r.get("url"), "tag": classify_headline(t)[0]})
        print(f"{rid:16} {len(raw):>4} {len(english):>8} {len(mention):>14} {len(items):>13}")
        result["routes"][rid] = {"query": query, "raw": len(raw), "english": len(english), "mention_route": len(mention),
                                 "after_dedupe": len(items), "items": items, "all_mentions": mentions,
                                 # raw headline metadata (no article text) so filters/classifier can be re-run offline
                                 "raw_records": [{k: r.get(k) for k in ("title", "url", "seendate", "domain", "language")} for r in raw]}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    total = sum(len(r["items"]) for r in result["routes"].values())
    print(f"\nsaved {total} real headlines to {OUT}")


if __name__ == "__main__":
    asyncio.run(main())
