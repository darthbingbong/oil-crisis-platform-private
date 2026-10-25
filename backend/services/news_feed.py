"""Route news: recent headlines for one route from the GDELT DOC 2.0 API (free, no key).

Returns headline, source (domain), published time, link and a tag only. No article text is requested, stored or shown.

Quality controls (GDELT keyword search is noisy):
  * per-route queries: name and alias phrases AND context words, English only (sourcelang:english)
  * the HEADLINE itself must mention the route (an alias), because GDELT also matches body text
  * language filter on each record, near-duplicate headline removal, newest first, capped list

Failure handling: 8 s timeout, 2 retries with exponential backoff, a 5 s minimum gap between requests (GDELT asks for
this), a 20 minute cache, and if the feed fails the last cached result is returned with stale: true and its time.
Nothing is shared with the NewsAPI pipeline in backend/news/ (own cache, own classifier, no API key, no shared quota).
"""

import asyncio
import os
import re
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Awaitable, Callable

import httpx

from .cache import TTLCache
from .news_classifier import classify_headline

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

GDELT_URL = os.environ.get("NEWS_GDELT_URL", "https://api.gdeltproject.org/api/v2/doc/doc")
CACHE_TTL_SECONDS = 20 * 60          # brief: cache 15 to 30 minutes
# Measured against the real API from this machine: the TLS handshake alone takes about 10 s and a full answer 12 to 15 s,
# so timeouts are generous. A total budget stops retries from running away (the panel shows a loading state meanwhile).
CONNECT_TIMEOUT_SECONDS = 25.0
READ_TIMEOUT_SECONDS = 30.0
TOTAL_BUDGET_SECONDS = 60.0
RETRIES = 2
BACKOFF_BASE_SECONDS = 0.6
# Observed live: GDELT often keeps answering 429 for several seconds even when requests are well spaced, so after a 429
# wait much longer than the generic backoff before retrying.
RATE_LIMIT_BACKOFF_SECONDS = 15.0
# GDELT answers HTTP 429 "Please limit requests to one every 5 seconds"; stay a little above that.
MIN_REQUEST_INTERVAL_SECONDS = float(os.environ.get("NEWS_MIN_REQUEST_INTERVAL", "6.0"))
TIMESPAN = "7d"
MAX_RECORDS = 75                     # fetched before filtering (GDELT allows up to 250)
MAX_ITEMS = 12                       # returned to the panel
DUPLICATE_JACCARD = 0.7

# GDELT's terms: free for any use, but any use or redistribution must cite the GDELT Project and link to its website.
ATTRIBUTION = ("Headline metadata from the GDELT Project (https://www.gdeltproject.org/). "
               "Headlines link to the publishers; article text is not stored or shown.")


class FeedError(Exception):
    """The news feed could not be read (timeout, HTTP error, rejected query, simulated failure)."""


@dataclass(frozen=True)
class RouteQuery:
    phrases: tuple[str, ...]                  # route name and aliases, searched as phrases
    context: tuple[str, ...]                  # at least one of these must also match (cuts noise)
    title_terms: tuple[str, ...] = field(default=())   # the headline must contain one of these (lowercase)
    # Broad terms that only count when the headline ALSO has a shipping/oil word (e.g. "Houthi" alone is mostly Yemen war news).
    title_needs_context: tuple[str, ...] = field(default=())


# A headline using a broad term must also contain one of these to be about the route and not the surrounding conflict.
SHIPPING_CONTEXT = ("ship", "tanker", "vessel", "maritime", "shipping", "red sea", "oil", "crude", "cargo", "freight", "suez", "navy")


