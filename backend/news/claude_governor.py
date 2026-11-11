"""Cost and abuse control around the Claude classifier (M16, DECISIONS D31 as revised by the owner on 2026-11-11).

Hosted mode may call the Anthropic API, but only under four rules:
  1. each distinct headline is classified ONCE, ever: the result is cached on disk and served from there afterwards;
  2. a DAILY CALL CAP (CLAUDE_DAILY_CALL_CAP, default 50 calls per UTC day);
  3. a MONTHLY SPEND CAP in US dollars (CLAUDE_MONTHLY_USD_CAP, default 5.00 per UTC month), counted from the token usage the API reports;
  4. a RULE-BASED FALLBACK: when a cap is reached, the key is missing, or a call fails, the rule-based classifier answers instead, and the event is
     recorded as classifier "rules" so it is never mistaken for a Claude answer.

The price per million tokens is an ASSUMPTION kept in the environment (CLAUDE_INPUT_USD_PER_MTOK / CLAUDE_OUTPUT_USD_PER_MTOK, defaults 5 and 25, the
highest of the family), so the cap errs on the side of stopping early. The ledger is a small JSON file in data/cache/ (git-ignored). No key, prompt or
response text is stored in it, only counts, dollars and the cached classification of each headline.
"""

import hashlib
import json
import logging
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from . import classifier_claude, classifier_rules
from .models import Article, ClassifiedEvent

logger = logging.getLogger("news_pipeline")

LEDGER_PATH = Path(__file__).resolve().parent.parent / "data" / "cache" / "claude_budget.json"
_lock = threading.Lock()


def _num(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default


def daily_cap() -> int:
    return int(_num("CLAUDE_DAILY_CALL_CAP", 50))


def monthly_usd_cap() -> float:
    return _num("CLAUDE_MONTHLY_USD_CAP", 5.0)


def cost_usd(input_tokens: int, output_tokens: int) -> float:
    return (input_tokens * _num("CLAUDE_INPUT_USD_PER_MTOK", 5.0) + output_tokens * _num("CLAUDE_OUTPUT_USD_PER_MTOK", 25.0)) / 1_000_000


def _now() -> datetime:
    return datetime.fromtimestamp(time.time(), tz=timezone.utc)


def headline_key(article: Article) -> str:
    return hashlib.sha256(" ".join(article.title.lower().split()).encode("utf-8")).hexdigest()[:32]


def _load(path: Path) -> dict:
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(d, dict):
            return d
    except (OSError, ValueError):
        pass
    return {}


def _save(path: Path, d: dict) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(d), encoding="utf-8")
    except OSError:
        logger.warning("could not write the Claude ledger; caps still hold in memory for this run")


def usage(path: Path = LEDGER_PATH) -> dict:
    """What the ledger says now: calls today, dollars this month, how many headlines are cached, and the caps."""
    d, now = _load(path), _now()
    day, month = now.strftime("%Y-%m-%d"), now.strftime("%Y-%m")
    return {"calls_today": d.get("days", {}).get(day, 0), "daily_cap": daily_cap(), "usd_this_month": round(d.get("months", {}).get(month, 0.0), 4),
            "monthly_usd_cap": monthly_usd_cap(), "headlines_cached": len(d.get("cache", {}))}


def classify(article: Article, *, ledger: Path = LEDGER_PATH, call=classifier_claude.classify_with_usage) -> tuple[ClassifiedEvent, str]:
    """Returns (event, classifier_used): 'claude' for a Claude answer (new or cached), 'rules' for the fallback."""
    key = headline_key(article)
    with _lock:
        d = _load(ledger)
        hit = d.get("cache", {}).get(key)
        if hit:
            try:
                return ClassifiedEvent.model_validate(hit), "claude"
            except ValueError:
                pass                                                   # an unreadable cache entry is a miss
        now = _now()
        day, month = now.strftime("%Y-%m-%d"), now.strftime("%Y-%m")
        calls = d.setdefault("days", {}).get(day, 0)
        spent = d.setdefault("months", {}).get(month, 0.0)
        if calls >= daily_cap():
            logger.info("Claude daily cap reached (%d/%d): rule-based classifier used for '%s'", calls, daily_cap(), article.title)
            return classifier_rules.classify_article(article), "rules"
        if spent >= monthly_usd_cap():
            logger.info("Claude monthly spend cap reached ($%.2f/$%.2f): rule-based classifier used for '%s'", spent, monthly_usd_cap(), article.title)
            return classifier_rules.classify_article(article), "rules"
        d["days"] = {day: calls + 1}                                   # the attempt counts, whether or not it succeeds; old days are dropped
        _save(ledger, d)
    try:
        event, tokens_in, tokens_out = call(article)
    except Exception:
        logger.exception("Claude call failed for '%s': rule-based classifier used", article.title)
        return classifier_rules.classify_article(article), "rules"
    with _lock:
        d = _load(ledger)
        d.setdefault("months", {})
        d["months"] = {month: d["months"].get(month, 0.0) + cost_usd(tokens_in, tokens_out)}      # only this month is kept
        d.setdefault("cache", {})[key] = json.loads(event.model_dump_json())
        _save(ledger, d)
    return event, "claude"
