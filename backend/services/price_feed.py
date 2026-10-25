"""Oil spot prices (WTI and Brent): a provider abstraction, an EIA API v2 adapter and a local-CSV fallback.

Honest labelling, by design:
  * status DAILY_CLOSE      -> the EIA API call succeeded (or a successful call within the last 24 h is being reused). EIA spot prices are
                               DAILY CLOSES published in a WEEKLY release, so the newest point is typically several days old; the age is reported.
  * status OFFLINE_FALLBACK -> EIA could not be used (no key, rejected key, timeout, server error ...): the last usable row of
                               data/oil_daily_prices.csv, with its real date.
  * Nothing is ever labelled LIVE: no free source here is real time.

The API key stays on the server. httpx logs full request URLs (which contain api_key=...), so this module (a) silences httpx's INFO logging
and (b) installs a log-record factory that redacts any api_key=... and the key value itself from EVERY log record. Errors raised here carry a
short reason, never a URL.
"""

import asyncio
import logging
import math
import os
import re
import time
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Awaitable, Callable, Protocol

import httpx
import pandas as pd

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CSV_PATH = DATA_DIR / "oil_daily_prices.csv"

REAL_EIA_BASE_URL = "https://api.eia.gov/v2"


def resolve_eia_base_url() -> str:
    """The EIA endpoint to use at runtime: ALWAYS the real one, unless a developer has explicitly opted in to a stand-in (the dev-only mock server)
    with BOTH EIA_BASE_URL and PRICE_DEV_ALLOW_CUSTOM_EIA_URL=1. A stray EIA_BASE_URL alone is ignored (with a warning), so production can never
    silently talk to the mock."""
    custom = os.environ.get("EIA_BASE_URL", "").strip().rstrip("/")
    if not custom or custom == REAL_EIA_BASE_URL:
        return REAL_EIA_BASE_URL
    if os.environ.get("PRICE_DEV_ALLOW_CUSTOM_EIA_URL", "") == "1":
        logging.getLogger("price_feed").warning("DEV MODE: EIA requests are going to %s, not the real EIA API. Anything shown is NOT EIA data.", custom)
        return custom
    logging.getLogger("price_feed").warning("Ignoring EIA_BASE_URL (%s): custom EIA endpoints need PRICE_DEV_ALLOW_CUSTOM_EIA_URL=1. Using the real EIA API.", custom)
    return REAL_EIA_BASE_URL


def using_stand_in_eia() -> bool:
    return resolve_eia_base_url() != REAL_EIA_BASE_URL


EIA_ROUTE = "petroleum/pri/spt"
SERIES = {"RWTC": "wti", "RBRTE": "brent"}        # WTI Cushing, Brent Europe; both in USD per barrel
EIA_TIMEOUT_SECONDS = 5.0                         # measured: a call takes about 0.75 s, so 5 s is generous; worst case total is about 10.5 s
EIA_RETRIES = 1
EIA_BACKOFF_SECONDS = 0.5
CACHE_TTL_SECONDS = 15 * 60                       # data changes weekly; 15 min keeps us far below any rate limit
STALE_REUSE_SECONDS = 24 * 3600                   # after a failure, a successful EIA answer up to 24 h old is still better than the CSV
OLD_DATA_DAYS = 3                                 # older than this and the response carries an explicit age warning
HISTORY_FETCH_DAYS = 90

STATUS_DAILY_CLOSE = "DAILY_CLOSE"
STATUS_OFFLINE = "OFFLINE_FALLBACK"

logger = logging.getLogger("price_feed")


# ---------------------------------------------------------------------------
# Keeping the key out of logs
# ---------------------------------------------------------------------------
_KEY_PARAM = re.compile(r"(api_key=)[^&\s'\"\)]+", re.IGNORECASE)


_KEY_JSON = re.compile(r'("APIKey"\s*:\s*")[^"]*(")', re.IGNORECASE)
SECRET_ENV_NAMES = ["EIA_API_KEY"]          # environment variables whose VALUES are scrubbed from every log record (ais_feed adds its own)


def redact(text: str, secret: str | None = None) -> str:
    text = _KEY_JSON.sub(r"\1REDACTED\2", _KEY_PARAM.sub(r"\1REDACTED", text))
    secrets = [secret] if secret is not None else [os.environ.get(n, "") for n in SECRET_ENV_NAMES]
    for key in secrets:
        if key and len(key) >= 4:
            text = text.replace(key, "REDACTED")
    return text