ROUTE_QUERIES: dict[str, RouteQuery] = {
    "hormuz": RouteQuery(("Strait of Hormuz", "Hormuz"), ("oil", "tanker", "tankers", "crude", "shipping", "vessel", "blockade"), ("hormuz",)),
    "bab_el_mandeb": RouteQuery(("Bab el-Mandeb", "Bab al-Mandab", "Red Sea"), ("tanker", "shipping", "oil", "Houthi", "vessel", "Suez"),
                                ("bab el-mandeb", "bab al-mandab", "bab-el-mandeb", "red sea"), ("houthi",)),
    "suez": RouteQuery(("Suez Canal", "SUMED"), ("shipping", "tanker", "oil", "transit", "vessel"), ("suez", "sumed")),
    "malacca": RouteQuery(("Strait of Malacca", "Malacca Strait"), ("tanker", "shipping", "oil", "piracy", "vessel"), ("malacca",)),
    "turkish_straits": RouteQuery(("Bosphorus", "Bosporus", "Turkish Straits", "Dardanelles"), ("tanker", "oil", "shipping", "vessel"),
                                  ("bosphorus", "bosporus", "turkish strait", "dardanelles")),
    "danish_straits": RouteQuery(("Danish Straits", "Great Belt", "Oresund"), ("tanker", "oil", "shadow fleet", "sanctions", "Baltic"),
                                 ("danish strait", "great belt", "oresund", "øresund", "baltic", "shadow fleet")),
    "cape_good_hope": RouteQuery(("Cape of Good Hope",), ("shipping", "tanker", "rerouted", "diversion", "Red Sea"),
                                 ("cape of good hope", "around africa", "cape route")),
    "east_west": RouteQuery(("East-West pipeline", "Petroline"), ("Saudi", "Aramco", "Yanbu", "oil"),
                            ("east-west pipeline", "east–west pipeline", "petroline", "yanbu")),
    "habshan_fujairah": RouteQuery(("Habshan-Fujairah", "Fujairah", "ADCOP", "Abu Dhabi Crude Oil Pipeline"), ("oil", "tanker", "pipeline", "ADNOC"),
                                   ("fujairah", "adcop", "habshan")),
    "sumed": RouteQuery(("SUMED pipeline", "Sumed"), ("oil", "Egypt", "Suez", "pipeline"), ("sumed",)),
    "druzhba": RouteQuery(("Druzhba pipeline", "Druzhba"), ("oil", "Hungary", "Slovakia", "Ukraine", "Russia"), ("druzhba",)),
    "btc": RouteQuery(("Baku-Tbilisi-Ceyhan", "BTC pipeline"), ("oil", "Azerbaijan", "Ceyhan", "pipeline"),
                      ("baku-tbilisi-ceyhan", "btc pipeline", "ceyhan")),
    "cpc": RouteQuery(("Caspian Pipeline Consortium", "CPC pipeline"), ("Kazakhstan", "Novorossiysk", "oil", "crude"),
                      ("caspian pipeline", "cpc pipeline", "cpc terminal", "cpc blend")),   # bare 'CPC' is ambiguous (Communist Party of China)
    "taps": RouteQuery(("Trans-Alaska Pipeline", "Alyeska"), ("oil", "Alaska", "pipeline"), ("trans-alaska", "alyeska")),
}


def query_for(route: dict) -> RouteQuery:
    rq = ROUTE_QUERIES.get(route["id"])
    if rq is not None:
        return rq
    name = route["name"]
    return RouteQuery((name,), ("oil", "tanker", "shipping"), (name.lower(),))


def build_query(rq: RouteQuery) -> str:
    """GDELT syntax: quoted phrases, OR inside parentheses, space = AND, sourcelang: operator."""
    phrases = " OR ".join(f'"{p}"' if " " in p or "-" in p else p for p in rq.phrases)
    context = " OR ".join(f'"{c}"' if " " in c else c for c in rq.context)
    return f"({phrases}) ({context}) sourcelang:english"


