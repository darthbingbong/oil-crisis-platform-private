"""Route endpoints.

    GET /api/v1/routes                  -- all routes/pipelines with geometry + summary stats
    GET /api/v1/routes/{id}             -- SUPERSET of the original bypass response: every old key is kept at the
                                           same key with the same value and type; route stats are added alongside
    GET /api/v1/routes/{id}/bypass      -- the original bypass payload only (clean path)

{id} accepts route ids ('bab_el_mandeb') and the original chokepoint spellings ('Bab el-Mandeb', 'bab el-mandeb',
URL-encoded 'bab%20el-mandeb'). The original handler echoed the path value back, so this one does too.
"""

from fastapi import APIRouter, HTTPException

from refineries import load_refineries
from routing import load_bypass_routes, recommend_reroute
from services import calc_engine as ce
from services.config import DEFAULT_CONFIG
from services.route_data import all_routes, get_route, legacy_name, routes_doc

router = APIRouter(prefix="/api/v1")

_refineries_df = load_refineries()
_bypass_df = load_bypass_routes()

KNOWN_LEGACY = {"hormuz", "bab el-mandeb", "suez", "malacca"}

# Keys the original response always had. New fields must never reuse one of these names.
LEGACY_KEYS = ("chokepoint", "capacity_at_risk_bpd", "affected_hubs", "bypass_options",
               "fast_bypass_capacity_bpd", "uncovered_capacity_bpd", "explanation")


def legacy_bypass_payload(chokepoint: str) -> dict:
    """Exactly what the original GET /api/v1/routes/{chokepoint} returned (same rounding, same key order)."""
    result = recommend_reroute(_refineries_df, _bypass_df, chokepoint)
    return {
        "chokepoint": result.chokepoint,
        "capacity_at_risk_bpd": round(result.capacity_at_risk_bpd, 0),
        "affected_hubs": result.affected_hubs,
        "bypass_options": [
            {"via": o.via, "route_type": o.route_type, "capacity_bpd": o.capacity_bpd,
             "extra_transit_days": o.extra_transit_days, "notes": o.notes}
            for o in result.bypass_options
        ],
        "fast_bypass_capacity_bpd": round(result.fast_bypass_capacity_bpd, 0),
        "uncovered_capacity_bpd": round(result.uncovered_capacity_bpd, 0),
        "explanation": result.explanation,
    }


def _legacy_arg(raw: str, route: dict) -> str:
    """What the original handler would have been called with: the raw path value when it was an old spelling
    (it echoed that value back), otherwise the old chokepoint name for a new-style id like 'bab_el_mandeb'."""
    return raw if raw.lower() in KNOWN_LEGACY else legacy_name(route["id"])


def _unknown(raw: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"Unknown chokepoint '{raw}'. Known: {sorted(KNOWN_LEGACY)}")


def _summary(r: dict) -> dict:
    keep = ("id", "name", "type", "path", "annual_flow_bpd", "capacity_bpd", "flow_basis", "baseline_year",
            "share_of_global_seaborne_oil_pct", "bypass_capacity_bpd", "alt_route_id", "source", "source_url",
            "data_year", "is_estimate", "status", "excluded_from_calculations")
    return {k: r[k] for k in keep if k in r}


def _closed_stats(r: dict) -> dict:
    """'If closed' quick stat: barrels per day displaced net of bypass (headline and low-bypass case)."""
    flow = r.get("annual_flow_bpd")
    if not flow or r.get("excluded_from_calculations"):
        return {"if_closed_displaced_bpd": None, "if_closed_displaced_low_bypass_bpd": None, "if_closed_supply_loss_pct": None}
    bypass = r.get("bypass_capacity_bpd") or 0.0
    d = ce.displaced_bpd_blockade(flow, 1.0, bypass)
    low = r.get("bypass_capacity_low_bpd")
    return {
        "if_closed_displaced_bpd": d,
        "if_closed_displaced_low_bypass_bpd": ce.displaced_bpd_blockade(flow, 1.0, low) if low is not None else None,
        "if_closed_supply_loss_pct": ce.supply_loss_pct(d, DEFAULT_CONFIG),
    }


@router.get("/routes")
def list_routes():
    meta = routes_doc()["_meta"]
    return {"path_disclaimer": meta["path_disclaimer"], "current_conditions": meta["current_conditions"],
            "routes": [_summary(r) for r in all_routes()]}


@router.get("/routes/{route_id}/bypass")
def route_bypass(route_id: str):
    route = get_route(route_id)
    if route is None or legacy_name(route["id"]) is None:
        raise _unknown(route_id)
    return legacy_bypass_payload(_legacy_arg(route_id, route))


@router.get("/routes/{route_id}")
def route_detail(route_id: str):
    route = get_route(route_id)
    if route is None:
        raise _unknown(route_id)

    payload: dict = {}
    if legacy_name(route["id"]) is not None:
        payload.update(legacy_bypass_payload(_legacy_arg(route_id, route)))  # old keys first, unchanged
    flow = route.get("annual_flow_bpd")
    new_fields = {
        **route,
        "annual_flow_bbl_per_year": flow * 365 if flow else None,
        "capacity_label": "nameplate capacity" if route["type"] == "pipeline" else None,
        **_closed_stats(route),
        "current_conditions": routes_doc()["_meta"]["current_conditions"],
        "path_disclaimer": routes_doc()["_meta"]["path_disclaimer"],
    }
    clashes = [k for k in new_fields if k in LEGACY_KEYS]
    assert not clashes, f"new field(s) would overwrite legacy keys: {clashes}"
    payload.update(new_fields)
    return payload