def install_log_redaction() -> None:
    """Wrap the log-record factory (idempotent) so no record, from any module or handler, can contain the key."""
    current = logging.getLogRecordFactory()
    if getattr(current, "_redacts_api_key", False):
        return

    def factory(*args, **kwargs):
        record = current(*args, **kwargs)
        try:
            message = record.getMessage()
        except Exception:                                   # a malformed log call must never break logging
            return record
        cleaned = redact(message)
        if cleaned != message:
            record.msg, record.args = cleaned, ()
        return record

    factory._redacts_api_key = True                         # type: ignore[attr-defined]
    logging.setLogRecordFactory(factory)
    logging.getLogger("httpx").setLevel(logging.WARNING)    # its INFO lines are full URLs
    logging.getLogger("httpcore").setLevel(logging.WARNING)


install_log_redaction()


# ---------------------------------------------------------------------------
# Providers
# ---------------------------------------------------------------------------
class PriceFeedError(Exception):
    """kind: no_key | invalid_key | rate_limited | timeout | http_error | bad_response | no_data"""

    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.kind = kind


class PriceProvider(Protocol):
    name: str

    async def fetch_recent(self, days: int) -> list[dict]:
        """Return [{'date': 'YYYY-MM-DD', 'wti': float | None, 'brent': float | None}, ...], any order. None = a blank (holiday) price."""
        ...


def _to_price(value) -> float | None:
    """EIA leaves the value blank (or null) on market holidays; treat blank, NaN and non-numbers as 'no price'."""
    if value is None or value == "":
        return None
    try:
        x = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(x) else x


class EiaProvider:
    """EIA Open Data API v2, route petroleum/pri/spt (daily spot prices), series RWTC (WTI) and RBRTE (Brent).

    Request: GET {base}/petroleum/pri/spt/data/?api_key=...&frequency=daily&data[0]=value&facets[series][]=RWTC&facets[series][]=RBRTE
             &sort[0][column]=period&sort[0][direction]=desc&length=N          (api_key must be in the URL, EIA does not accept a header)
    Reply:   {"response": {"data": [{"period": "2026-10-20", "series": "RWTC", "value": "107.89", ...}, ...]}}
    Failures: HTTP 403 with {"error": {"code": "API_KEY_MISSING" | "API_KEY_INVALID", ...}} (observed live).
    """

    name = "EIA API v2"

    def __init__(self, api_key: str, *, base_url: str | None = None, timeout: float = EIA_TIMEOUT_SECONDS, retries: int = EIA_RETRIES,
                 backoff: float = EIA_BACKOFF_SECONDS, transport: httpx.AsyncBaseTransport | None = None,
                 sleep: Callable[[float], Awaitable[None]] = asyncio.sleep):
        self._key, self._base, self._timeout, self._retries, self._backoff = api_key, (base_url or resolve_eia_base_url()).rstrip("/"), timeout, retries, backoff
        self._transport, self._sleep = transport, sleep
        self.last_latency_ms: float | None = None

    async def fetch_recent(self, days: int) -> list[dict]:
        if not self._key:
            raise PriceFeedError("no_key", "no API key configured")
        params = {
            "api_key": self._key, "frequency": "daily", "data[0]": "value",
            "facets[series][]": list(SERIES), "sort[0][column]": "period", "sort[0][direction]": "desc",
            "length": min(5000, 2 * (days + 15)),         # two series per day, plus slack for holidays
        }
        last: PriceFeedError | None = None
        async with httpx.AsyncClient(timeout=self._timeout, transport=self._transport) as client:
            for attempt in range(self._retries + 1):
                started = time.monotonic()
                try:
                    resp = await client.get(f"{self._base}/{EIA_ROUTE}/data/", params=params)
                    self.last_latency_ms = (time.monotonic() - started) * 1000
                    return self._parse(resp)
                except PriceFeedError as e:
                    last = e
                    if e.kind in ("invalid_key", "no_key", "bad_response", "no_data"):
                        raise                                    # retrying cannot help
                except httpx.TimeoutException:
                    last = PriceFeedError("timeout", f"EIA did not answer within {self._timeout:g} s")
                except httpx.HTTPError as e:
                    last = PriceFeedError("http_error", f"network error ({type(e).__name__})")   # type only: messages can contain the URL
                if attempt < self._retries:
                    await self._sleep(self._backoff * 2**attempt)
        assert last is not None
        raise last

    @staticmethod
    def _parse(resp: httpx.Response) -> list[dict]:
        if resp.status_code in (401, 403):
            code = ""
            try:
                code = str((resp.json().get("error") or {}).get("code", ""))
            except ValueError:
                pass
            kind = "no_key" if code == "API_KEY_MISSING" else "invalid_key"
            raise PriceFeedError(kind, f"EIA rejected the request (HTTP {resp.status_code}{' ' + code if code else ''})")
        if resp.status_code == 429:
            raise PriceFeedError("rate_limited", "EIA is rate limiting this key (HTTP 429)")
        if resp.status_code >= 500:
            raise PriceFeedError("http_error", f"EIA server error (HTTP {resp.status_code})")
        if resp.status_code >= 400:
            raise PriceFeedError("bad_response", f"EIA refused the request (HTTP {resp.status_code})")
        try:
            rows = resp.json()["response"]["data"]
        except (ValueError, KeyError, TypeError):
            raise PriceFeedError("bad_response", "EIA reply was not in the expected format")
        by_date: dict[str, dict] = {}
        for r in rows:
            series = SERIES.get(str(r.get("series") or r.get("series-id") or ""))
            period = str(r.get("period") or "")[:10]
            if series is None or len(period) != 10:
                continue
            by_date.setdefault(period, {"date": period, "wti": None, "brent": None})[series] = _to_price(r.get("value"))
        if not by_date:
            raise PriceFeedError("no_data", "EIA returned no rows for WTI or Brent")
        return list(by_date.values())


