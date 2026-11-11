"""GET /api/v1/hosted -- what the browser may know about the deployment: hosted or local, which sources are on, their attributions, the disclaimer,
the privacy note and the public repository link. It reads only services.hosted's public table; it never returns a key or an environment value
other than the public repository link."""

from fastapi import APIRouter

from services import hosted

router = APIRouter(prefix="/api/v1")


@router.get("/hosted")
def hosted_config() -> dict:
    return hosted.public_config()


@router.get("/ping")
def ping() -> dict:
    """Keep-warm and health-check target: no external call, no file read, no key. A free host that sleeps when idle is pinged here every few minutes."""
    return {"ok": True}
