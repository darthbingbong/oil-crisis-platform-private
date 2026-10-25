"""Tanker positions.

    WS  /ws/vessels              -- streamed tanker updates from the AIS provider (server-side key). First frame is always a status frame.
    GET /api/v1/vessels/status   -- the same status as one JSON object

Frames sent to the browser:
    {"type": "status", "state": "no_key" | "connecting" | "streaming" | "error" | "idle", "detail", "verified_against_live_feed": false, "disclaimer", ...}
    {"type": "snapshot", "vessels": [...]}        sent once after the status frame when the feed is configured
    {"type": "vessel", "mmsi", "name", "flag", "lat", "lon", "speed_kn", "course_deg", "heading_deg", "destination", "draught_m", ...}
Without a key the status frame is followed by a normal close: the browser then stays on simulated vessels. Simulated vessels are NEVER sent from here:
this endpoint only ever carries what the AIS provider reported.
"""

import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from services import ais_feed

router = APIRouter()
STATUS_EVERY_SECONDS = 15


@router.get("/api/v1/vessels/status")
def vessels_status() -> dict:
    return ais_feed.get_hub().status()


@router.websocket("/ws/vessels")
async def ws_vessels(ws: WebSocket) -> None:
    hub = ais_feed.get_hub()
    await ws.accept()
    hub.ensure_running()
    await ws.send_json(hub.status())
    if not ais_feed.get_key():
        await ws.close(code=1000, reason="no AIS key configured")
        return
    queue = hub.subscribe()
    try:
        await ws.send_json({"type": "snapshot", "vessels": hub.processor.snapshot()})
        while True:
            try:
                await ws.send_json(await asyncio.wait_for(queue.get(), timeout=STATUS_EVERY_SECONDS))
            except asyncio.TimeoutError:
                await ws.send_json(hub.status())
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        hub.unsubscribe(queue)
