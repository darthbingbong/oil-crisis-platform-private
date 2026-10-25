"""AIS tanker feed (AISStream.io), server-side only. Streams to the browser through WS /ws/vessels (routers/vessels.py).

STATUS: UNVERIFIED AGAINST THE LIVE FEED. No AISStream key was available when this was written, so the adapter follows the provider's published
documentation (https://aisstream.io/documentation, read 25 Oct 2026) and is tested against a mock transport only. Every status the server sends says so
until someone runs it with a real key and the flag below is changed on purpose.

What the documentation says (and this module relies on):
  * Endpoint wss://stream.aisstream.io/v0/stream. The key is sent INSIDE the first message (field "APIKey"), never in the URL. Browsers may not connect directly.
  * The subscription must arrive within 3 s of connecting, and carries BoundingBoxes (pairs of [lat, lon] corners) and optional FilterMessageTypes.
  * The server sends binary frames of UTF-8 JSON: {"MessageType", "MetaData": {...}, "Message": {"<MessageType>": {...}}}.
  * 3 subscribed connections per account, 1 subscription change per second, no SLA or uptime guarantee (FAQ).
  * PositionReport has Sog, Cog, TrueHeading, Latitude, Longitude, UserID. It does NOT carry the ship type. ShipStaticData (sent every few minutes per
    vessel) carries Type (integer AIS ship type), Name, Destination and MaximumStaticDraught.
    The ShipStaticData field names come from the provider's published OpenAPI definition (github.com/aisstream/ais-message-models), not from the docs page.

Consequences handled here:
  * A position is only forwarded once a ShipStaticData for the same MMSI has shown it to be a tanker (type 80 to 89). Until then it is dropped, so a
    vessel can take a few minutes to appear after startup. Non-tankers are remembered and dropped.
  * Dedupe by MMSI (latest position wins) and at most one forwarded update per vessel per THROTTLE_SECONDS.
  * AIS "not available" sentinels are turned into None: Sog 102.3, Cog 360, TrueHeading 511.
  * Flag is derived from the first three digits of the MMSI (the MID). It is the registry the transponder claims, not a verified fact. Unknown MIDs give None.
  * The key is read from AISSTREAM_API_KEY, kept out of logs, errors and every frame sent to the browser.
"""

import asyncio
import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator, Awaitable, Callable

from services import price_feed

logger = logging.getLogger("ais_feed")

AIS_URL = "wss://stream.aisstream.io/v0/stream"
KEY_ENV = "AISSTREAM_API_KEY"
VERIFIED_AGAINST_LIVE_FEED = False          # flip only after a run with a real key has been checked by a person
DISCLAIMER = "UNVERIFIED against the live feed: built from the provider's documentation and tested against a mock transport only."

THROTTLE_SECONDS = 10.0
STALE_AFTER_SECONDS = 30 * 60               # a vessel that has not reported for 30 minutes is dropped from the snapshot
TANKER_TYPES = range(80, 90)                # AIS ship-type codes 80 to 89 = tankers (all hazard categories)
BOX_PADDING_DEG = 1.5
BACKOFF_START, BACKOFF_MAX = 5.0, 300.0

# make sure the shared log redaction also covers this key
if KEY_ENV not in price_feed.SECRET_ENV_NAMES:
    price_feed.SECRET_ENV_NAMES.append(KEY_ENV)


def get_key() -> str:
    return os.environ.get(KEY_ENV, "").strip()


# --------------------------------------------------------------------------------------------------- flag from MMSI prefix
# Maritime Identification Digits (ITU). Only prefixes common among tankers are listed; anything else is reported as unknown rather than guessed.
_MID: dict[int, str] = {}
for _country, _mids in {
    "Marshall Islands": [538], "Liberia": [636, 637], "Panama": [351, 352, 353, 354, 355, 356, 357, 370, 371, 372, 373, 374],
    "Malta": [215, 229, 248, 249, 256], "Greece": [237, 239, 240, 241], "Cyprus": [209, 210, 212], "Bahamas": [308, 309, 311],
    "Singapore": [563, 564, 565, 566], "Hong Kong": [477], "China": [412, 413, 414], "United Arab Emirates": [470, 471],
    "Saudi Arabia": [403], "Iran": [422], "Iraq": [425], "Kuwait": [447], "Qatar": [466], "Oman": [461], "Bahrain": [408],
    "India": [419], "Japan": [431, 432], "South Korea": [440, 441], "United Kingdom": [232, 233, 234, 235], "Norway": [257, 258, 259],
    "Denmark": [219, 220], "Germany": [211], "Netherlands": [244, 245, 246], "Italy": [247], "France": [226, 227, 228],
    "Russia": [273], "Turkey": [271], "United States": [338, 366, 367, 368, 369], "Antigua and Barbuda": [304, 305],
    "Malaysia": [533], "Indonesia": [525], "Egypt": [622], "Yemen": [473, 475], "Djibouti": [621],
}.items():
    for _m in _mids:
        _MID[_m] = _country


