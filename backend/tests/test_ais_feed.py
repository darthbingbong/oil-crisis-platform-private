"""AIS adapter tests. ALL of these run against a mock transport: nothing here proves the adapter works against the live AISStream feed."""
import asyncio
import json
import logging
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from services import ais_feed as af

BACKEND = Path(__file__).resolve().parent.parent
FAKE_KEY = "ais-test-key-1234567890abcdef"
ROUTES = lambda: [{"type": "chokepoint", "path": [[26, 50], [24, 60]]}]  # noqa: E731


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def static(mmsi, typ=80, name="TEST TANKER@@@", dest="FUJAIRAH@@", draught=12.3):
    return json.dumps({"MessageType": "ShipStaticData", "MetaData": {"MMSI": mmsi, "ShipName": name},
                       "Message": {"ShipStaticData": {"UserID": mmsi, "Name": name, "Type": typ, "Destination": dest, "MaximumStaticDraught": draught}}})


def pos(mmsi, lat=26.5, lon=56.2, sog=11.4, cog=88.0, hdg=90, t="2026-10-25 08:00:00.123456 +0000 UTC"):
    return json.dumps({"MessageType": "PositionReport", "MetaData": {"MMSI": mmsi, "ShipName": "X", "latitude": lat, "longitude": lon, "time_utc": t},
                       "Message": {"PositionReport": {"UserID": mmsi, "Latitude": lat, "Longitude": lon, "Sog": sog, "Cog": cog, "TrueHeading": hdg}}})


# ------------------------------------------------------------------ processor
def test_position_is_dropped_until_static_data_shows_a_tanker():
    p = af.VesselProcessor(Clock())
    assert p.handle(pos(477000001)) is None and p.counts["dropped_unknown_type"] == 1
    p.handle(static(477000001))
    v = p.handle(pos(477000001))
    assert v and v["mmsi"] == "477000001" and v["name"] == "TEST TANKER" and v["destination"] == "FUJAIRAH" and v["draught_m"] == 12.3
    assert v["flag"] == "Hong Kong" and v["speed_kn"] == 11.4 and v["course_deg"] == 88.0 and v["source"] == "AIS"
    assert v["updated_at"] == "2026-10-25T08:00:00Z"


@pytest.mark.parametrize("typ,kept", [(79, False), (80, True), (84, True), (89, True), (90, False), (70, False), (30, False)])
def test_only_tanker_types_80_to_89_are_kept(typ, kept):
    p = af.VesselProcessor(Clock())
    p.handle(static(538000001, typ))
    assert (p.handle(pos(538000001)) is not None) is kept


def test_a_vessel_later_reported_as_non_tanker_is_removed():
    p = af.VesselProcessor(Clock())
    p.handle(static(538000002, 80))
    assert p.handle(pos(538000002))
    p.handle(static(538000002, 70))
    assert 538000002 not in p.vessels and p.handle(pos(538000002)) is None


def test_throttle_is_one_update_per_vessel_per_ten_seconds_and_per_mmsi():
    clock = Clock()
    p = af.VesselProcessor(clock)
    p.handle(static(538000003))
    p.handle(static(538000004))
    assert p.handle(pos(538000003)) and p.handle(pos(538000004))
    clock.t += 3
    assert p.handle(pos(538000003)) is None and p.handle(pos(538000004)) is None and p.counts["throttled"] == 2
    clock.t += 7.1
    assert p.handle(pos(538000003, lat=26.6))["lat"] == 26.6


def test_dedupe_by_mmsi_keeps_only_the_latest_position():
    clock = Clock()
    p = af.VesselProcessor(clock)
    p.handle(static(538000005))
    p.handle(pos(538000005, lat=26.1))
    clock.t += 11
    p.handle(pos(538000005, lat=26.2))
    assert len(p.snapshot()) == 1 and p.snapshot()[0]["lat"] == 26.2


def test_not_available_sentinels_become_none():
    p = af.VesselProcessor(Clock())
    p.handle(static(538000006))
    v = p.handle(pos(538000006, sog=102.3, cog=360, hdg=511))
    assert v["speed_kn"] is None and v["course_deg"] is None and v["heading_deg"] is None


