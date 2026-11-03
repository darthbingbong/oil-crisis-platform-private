"""ShipFinder AIS client (server-side only): one place that talks to the provider, with a quota guard, a circuit breaker and a call log.

Verified on 2026-11-01 (docs/ais_verification.md): host api.elaneglobal.com, the key goes in the query string as key=..., longitude comes first in
route-planning coordinates. Vessels Nearby is centred on a vessel (mmsi) with a fixed 10 nm radius and refused calls with status 38 after 10 in 8 s.

Rules enforced here, in code:
  * A call that reaches the provider is counted against the service's lifetime counter (kept on disk) even if it fails, because the docs do not say
    whether failures count. Metered services stop at the DEVELOPMENT CAP (60% of the quota) unless the caller passes allow_beyond_dev_cap=True, and
    never go past the real quota.
  * CIRCUIT BREAKER: any non-zero provider status, timeout, HTTP error or unreadable reply stops that service and starts a back-off (30 minutes, doubled
    for each consecutive failure up to 4 hours; a success resets it). The breaker is persisted so a restart does not hammer the provider. Nothing here
    ever retries a call, in a loop or otherwise.
  * MIN INTERVAL per service (seconds between two calls), and for Vessel Search a ceiling of 20 calls per minute. A call refused locally is not sent, counted or logged.
  * Status 31 from Vessel Search (nothing matched) is an empty result: counted and logged like any call, but it does not trip the breaker. It is benign for that
    service only; 31 from any other service, and every other non-zero status, still trips.
  * Kill switch AIS_ENABLED=0. No key means no calls. A MANUAL HOLD (set_hold) blocks one service until a person clears it (clear_hold); it is stored on disk.
  * Every real call is appended to logs/ais_calls.jsonl (service, time, http, provider status, latency, purpose; never the key).
  * The key never appears in an exception, log record, raw copy or state file.
"""

import json
import logging
import os
import re
import time
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable

import httpx

from services import price_feed

logger = logging.getLogger("shipfinder")

HOST = "https://api.elaneglobal.com"
KEY_ENV = "AIS_API_KEY"
KEY_EXPIRES = date(2026, 11, 13)             # from the console (all enabled services expire the same day)
BACKOFF_START_S, BACKOFF_MAX_S = 30 * 60, 4 * 3600
TIMEOUT_S = 40.0

BACKEND = Path(__file__).resolve().parent.parent
ROOT = BACKEND.parent
DEFAULT_STATE_DIR = BACKEND / "data" / "ais_raw" / "_state"
DEFAULT_CALL_LOG = ROOT / "logs" / "ais_calls.jsonl"

if KEY_ENV not in price_feed.SECRET_ENV_NAMES:
    price_feed.SECRET_ENV_NAMES.append(KEY_ENV)


class AISError(Exception):
    """kind: disabled | no_key | on_hold | breaker_open | too_soon | rate_limited | quota_cap | quota_exhausted | provider_status | http_error | timeout | bad_response"""

    def __init__(self, kind: str, message: str, status: int | None = None, retry_after_s: float | None = None):
        super().__init__(message)
        self.kind, self.status, self.retry_after_s = kind, status, retry_after_s


class NotSupported(AISError):
    """The current key does not include this service (Vessels in Zone, port-status services, weather and so on)."""

    def __init__(self, what: str):
        super().__init__("not_supported", f"{what} is not available on the current key")


@dataclass(frozen=True)
class Service:
    path: str
    quota: int | None            # None = unmetered in the console
    min_interval_s: float
    benign_statuses: frozenset = frozenset()   # provider statuses that are an ANSWER, not a failure (counted and logged, never trip the breaker)
    max_per_minute: int | None = None          # extra ceiling on top of min_interval_s, so typing in a search box can never flood the provider

    @property
    def dev_cap(self) -> int | None:
        return None if self.quota is None else int(self.quota * 0.6)


SERVICES: dict[str, Service] = {
    "vessel_search":    Service("/v1/AIS/VesselSearch", None, 1.0, frozenset({31}), 20),     # 31 = nothing matched (observed 2026-11-01); owner: an empty result
    "vessel_flag":      Service("/v1/AIS/VesselFlagInfo", None, 1.0),
    "port_info":        Service("/v1/Voyage/PortInfo", None, 1.0),
    "vessels_nearby":   Service("/v1/AIS/VesselsNearby", None, 30.0),     # owner's rule: at most one per 30 s
    "vessel_position":  Service("/v1/AIS/VesselPositionSingle", 50, 2.0),
    "fleet_position":   Service("/v1/AIS/FleetPosition", 50, 2.0),
    "vessel_track":     Service("/v1/History/VesselHistoryTrack", 10, 10.0),
    "route_point":      Service("/v1/Prediction/RoutePlanPointToPoint", 10, 5.0),
    "route_port":       Service("/v1/Prediction/RoutePlanPortToPort", 10, 5.0),
}


