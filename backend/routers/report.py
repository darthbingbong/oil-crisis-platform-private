"""POST /api/v1/simulate/report -- full scenario report for the Results page."""

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.report import ScenarioError, build_report
from services.route_data import get_route

router = APIRouter(prefix="/api/v1")


class ReportRequest(BaseModel):
    route_id: str = Field(..., description="Route id from GET /api/v1/routes, e.g. 'hormuz' or 'suez'")
    disruption_type: Literal["blockade", "detour"] = "blockade"
    blocked_share_pct: float = Field(100, ge=0, le=100, description="Blockade: share of route flow blocked")
    detour_days: float | None = Field(None, ge=0, le=120, description="Detour: extra voyage days (defaults to the route's derived Cape detour if set)")
    duration_days: float = Field(30, gt=0, le=730, description="How long the disruption lasts")
    conflict_intensity: float = Field(5, ge=0, le=10)
    demand_change_pct: float = Field(0, ge=-50, le=50)
    ev_substitution_rate_pct: float = Field(100, ge=0, le=100, description="Share of lost fuel demand replaced by EVs")
    lithium_availability_pct: float = Field(10, ge=0, le=100, description="Share of current world lithium production available as a cap. Default 10: USGS shows production exceeds consumption by only ~9%")
    fleet_constrained: bool = Field(True, description="Detour: fixed tanker fleet (worst case) if true")
    horizon_years: int = Field(5, ge=1, le=10, description="Horizon for the headline EV/lithium numbers")
    baseline_year: int | None = Field(None, description="Override the route's baseline year (e.g. 2024 for Suez)")


@router.post("/simulate/report")
def simulate_report(req: ReportRequest):
    route = get_route(req.route_id)
    if route is None:
        raise HTTPException(status_code=404, detail=f"Unknown route '{req.route_id}'")
    try:
        return build_report(route, req.model_dump())
    except ScenarioError as e:
        raise HTTPException(status_code=422, detail=str(e))