@pytest.mark.parametrize("lat,lon", [(91, 10), (10, 181), (0, 0)])
def test_invalid_positions_are_dropped(lat, lon):
    p = af.VesselProcessor(Clock())
    p.handle(static(538000007))
    assert p.handle(pos(538000007, lat=lat, lon=lon)) is None


def test_garbage_frames_are_counted_not_raised():
    p = af.VesselProcessor(Clock())
    for raw in ("not json", "{}", b"\xff\xfe", json.dumps({"MessageType": "PositionReport", "Message": []}),
                json.dumps({"MessageType": "SubscriptionConfirmation", "Message": {}})):
        assert p.handle(raw) is None
    assert p.counts["bad_frames"] >= 3


def test_binary_frames_are_decoded():
    p = af.VesselProcessor(Clock())
    p.handle(static(538000008).encode())
    assert p.handle(pos(538000008).encode())


def test_flag_from_mmsi_and_unknown():
    assert af.flag_from_mmsi(538123456) == "Marshall Islands" and af.flag_from_mmsi("636000000") == "Liberia"
    assert af.flag_from_mmsi(999123456) is None and af.flag_from_mmsi("123") is None


def test_boxes_cover_sea_routes_only_and_use_lat_lon_order():
    routes = [{"type": "chokepoint", "path": [[26.7, 50.2], [22.5, 62.5]]}, {"type": "pipeline", "path": [[1, 1], [2, 2]]}]
    boxes = af.bounding_boxes(routes, pad=1)
    assert len(boxes) == 1 and boxes[0] == [[21.5, 49.2], [27.7, 63.5]]


def test_subscription_message_shape():
    m = json.loads(af.subscription_message("K", [[[1, 2], [3, 4]]]))
    assert m == {"APIKey": "K", "BoundingBoxes": [[[1, 2], [3, 4]]], "FilterMessageTypes": ["PositionReport", "ShipStaticData"]}


# ------------------------------------------------------------------ mock transport
class MockWS:
    def __init__(self, frames, hold, sent):
        self.frames, self.hold, self.sent = frames, hold, sent

    async def send(self, text):
        self.sent.append(text)

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for f in self.frames:
            yield f
        if self.hold:
            await asyncio.Event().wait()


class MockConnect:
    def __init__(self, frames=(), hold=True, error=None):
        self.frames, self.hold, self.error, self.urls, self.sent = list(frames), hold, error, [], []

    def __call__(self, url):
        self.urls.append(url)
        outer = self

        class Ctx:
            async def __aenter__(self_):
                if outer.error:
                    raise outer.error
                return MockWS(outer.frames, outer.hold, outer.sent)

            async def __aexit__(self_, *a):
                return False

        return Ctx()


@pytest.fixture
def hub_with(monkeypatch):
    def make(connect, key=FAKE_KEY):
        if key:
            monkeypatch.setenv(af.KEY_ENV, key)
        else:
            monkeypatch.delenv(af.KEY_ENV, raising=False)

        async def quick_sleep(_):
            await asyncio.sleep(0.01)

        return af.VesselHub(connect=connect, routes=ROUTES, sleep=quick_sleep)
    return make


def run_hub(hub, seconds=0.3):
    async def go():
        q = hub.subscribe()
        task = asyncio.create_task(hub.run())
        await asyncio.sleep(seconds)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        return [q.get_nowait() for _ in range(q.qsize())]
    return asyncio.run(go())


def test_hub_streams_only_tankers_and_sends_the_key_only_in_the_subscription(hub_with):
    mock = MockConnect([json.dumps({"MessageType": "SubscriptionConfirmation", "Message": {}}), static(538000010, 80), static(538000011, 70),
                        pos(538000010), pos(538000011)])
    hub = hub_with(mock)
    out = run_hub(hub)
    assert [v["mmsi"] for v in out] == ["538000010"] and hub.state == "streaming"
    assert mock.urls == [af.AIS_URL] and FAKE_KEY not in mock.urls[0]
    sub = json.loads(mock.sent[0])
    assert sub["APIKey"] == FAKE_KEY and sub["BoundingBoxes"] and "PositionReport" in sub["FilterMessageTypes"]


def test_hub_without_a_key_never_connects(hub_with):
    mock = MockConnect([])
    hub = hub_with(mock, key=None)
    assert run_hub(hub, 0.1) == [] and mock.urls == [] and hub.status()["state"] == "no_key"
    assert hub.status()["verified_against_live_feed"] is False