class CsvProvider:
    """The local file data/oil_daily_prices.csv (EIA daily WTI/Brent, copied into the project). Blank prices (holidays, early Brent) become None."""

    name = "local CSV"

    def __init__(self, path: Path = CSV_PATH):
        self._path = path

    async def fetch_recent(self, days: int) -> list[dict]:
        return self.all_rows()[-(days + 20):]

    def all_rows(self) -> list[dict]:
        df = pd.read_csv(self._path)
        out = []
        for d, w, b in zip(df["date"], df["wti"], df["brent"]):
            out.append({"date": str(d)[:10], "wti": _to_price(w), "brent": _to_price(b)})
        return out


# ---------------------------------------------------------------------------
# The service
# ---------------------------------------------------------------------------
FALLBACK_MESSAGES = {
    "no_key": "No EIA API key is configured on the server, so this is the last row of the local CSV file.",
    "invalid_key": "EIA rejected the server's API key, so this is the last row of the local CSV file.",
    "rate_limited": "EIA is rate limiting the server's key, so this is the last row of the local CSV file.",
    "timeout": "EIA did not answer in time, so this is the last row of the local CSV file.",
    "http_error": "EIA could not be reached or returned a server error, so this is the last row of the local CSV file.",
    "bad_response": "EIA's reply could not be understood, so this is the last row of the local CSV file.",
    "no_data": "EIA returned no prices, so this is the last row of the local CSV file.",
}


def _latest_two(points: list[dict], field: str) -> tuple[dict | None, dict | None]:
    """The newest point with a price for `field` and the one before it (blank/holiday rows skipped)."""
    have = [p for p in points if p.get(field) is not None]
    have.sort(key=lambda p: p["date"])
    return (have[-1] if have else None), (have[-2] if len(have) > 1 else None)


