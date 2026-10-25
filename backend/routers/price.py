"""Oil price endpoints.

    GET /api/v1/price/live      -- latest WTI and Brent, change, as-of date, status (DAILY_CLOSE or OFFLINE_FALLBACK; never LIVE)
    GET /api/v1/price/history   -- merged daily series for the sparkline (local CSV plus EIA, no duplicate dates, blank holiday rows skipped)

Both always answer (the CSV is the fallback), so the ticker never has to show an error because EIA is down.
The API key is read from the server environment only and never appears in a response (tests/test_price_feed.py checks this).
"""

from fastapi import APIRouter, HTTPException, Query

from services.price_feed import PriceFeedError, get_service

router = APIRouter(prefix="/api/v1")


@router.get("/price/live")
async def price_live():
    try:
        return await get_service().live()
    except PriceFeedError as e:
        raise HTTPException(status_code=503, detail=f"No price data is available from any source ({e.kind}).")


@router.get("/price/history")
async def price_history(days: int = Query(30, ge=5, le=365, description="How many calendar days back from the newest point")):
    try:
        return await get_service().history(days)
    except PriceFeedError as e:
        raise HTTPException(status_code=503, detail=f"No price data is available from any source ({e.kind}).")