def test_closed_connection_is_an_error_state_and_it_retries(hub_with):
    mock = MockConnect([], hold=False)
    hub = hub_with(mock)
    run_hub(hub, 0.2)
    assert hub.state == "error" and "before any data" in hub.detail and len(mock.urls) >= 2


def test_connection_error_text_never_contains_the_key(hub_with, caplog):
    caplog.set_level(logging.DEBUG)
    mock = MockConnect(error=RuntimeError(f"handshake failed for key {FAKE_KEY} " + '{"APIKey": "' + FAKE_KEY + '"}'))
    hub = hub_with(mock)
    run_hub(hub, 0.2)
    blob = json.dumps(hub.status()) + caplog.text + "".join(r.getMessage() for r in caplog.records)
    assert hub.state == "error" and FAKE_KEY not in blob


def test_redaction_covers_the_json_subscription_body_and_the_env_value(monkeypatch):
    from services import price_feed
    monkeypatch.setenv(af.KEY_ENV, FAKE_KEY)
    text = price_feed.redact(af.subscription_message(FAKE_KEY, []) + " raw " + FAKE_KEY)
    assert FAKE_KEY not in text and "REDACTED" in text


def test_status_always_says_unverified():
    s = af.VesselHub().status()
    assert s["verified_against_live_feed"] is False and "UNVERIFIED" in s["disclaimer"]


# ------------------------------------------------------------------ the WebSocket endpoint
@pytest.fixture
def client(monkeypatch):
    import main
    monkeypatch.setattr(af, "_hub", None)
    yield TestClient(main.app)        # deliberately NOT "with TestClient(...)": that would run the app's startup (NewsAPI polling, GDELT warm-up)
    monkeypatch.setattr(af, "_hub", None)


def test_ws_without_a_key_sends_status_then_closes(client, monkeypatch):
    monkeypatch.delenv(af.KEY_ENV, raising=False)
    with client.websocket_connect("/ws/vessels") as ws:
        first = ws.receive_json()
        assert first["type"] == "status" and first["state"] == "no_key" and first["verified_against_live_feed"] is False
        with pytest.raises(Exception):
            ws.receive_json()


def test_ws_with_a_mock_feed_delivers_vessels_and_no_frame_contains_the_key(client, monkeypatch, caplog):
    caplog.set_level(logging.DEBUG)
    monkeypatch.setenv(af.KEY_ENV, FAKE_KEY)
    mock = MockConnect([static(538000020), pos(538000020)])
    monkeypatch.setattr(af, "_hub", af.VesselHub(connect=mock, routes=ROUTES))
    frames = []
    with client.websocket_connect("/ws/vessels") as ws:
        frames.append(ws.receive_json())                    # status
        frames.append(ws.receive_json())                    # snapshot (the vessel may already be in it) ...
        if not frames[-1]["vessels"]:
            frames.append(ws.receive_json())                # ... otherwise it arrives as a live update
    assert frames[0]["type"] == "status" and frames[1]["type"] == "snapshot"
    delivered = [v["mmsi"] for f in frames for v in (f.get("vessels") or ([f] if f["type"] == "vessel" else []))]
    assert delivered == ["538000020"]
    assert FAKE_KEY not in json.dumps(frames) + caplog.text
    assert FAKE_KEY not in json.dumps(client.get("/api/v1/vessels/status").json())


def test_the_frontend_never_contains_the_ais_key_or_its_env_name():
    secrets = [FAKE_KEY]
    env = BACKEND / ".env"
    if env.exists():
        m = re.search(r"^AISSTREAM_API_KEY\s*=\s*(\S+)", env.read_text(encoding="utf-8"), re.M)
        if m and len(m.group(1)) >= 8:
            secrets.append(m.group(1).strip("\"'"))
    for folder in (BACKEND.parent / "frontend" / "src", BACKEND.parent / "frontend" / "dist"):
        if not folder.exists():
            continue
        for p in folder.rglob("*"):
            if p.is_file() and p.suffix in (".ts", ".tsx", ".js", ".css", ".html", ".json", ".map"):
                text = p.read_text(encoding="utf-8", errors="ignore")
                assert "AISSTREAM_API_KEY" not in text and not any(s in text for s in secrets), p