def flag_from_mmsi(mmsi: int | str) -> str | None:
    s = str(mmsi)
    return _MID.get(int(s[:3])) if len(s) == 9 and s[:3].isdigit() else None


# --------------------------------------------------------------------------------------------------- bounding boxes
def bounding_boxes(routes: list[dict], pad: float = BOX_PADDING_DEG) -> list[list[list[float]]]:
    """One [[lat, lon], [lat, lon]] box per sea route, around the route's (illustrative) waypoints, padded. Pipelines carry no ships and are skipped."""
    boxes = []
    for r in routes:
        if r.get("type") == "pipeline" or not r.get("path"):
            continue
        lats = [p[0] for p in r["path"]]
        lons = [p[1] for p in r["path"]]
        boxes.append([[max(-90.0, min(lats) - pad), max(-180.0, min(lons) - pad)], [min(90.0, max(lats) + pad), min(180.0, max(lons) + pad)]])
    return boxes


def subscription_message(key: str, boxes: list) -> str:
    return json.dumps({"APIKey": key, "BoundingBoxes": boxes, "FilterMessageTypes": ["PositionReport", "ShipStaticData"]})


# --------------------------------------------------------------------------------------------------- parsing
def _num(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _clean(text: Any) -> str | None:
    if not isinstance(text, str):
        return None
    text = re.sub(r"\s+", " ", text.replace("@", " ")).strip()      # AIS pads text fields with '@'
    return text or None


class VesselProcessor:
    """Turns raw AIS frames into forwarded tanker updates. Pure logic: no network, injectable clock, so it can be tested directly."""

    def __init__(self, clock: Callable[[], float] = time.monotonic):
        self.clock = clock
        self.static: dict[int, dict] = {}            # mmsi -> {name, type, destination, draught_m}
        self.non_tankers: set[int] = set()
        self.vessels: dict[int, dict] = {}           # mmsi -> latest forwarded vessel
        self._last_sent: dict[int, float] = {}
        self.counts = {"frames": 0, "bad_frames": 0, "positions": 0, "dropped_unknown_type": 0, "dropped_not_tanker": 0, "throttled": 0, "forwarded": 0}

    def handle(self, raw: str | bytes) -> dict | None:
        """Process one frame. Returns the vessel update to forward, or None."""
        self.counts["frames"] += 1
        try:
            msg = json.loads(raw.decode("utf-8") if isinstance(raw, (bytes, bytearray)) else raw)
            kind = msg["MessageType"]
            body = msg.get("Message", {}).get(kind, {}) if isinstance(msg.get("Message"), dict) else {}
            meta = msg.get("MetaData") or {}
        except (ValueError, KeyError, TypeError, UnicodeDecodeError):
            self.counts["bad_frames"] += 1
            return None
        if kind == "ShipStaticData":
            self._static(body, meta)
            return None
        if kind == "PositionReport":
            return self._position(body, meta)
        return None                                                    # SubscriptionConfirmation etc.

    @staticmethod
    def _mmsi(body: dict, meta: dict) -> int | None:
        for v in (body.get("UserID"), meta.get("MMSI")):
            if isinstance(v, int) and not isinstance(v, bool) and 100_000_000 <= v <= 999_999_999:
                return v
        return None

    def _static(self, body: dict, meta: dict) -> None:
        mmsi = self._mmsi(body, meta)
        ship_type = body.get("Type")
        if mmsi is None or not isinstance(ship_type, int):
            return
        if ship_type not in TANKER_TYPES:
            self.non_tankers.add(mmsi)
            self.static.pop(mmsi, None)
            self.vessels.pop(mmsi, None)
            return
        self.non_tankers.discard(mmsi)
        draught = _num(body.get("MaximumStaticDraught"))
        self.static[mmsi] = {
            "name": _clean(body.get("Name")) or _clean(meta.get("ShipName")), "ship_type": ship_type,
            "destination": _clean(body.get("Destination")), "draught_m": draught if draught and draught > 0 else None,
        }

    def _position(self, body: dict, meta: dict) -> dict | None:
        self.counts["positions"] += 1
        mmsi = self._mmsi(body, meta)
        lat, lon = _num(body.get("Latitude", meta.get("latitude"))), _num(body.get("Longitude", meta.get("longitude")))
        if mmsi is None or lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0):
            return None
        if mmsi in self.non_tankers:
            self.counts["dropped_not_tanker"] += 1
            return None
        info = self.static.get(mmsi)
        if info is None:
            self.counts["dropped_unknown_type"] += 1
            return None
        now = self.clock()
        if now - self._last_sent.get(mmsi, -1e18) < THROTTLE_SECONDS:
            self.counts["throttled"] += 1
            return None
        sog, cog, heading = _num(body.get("Sog")), _num(body.get("Cog")), _num(body.get("TrueHeading"))
        vessel = {
            "mmsi": str(mmsi), "name": info["name"], "flag": flag_from_mmsi(mmsi), "lat": round(lat, 5), "lon": round(lon, 5),
            "speed_kn": sog if sog is not None and sog < 102.3 else None, "course_deg": cog if cog is not None and cog < 360 else None,
            "heading_deg": heading if heading is not None and heading < 360 else None,
            "destination": info["destination"], "draught_m": info["draught_m"], "ship_type": info["ship_type"],
            "updated_at": _iso(meta.get("time_utc")), "source": "AIS",
        }
        self._last_sent[mmsi] = now
        self.vessels[mmsi] = vessel
        self.counts["forwarded"] += 1
        return vessel

    def prune(self) -> None:
        cutoff = self.clock() - STALE_AFTER_SECONDS
        for mmsi in [m for m, t in self._last_sent.items() if t < cutoff]:
            self._last_sent.pop(mmsi, None)
            self.vessels.pop(mmsi, None)

    def snapshot(self) -> list[dict]:
        return list(self.vessels.values())