# ---------------------------------------------------------------------------
# Filtering and de-duplication (pure functions)
# ---------------------------------------------------------------------------
def parse_seendate(value: str) -> str | None:
    """GDELT 'seendate' (20260825T120000Z) -> ISO 8601 UTC."""
    try:
        return datetime.strptime(value, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except (TypeError, ValueError):
        return None


def _title_tokens(title: str) -> frozenset[str]:
    # drop a trailing " - Publisher" / " | Publisher" suffix before comparing
    parts = re.split(r"\s[-|–—·]\s", title)
    core = " ".join(parts[:-1]) if len(parts) > 1 and len(parts[-1].split()) <= 4 else title
    return frozenset(re.findall(r"[a-z0-9]+", core.lower()))


def is_near_duplicate(a: frozenset[str], b: frozenset[str]) -> bool:
    if not a or not b:
        return False
    jaccard = len(a & b) / len(a | b)
    return jaccard >= DUPLICATE_JACCARD or (min(len(a), len(b)) >= 6 and (a <= b or b <= a))


def mentions_route(title: str, rq: RouteQuery) -> bool:
    t = title.lower()
    if any(term in t for term in rq.title_terms):
        return True
    return any(term in t for term in rq.title_needs_context) and any(w in t for w in SHIPPING_CONTEXT)


def clean_title(title: str) -> str:
    """GDELT titles often carry encoding debris and tokenizer spacing: drop a trailing '<U+FFFD> Publisher' tail and
    stray replacement characters, and close up the space before punctuation. Wording is otherwise untouched."""
    t = title.split("�")[0] if "�" in title else title
    # trailing "<separator> Publisher" (short last segment) is the outlet name, not part of the headline
    parts = re.split(r"\s[-|–—·]\s", t)
    if len(parts) > 1 and len(parts[-1].split()) <= 4:
        t = t[: len(t) - len(parts[-1])].rstrip(" -|–—·")
    t = re.sub(r"\s+([,.;:!?])", r"\1", t)
    # tokenizer spacing inside compounds only ("Houthi - held" -> "Houthi-held"); a clause dash like "falls - analysts say" is kept
    t = re.sub(r"(?<=\w) - (?=(?:held|led|based|backed|owned|run|linked|flagged|bound|related|made|style|term|wide|free|owned)\b)", "-", t)
    return re.sub(r"\s{2,}", " ", t).strip(" -|")


def is_english(record: dict) -> bool:
    lang = str(record.get("language", "")).strip().lower()
    return lang in ("", "english", "en", "eng")


def normalize_articles(raw: list[dict], rq: RouteQuery, limit: int = MAX_ITEMS) -> list[dict]:
    """Raw GDELT records -> filtered, de-duplicated, tagged items (title, source, published_at, url, tag), newest first."""
    candidates = []
    seen_urls: set[str] = set()
    for r in raw:
        title = clean_title((r.get("title") or "").strip())
        url = (r.get("url") or "").strip()
        published = parse_seendate(r.get("seendate", ""))
        if not title or not url.startswith(("http://", "https://")) or published is None:
            continue
        if not is_english(r) or not mentions_route(title, rq) or url in seen_urls:
            continue
        seen_urls.add(url)
        candidates.append({"title": title, "source": (r.get("domain") or "unknown").strip(), "published_at": published, "url": url})

    candidates.sort(key=lambda x: x["published_at"], reverse=True)
    kept: list[dict] = []
    kept_tokens: list[frozenset[str]] = []
    for c in candidates:
        tokens = _title_tokens(c["title"])
        if any(is_near_duplicate(tokens, k) for k in kept_tokens):
            continue
        kept_tokens.append(tokens)
        kept.append({**c, "tag": classify_headline(c["title"])[0]})
        if len(kept) >= limit:
            break
    return kept


# ---------------------------------------------------------------------------
# GDELT client: timeout, retry with backoff, minimum gap between requests
# ---------------------------------------------------------------------------
_throttle_lock = threading.Lock()
_next_allowed = 0.0


async def _throttle() -> None:
    """Reserve the next request slot (loop-agnostic) and sleep until it, so requests are >= MIN_REQUEST_INTERVAL apart."""
    global _next_allowed
    with _throttle_lock:
        now = time.monotonic()
        slot = max(now, _next_allowed)
        _next_allowed = slot + MIN_REQUEST_INTERVAL_SECONDS
    if slot > now:
        await asyncio.sleep(slot - now)


async def gdelt_fetch(query: str) -> list[dict]:
    params = {"query": query, "mode": "artlist", "format": "json", "maxrecords": MAX_RECORDS, "timespan": TIMESPAN, "sort": "datedesc"}
    headers = {"User-Agent": "oil-crisis-platform (student research project; headline metadata only)"}
    last_error: Exception | None = None
    started = time.monotonic()
    timeout = httpx.Timeout(READ_TIMEOUT_SECONDS, connect=CONNECT_TIMEOUT_SECONDS)
    async with httpx.AsyncClient(timeout=timeout, headers=headers) as client:
        for attempt in range(RETRIES + 1):
            if attempt and time.monotonic() - started > TOTAL_BUDGET_SECONDS:
                break                                  # out of time budget: give up rather than keep the panel waiting
            await _throttle()
            try:
                resp = await client.get(GDELT_URL, params=params)
                if resp.status_code == 429 or resp.status_code >= 500:
                    raise FeedError(f"HTTP {resp.status_code}: {resp.text[:90].strip()!r}")
                resp.raise_for_status()
                if not resp.text.strip():
                    return []                      # GDELT answers an empty body when nothing matches
                try:
                    data = resp.json()
                except ValueError:
                    raise FeedError(f"non-JSON reply (query rejected?): {resp.text[:100]!r}")
                return data.get("articles", []) or []
            except (httpx.HTTPError, FeedError) as e:
                last_error = e
                if attempt < RETRIES:
                    rate_limited = isinstance(e, FeedError) and str(e).startswith("HTTP 429")
                    await asyncio.sleep(RATE_LIMIT_BACKOFF_SECONDS if rate_limited else BACKOFF_BASE_SECONDS * 2**attempt)
    detail = f"{type(last_error).__name__}: {last_error}".rstrip(": ") if last_error is not None else "no attempt made"
    raise FeedError(detail)


# ---------------------------------------------------------------------------
# DEV-ONLY failure simulation (same spirit as the news pipeline's test-inject endpoint)
# ---------------------------------------------------------------------------
_simulation_mode = "off"   # "off" | "fail" | "empty"


def set_simulation(mode: str, expire_cache: bool = False) -> dict:
    """mode 'fail': every live fetch raises FeedError. 'empty': the live feed returns no records. Neither touches the cache
    contents, so a real cached result can still be served as stale. expire_cache=True makes cached entries older than the ttl."""
    global _simulation_mode
    if mode not in ("off", "fail", "empty"):
        raise ValueError("mode must be off, fail or empty")
    _simulation_mode = mode
    expired = default_cache().expire_all() if expire_cache else 0
    return {"mode": _simulation_mode, "entries_expired": expired}


def simulation_mode() -> str:
    return _simulation_mode


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------
_cache: TTLCache | None = None


def default_cache() -> TTLCache:
    global _cache
    if _cache is None:
        _cache = TTLCache(DATA_DIR / "cache" / "route_news", CACHE_TTL_SECONDS)
    return _cache


def _iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _response(route: dict, items: list[dict], fetched_at: float | None, *, stale: bool, status: str, message: str | None) -> dict:
    return {
        "route_id": route["id"],
        "route_name": route["name"],
        "items": items,
        "count": len(items),
        "stale": stale,
        "feed": "gdelt",
        "feed_status": status,                 # ok | empty | stale | unavailable
        "last_updated": _iso(fetched_at) if fetched_at is not None else None,
        "message": message,
        "cache_ttl_seconds": CACHE_TTL_SECONDS,
        "timespan": TIMESPAN,
        "attribution": ATTRIBUTION,
    }


EMPTY_MESSAGE = ("No recent headlines found for this route in the last 7 days. GDELT was reachable; nothing matching in English "
                 "mentioned this route in its headline.")
UNAVAILABLE_MESSAGE = "The news feed is not responding and nothing has been cached yet. Try again in a few minutes."


def _stale_message(fetched_at: float) -> str:
    return f"The live news feed is not responding. Showing the last successful result, from {_iso(fetched_at)}."


async def get_route_news(
    route: dict,
    *,
    cache: TTLCache | None = None,
    fetch: Callable[[str], Awaitable[list[dict]]] | None = None,
) -> dict:
    cache = cache or default_cache()
    fetch = fetch or gdelt_fetch
    rq = query_for(route)
    key = f"news_{route['id']}"
    entry = cache.get(key)

    if entry is not None and cache.is_fresh(entry) and _simulation_mode == "off":
        p = entry["payload"]
        status = "ok" if p["items"] else "empty"
        return _response(route, p["items"], entry["fetched_at"], stale=False, status=status, message=None if p["items"] else EMPTY_MESSAGE)

    try:
        if _simulation_mode == "fail":
            raise FeedError("simulated feed failure (dev switch)")
        raw = [] if _simulation_mode == "empty" else await fetch(build_query(rq))
        items = normalize_articles(raw, rq)
        if _simulation_mode == "off":
            entry = cache.put(key, {"items": items})
            return _response(route, items, entry["fetched_at"], stale=False, status="ok" if items else "empty",
                             message=None if items else EMPTY_MESSAGE)
        return _response(route, items, time.time(), stale=False, status="empty" if not items else "ok",
                         message=EMPTY_MESSAGE if not items else None)   # simulated empty: not cached
    except FeedError:
        if entry is not None:
            return _response(route, entry["payload"]["items"], entry["fetched_at"], stale=True, status="stale",
                             message=_stale_message(entry["fetched_at"]))
        return _response(route, [], None, stale=False, status="unavailable", message=UNAVAILABLE_MESSAGE)