def enabled() -> bool:
    return os.environ.get("AIS_ENABLED", "1").strip() not in ("0", "false", "False", "no")


def get_key() -> str:
    return os.environ.get(KEY_ENV, "").strip()


def days_until_expiry(today: date | None = None) -> int:
    return (KEY_EXPIRES - (today or datetime.now(timezone.utc).date())).days


class ShipFinderClient:
    def __init__(self, key: str | None = None, transport: httpx.BaseTransport | None = None, state_dir: Path | None = None,
                 log_path: Path | None = None, clock: Callable[[], float] = time.time):
        self._key = key if key is not None else get_key()
        self._transport = transport
        self._state_path = (state_dir or DEFAULT_STATE_DIR) / "ais_state.json"
        self._log_path = log_path or DEFAULT_CALL_LOG
        self._clock = clock

    # ------------------------------------------------------------------ state (on disk, shared by every process)
    def _load(self) -> dict:
        try:
            return json.loads(self._state_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def _save(self, state: dict) -> None:
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(state, indent=1), encoding="utf-8")
        tmp.replace(self._state_path)

    def service_state(self, service: str) -> dict:
        s = self._load().get(service, {})
        return {"used": s.get("used", 0), "last_call": s.get("last_call"), "breaker_open_until": s.get("breaker_open_until"),
                "consecutive_failures": s.get("consecutive_failures", 0), "last_status": s.get("last_status"), "last_msg": s.get("last_msg")}

    def set_hold(self, service: str, reason: str) -> None:
        """Block a service until a person calls clear_hold (used for Vessels Nearby until the owner has checked the console)."""
        state = self._load()
        state.setdefault(service, {})["hold"] = reason
        self._save(state)

    def clear_hold(self, service: str) -> None:
        state = self._load()
        state.setdefault(service, {}).pop("hold", None)
        self._save(state)

    def budget(self) -> dict:
        """Calls used and left per service, for /api/v1/ais/budget."""
        out = {}
        now = self._clock()
        for name, svc in SERVICES.items():
            st = self.service_state(name)
            until = st["breaker_open_until"]
            out[name] = {"quota": svc.quota, "dev_cap": svc.dev_cap, "used": st["used"], "left": None if svc.quota is None else svc.quota - st["used"],
                         "hold": self._load().get(name, {}).get("hold"), "breaker": "open" if until and until > now else "closed", "retry_in_s": max(0, round(until - now)) if until and until > now else 0,
                         "last_status": st["last_status"]}
        return out

    # ------------------------------------------------------------------ the one call path
    def call(self, service: str, params: dict[str, Any], purpose: str, *, allow_beyond_dev_cap: bool = False, raw_dir: Path | None = None,
             raw_name: str | None = None) -> dict:
        svc = SERVICES.get(service)
        if svc is None:
            raise NotSupported(service)
        if not enabled():
            raise AISError("disabled", "AIS_ENABLED=0")
        if not self._key:
            raise AISError("no_key", "no AIS key configured")
        now = self._clock()
        state = self._load()
        st = state.setdefault(service, {})
        if st.get("hold"):
            raise AISError("on_hold", f"{service} is on hold: {st['hold']}")
        until = st.get("breaker_open_until")
        if until and until > now:
            raise AISError("breaker_open", f"{service} is paused after an error (status {st.get('last_status')}); retry in {round(until - now)} s", retry_after_s=until - now)
        last = st.get("last_call")
        if last and now - last < svc.min_interval_s:
            raise AISError("too_soon", f"{service}: minimum interval {svc.min_interval_s:g} s", retry_after_s=svc.min_interval_s - (now - last))
        recent = [x for x in st.get("recent", []) if now - x < 60]
        if svc.max_per_minute and len(recent) >= svc.max_per_minute:
            raise AISError("rate_limited", f"{service}: at most {svc.max_per_minute} calls per minute", retry_after_s=60 - (now - recent[0]))
        used = st.get("used", 0)
        if svc.quota is not None:
            if used >= svc.quota:
                raise AISError("quota_exhausted", f"{service}: all {svc.quota} calls used")
            if used >= (svc.dev_cap or 0) and not allow_beyond_dev_cap:
                raise AISError("quota_cap", f"{service}: development cap of {svc.dev_cap} calls reached ({used} used of {svc.quota}); the rest is reserved")

        # ---- the request. From here on the call counts, whatever happens.
        st["last_call"] = now
        st["used"] = used + 1
        st["recent"] = [*recent, now] if svc.max_per_minute else []
        self._save(state)
        http, status, msg, body, error = None, None, "", None, None
        t0 = time.time()
        try:
            with httpx.Client(timeout=TIMEOUT_S, transport=self._transport, headers={"User-Agent": "oil-crisis-platform"}) as client:
                resp = client.get(HOST + svc.path, params={"key": self._key, **params})
            http = resp.status_code
            try:
                body = resp.json()
            except ValueError:
                error = AISError("bad_response", f"{service}: reply is not JSON (http {http})")
            else:
                if isinstance(body, dict) and "status" in body:
                    status, msg = body.get("status"), str(body.get("msg", ""))
                else:
                    error = AISError("bad_response", f"{service}: reply has no status field")
        except httpx.TimeoutException:
            error = AISError("timeout", f"{service}: timed out after {TIMEOUT_S:g} s")
        except httpx.HTTPError as e:
            error = AISError("http_error", price_feed.redact(f"{service}: {type(e).__name__}: {e}", self._key))
        ms = round((time.time() - t0) * 1000)

        if error is None and (http != 200 or not (status == 0 or status in svc.benign_statuses)):
            error = AISError("provider_status", f"{service}: http {http}, provider status {status} {price_feed.redact(msg, self._key)}".strip(), status=status)
        self._log(service, http, status, ms, purpose, error)

        state = self._load()
        st = state.setdefault(service, {})
        st.update(last_call=now, used=max(st.get("used", 0), used + 1))
        if error:
            fails = st.get("consecutive_failures", 0) + 1
            wait = min(BACKOFF_START_S * 2 ** (fails - 1), BACKOFF_MAX_S)
            st.update(consecutive_failures=fails, breaker_open_until=now + wait, last_status=status if status is not None else error.kind, last_msg=price_feed.redact(str(error), self._key)[:200])
            self._save(state)
            logger.warning("%s stopped for %d s after: %s", service, wait, error)
            error.retry_after_s = wait
            raise error
        st.update(consecutive_failures=0, breaker_open_until=None, last_status=status, last_msg="")
        self._save(state)
        if raw_dir is not None and raw_name:
            self.save_raw(raw_dir, raw_name, service, params, body)
        return body

    def save_raw(self, raw_dir: Path, name: str, service: str, params: dict, body: dict) -> Path:
        """Raw local copy of a provider response (git-ignored folder). The request parameters are stored WITHOUT the key."""
        raw_dir.mkdir(parents=True, exist_ok=True)
        stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime(self._clock()))
        path = raw_dir / f"{name}_{stamp}.json"
        path.write_text(json.dumps({"service": service, "params": params, "retrieved_at_utc": stamp, "response": body}, ensure_ascii=False, indent=1), encoding="utf-8")
        return path

    def _log(self, service: str, http: int | None, status: int | None, ms: int, purpose: str, error: AISError | None) -> None:
        try:
            self._log_path.parent.mkdir(parents=True, exist_ok=True)
            rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self._clock())), "service": service, "http": http, "status": status, "ms": ms,
                   "purpose": purpose, "error": error.kind if error else None}
            with self._log_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(rec) + "\n")
        except OSError:
            logger.warning("could not write the AIS call log")

    # ------------------------------------------------------------------ thin wrappers (M10 uses the route and port ones; M12 the vessel ones)
    def port_info(self, keywords: str, max_results: int = 5) -> list[dict]:
        return self.call("port_info", {"keywords": keywords, "max": max_results}, f"port info: {keywords}").get("data") or []

    def vessel_search(self, keywords: str, max_results: int = 20) -> list[dict]:
        return self.call("vessel_search", {"keywords": keywords, "max": max_results}, "vessel search").get("data") or []

    def route_plan_port_to_port(self, start_port: str, end_port: str, avoid: list[int] | None = None, **kw) -> dict:
        params: dict[str, Any] = {"start_port_code": start_port, "end_port_code": end_port}
        if avoid:
            params["avoid"] = ",".join(str(a) for a in avoid)
        return self.call("route_port", params, f"route plan {start_port}-{end_port}", **kw)

    def route_plan_point_to_point(self, start_lng_lat: tuple[float, float], end_lng_lat: tuple[float, float], **kw) -> dict:
        params = {"start_point": f"{start_lng_lat[0]},{start_lng_lat[1]}", "end_point": f"{end_lng_lat[0]},{end_lng_lat[1]}"}
        return self.call("route_point", params, "route plan point-to-point", **kw)