def _iso(value: Any) -> str:
    """AISStream's time_utc looks like '2022-12-29 18:22:32.318353 +0000 UTC'. Anything unparseable becomes 'now'."""
    if isinstance(value, str):
        m = re.match(r"(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})", value)
        if m:
            return f"{m.group(1)}T{m.group(2)}Z"
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# --------------------------------------------------------------------------------------------------- connection
Connect = Callable[[str], Any]      # connect(url) -> async context manager yielding an object with send(str) and async iteration


def default_connect(url: str):
    import websockets
    return websockets.connect(url, open_timeout=15, ping_interval=20, max_size=2**20)


def _routes_for_boxes() -> list[dict]:
    from services.route_data import all_routes
    return all_routes()


class VesselHub:
    """Owns the upstream connection (started lazily by the first browser client) and fans vessel updates out to subscribers."""

    def __init__(self, connect: Connect = default_connect, clock: Callable[[], float] = time.monotonic,
                 routes: Callable[[], list[dict]] = _routes_for_boxes, sleep: Callable[[float], Awaitable] = asyncio.sleep):
        self.connect, self.clock, self._routes, self._sleep = connect, clock, routes, sleep
        self.processor = VesselProcessor(clock)
        self.state = "idle"                     # idle | no_key | connecting | streaming | error
        self.detail = "not started"
        self.last_frame_at: str | None = None
        self.connections_opened = 0
        self._queues: set[asyncio.Queue] = set()
        self._task: asyncio.Task | None = None

    # ---- public
    def status(self) -> dict:
        has_key = bool(get_key())
        state = self.state if has_key else "no_key"
        return {
            "type": "status", "provider": "AISStream.io", "state": state,
            "detail": self.detail if has_key else f"No {KEY_ENV} is configured on the server, so there is no AIS feed. Simulated vessels only.",
            "verified_against_live_feed": VERIFIED_AGAINST_LIVE_FEED, "disclaimer": DISCLAIMER,
            "last_frame_at": self.last_frame_at, "vessel_count": len(self.processor.vessels), "counts": dict(self.processor.counts),
        }

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=2000)
        self._queues.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._queues.discard(q)

    def ensure_running(self) -> None:
        if not get_key():
            self.state, self.detail = "no_key", f"No {KEY_ENV} configured"
            return
        if self._task is None or self._task.done():
            self._task = asyncio.get_running_loop().create_task(self.run())

    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass

    # ---- internals
    def _publish(self, vessel: dict) -> None:
        for q in list(self._queues):
            try:
                q.put_nowait(vessel)
            except asyncio.QueueFull:
                pass                                                   # a slow browser loses updates rather than stalling the feed

    async def run(self) -> None:
        backoff = BACKOFF_START
        while True:
            key = get_key()
            if not key:
                self.state, self.detail = "no_key", f"No {KEY_ENV} configured"
                return
            self.state, self.detail = "connecting", "connecting to AISStream"
            try:
                async with self.connect(AIS_URL) as ws:
                    self.connections_opened += 1
                    await ws.send(subscription_message(key, bounding_boxes(self._routes())))   # must arrive within 3 s
                    got_frame = False
                    async for raw in ws:
                        if not got_frame:
                            got_frame, backoff = True, BACKOFF_START
                            self.state, self.detail = "streaming", "receiving frames"
                        self.last_frame_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                        update = self.processor.handle(raw)
                        if update is not None:
                            self._publish({"type": "vessel", **update})
                        if self.processor.counts["frames"] % 500 == 0:
                            self.processor.prune()
                    self.state, self.detail = "error", "stream closed by the server" if got_frame else "connection closed before any data (invalid key, limit, or provider outage)"
            except asyncio.CancelledError:
                raise
            except Exception as exc:                                   # network error, handshake rejected, bad key, timeout
                self.state, self.detail = "error", f"{type(exc).__name__}: {price_feed.redact(str(exc), key)[:160]}"
            logger.warning("AIS feed %s; retrying in %.0f s", price_feed.redact(self.detail, key), backoff)
            await self._sleep(backoff)
            backoff = min(BACKOFF_MAX, backoff * 2)


_hub: VesselHub | None = None


def get_hub() -> VesselHub:
    global _hub
    if _hub is None:
        _hub = VesselHub()
    return _hub