class PriceService:
    def __init__(self, *, csv: CsvProvider | None = None, provider_factory: Callable[[str], PriceProvider] | None = None,
                 clock: Callable[[], float] = time.time):
        self._csv = csv or CsvProvider()
        self._factory = provider_factory or (lambda key: EiaProvider(key))
        self._clock = clock
        self._cache: dict | None = None               # {"points", "fetched_at", "latency_ms"} from the last successful EIA call

    # -- EIA access with cache ------------------------------------------------
    async def _eia(self) -> tuple[list[dict], dict]:
        """(points, meta) from EIA, or raise PriceFeedError. Reuses a cached success while fresh, and for up to 24 h after a failure."""
        key = os.environ.get("EIA_API_KEY", "").strip()
        if not key:                                    # no key means no EIA data, whatever an earlier cache holds
            raise PriceFeedError("no_key", "no API key configured")
        c = self._cache
        if c and self._clock() - c["fetched_at"] < CACHE_TTL_SECONDS:
            return c["points"], {"fetched_at": c["fetched_at"], "cached": True, "latency_ms": c["latency_ms"]}
        provider = self._factory(key)
        try:
            points = await provider.fetch_recent(HISTORY_FETCH_DAYS)
        except PriceFeedError:
            if c and self._clock() - c["fetched_at"] < STALE_REUSE_SECONDS:
                return c["points"], {"fetched_at": c["fetched_at"], "cached": True, "latency_ms": c["latency_ms"], "reused_after_failure": True}
            raise
        latency = getattr(provider, "last_latency_ms", None)
        self._cache = {"points": points, "fetched_at": self._clock(), "latency_ms": latency}
        return points, {"fetched_at": self._cache["fetched_at"], "cached": False, "latency_ms": latency}

    def _today(self) -> date:
        return datetime.fromtimestamp(self._clock(), tz=timezone.utc).date()

    # -- /price/live -----------------------------------------------------------
    async def live(self) -> dict:
        reason: PriceFeedError | None = None
        meta: dict = {}
        try:
            points, meta = await self._eia()
            status, source = STATUS_DAILY_CLOSE, "EIA API v2, series RWTC (WTI) and RBRTE (Brent)"
            if using_stand_in_eia():
                source = "DEV STAND-IN for EIA (mock server, NOT EIA DATA): " + source
        except PriceFeedError as e:
            reason = e
            logger.warning("EIA price feed unavailable (%s); serving the local CSV", e.kind)
            points = await self._csv.fetch_recent(60)
            status, source = STATUS_OFFLINE, "local CSV data/oil_daily_prices.csv (EIA daily WTI/Brent copied into the project)"

        wti, wti_prev = _latest_two(points, "wti")
        brent, brent_prev = _latest_two(points, "brent")
        head = wti or brent
        if head is None:
            raise PriceFeedError("no_data", "no usable price in any source")
        as_of = date.fromisoformat(head["date"])
        age = (self._today() - as_of).days

        def delta(cur, prev, field):
            if not cur or not prev:
                return None, None
            ch = cur[field] - prev[field]
            return round(ch, 2), (round(ch / prev[field] * 100, 2) if prev[field] else None)

        ch, pct = delta(wti, wti_prev, "wti")
        bch, bpct = delta(brent, brent_prev, "brent")
        out = {
            "wti": wti["wti"] if wti else None, "brent": brent["brent"] if brent else None,
            "change": ch, "change_pct": pct, "brent_change": bch, "brent_change_pct": bpct,
            "as_of": head["date"], "brent_as_of": brent["date"] if brent else None,
            "status": status, "age_days": age,
            "age_warning": (f"The latest price is {age} days old. EIA spot prices are daily closes published in a weekly release, so this is not a current quote."
                            if age > OLD_DATA_DAYS else None),
            "source": source, "series": {"wti": "RWTC", "brent": "RBRTE"}, "units": "USD per barrel",
            "fetched_at": datetime.fromtimestamp(meta["fetched_at"], tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if meta.get("fetched_at") else None,
            "cached": bool(meta.get("cached")), "eia_latency_ms": round(meta["latency_ms"]) if meta.get("latency_ms") else None,
            "fallback_reason": reason.kind if reason else None,
            "fallback_message": (FALLBACK_MESSAGES.get(reason.kind, FALLBACK_MESSAGES["http_error"]) if reason else None),
        }
        return out

    # -- /price/history ---------------------------------------------------------
    async def history(self, days: int = 30) -> dict:
        csv_rows = self._csv.all_rows()
        eia_rows: list[dict] = []
        reason: PriceFeedError | None = None
        try:
            eia_rows, _ = await self._eia()
        except PriceFeedError as e:
            reason = e

        merged: dict[str, dict] = {}
        for r in csv_rows:
            merged[r["date"]] = {**r, "source": "csv"}
        overridden = 0
        for r in eia_rows:                                   # EIA wins on a date both have; a blank EIA price never erases a CSV price
            cur = merged.get(r["date"])
            if cur is None:
                merged[r["date"]] = {**r, "source": "eia"}
                continue
            overridden += 1
            for f in ("wti", "brent"):
                if r[f] is not None:
                    cur[f] = r[f]
                    cur["source"] = "eia"
        usable = [p for p in merged.values() if p["wti"] is not None or p["brent"] is not None]   # blank holiday rows dropped
        skipped_blank = len(merged) - len(usable)
        usable.sort(key=lambda p: p["date"])
        latest = date.fromisoformat(usable[-1]["date"])
        window = [p for p in usable if (latest - date.fromisoformat(p["date"])).days < days]
        return {
            "points": window, "days": days, "units": "USD per barrel", "latest_date": usable[-1]["date"],
            "age_days": (self._today() - latest).days,
            "status": STATUS_DAILY_CLOSE if eia_rows else STATUS_OFFLINE,
            "sources": {"csv_points": sum(1 for p in window if p["source"] == "csv"), "eia_points": sum(1 for p in window if p["source"] == "eia"),
                        "dates_in_both_resolved_to_eia": overridden, "blank_holiday_rows_skipped": skipped_blank},
            "fallback_reason": reason.kind if reason else None,
        }


_service: PriceService | None = None


def get_service() -> PriceService:
    global _service
    if _service is None:
        _service = PriceService()
    return _service
