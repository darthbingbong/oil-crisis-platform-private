"""M1 data-layer validation: routes.json, importers.json, lithium_usgs.json.

Run from backend/:  python -m pytest tests/test_data_layer.py -v
"""

import json
from pathlib import Path
from typing import Literal

import pytest
from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

DATA = Path(__file__).resolve().parent.parent / "data"


def _load(name: str) -> dict:
    return json.loads((DATA / name).read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Schemas. extra="allow" so notes/extra fields never break the contract, but
# the fields the brief requires are mandatory and typed.
# ---------------------------------------------------------------------------
class Provenance(BaseModel):
    source: str = Field(min_length=3)
    source_url: HttpUrl
    data_year: int = Field(ge=1990, le=2030)
    is_estimate: bool


class Importer(BaseModel):
    country: str
    iso3: str | None
    share_of_route_flow_pct: float = Field(ge=0, le=100)
    level: Literal["country", "group"]
    derived: bool


class Exporter(BaseModel):
    country: str
    share_pct: float | None = Field(ge=0, le=100)


class Route(Provenance):
    model_config = ConfigDict(extra="allow")

    id: str = Field(pattern=r"^[a-z0-9_]+$")
    name: str
    type: Literal["chokepoint", "sea_lane", "pipeline"]
    path: list[list[float]] = Field(min_length=2)
    annual_flow_bpd: float | None = Field(ge=0)
    capacity_bpd: float | None = Field(ge=0)
    flow_basis: Literal["eia_chokepoint_table", "nameplate_capacity_gem", "unverified"]
    share_of_global_seaborne_oil_pct: float | None = Field(ge=0, le=100)
    top_importers: list[Importer]
    top_exporters: list[Exporter]
    bypass_capacity_bpd: float | None = Field(ge=0)
    baseline_voyage_days: float | None = Field(gt=0)
    alt_route_id: str | None
    estimate_fields: list[str]

    @model_validator(mode="after")
    def _check(self):
        for lat, lng in self.path:
            assert -90 <= lat <= 90 and -180 <= lng <= 180, f"{self.id}: bad waypoint {lat},{lng}"
        # is_estimate must be true whenever any field is flagged as an estimate
        if self.estimate_fields and not self.is_estimate:
            # allowed only if every flagged field is a clearly-labelled assumption
            # (voyage days / derived importer groups); those keep is_estimate False
            allowed = ("baseline_voyage_days", "top_importers[")
            assert all(f.startswith(allowed) for f in self.estimate_fields), (
                f"{self.id}: estimate_fields {self.estimate_fields} but is_estimate is False"
            )
        # sea routes carry a sourced flow; pipelines must not pretend capacity is flow
        if self.type == "pipeline":
            assert self.annual_flow_bpd is None, f"{self.id}: pipeline flow must be null (capacity is not flow)"
            assert self.flow_basis != "eia_chokepoint_table"
        else:
            assert self.flow_basis == "eia_chokepoint_table" and self.annual_flow_bpd, self.id
        return self


@pytest.fixture(scope="module")
def routes_doc():
    return _load("routes.json")


@pytest.fixture(scope="module")
def routes(routes_doc):
    return [Route(**r) for r in routes_doc["routes"]]


def test_routes_validate_and_cover_minimum_set(routes):
    ids = {r.id for r in routes}
    required = {
        "hormuz", "bab_el_mandeb", "suez", "malacca", "turkish_straits", "danish_straits",
        "cape_good_hope", "east_west", "habshan_fujairah", "sumed", "druzhba", "btc", "cpc", "taps",
    }
    assert required <= ids, f"missing: {required - ids}"
    assert len(ids) == len(routes), "duplicate route ids"


def test_alt_route_ids_resolve(routes):
    ids = {r.id for r in routes}
    for r in routes:
        assert r.alt_route_id is None or r.alt_route_id in ids, r.id


def test_share_matches_eia_world_maritime_total(routes, routes_doc):
    by_year = routes_doc["_meta"]["global_reference"]["world_maritime_oil_trade_bpd_by_year"]
    for r in routes:
        if r.type != "pipeline":
            total = by_year[str(r.model_extra["baseline_year"])]
            assert r.share_of_global_seaborne_oil_pct == pytest.approx(r.annual_flow_bpd / total * 100, abs=0.1), r.id
            assert r.annual_flow_bpd == r.model_extra["flow_by_year_bpd"][str(r.model_extra["baseline_year"])], r.id


def test_suez_and_bab_default_to_2023_and_store_both_years(routes):
    for rid in ("suez", "bab_el_mandeb"):
        r = next(x for x in routes if x.id == rid)
        assert r.model_extra["baseline_year"] == 2023
        assert {"2023", "2024"} <= set(r.model_extra["flow_by_year_bpd"])
        assert r.model_extra["flow_by_year_bpd"]["2024"] < r.model_extra["flow_by_year_bpd"]["2023"]


def test_voyage_days_are_derived_from_distance_at_14_knots(routes):
    for r in routes:
        d = r.model_extra.get("voyage_derivation")
        if d and r.baseline_voyage_days:
            if d.get("provider"):       # M10: planned sea distance from ShipFinder, not an estimate; provenance must be complete
                assert d["is_estimate"] is False and d["service"] in ("route_port", "route_point") and d["plan_id"] and d["retrieved_at_utc"], r.id
                assert d["previous_hand_estimate"]["days"], r.id
            else:
                assert d["is_estimate"] is True
            assert r.baseline_voyage_days == pytest.approx(d["distance_nm"] / (14 * 24), abs=0.06), r.id


def test_druzhba_is_excluded_and_cpc_not_summed(routes):
    dz = next(r for r in routes if r.id == "druzhba")
    assert dz.model_extra["excluded_from_calculations"] is True and dz.capacity_bpd is None
    cpc = next(r for r in routes if r.id == "cpc")
    assert cpc.capacity_bpd == 1340000 and cpc.model_extra["capacity_upper_bpd"] == 1661315
    assert cpc.is_estimate


def test_hormuz_group_shares_are_consistent(routes):
    h = next(r for r in routes if r.id == "hormuz")
    assert sum(i.share_of_route_flow_pct for i in h.top_importers) == pytest.approx(100)


def test_disclaimer_present_and_every_path_labelled(routes_doc):
    assert "ILLUSTRATIVE" in routes_doc["_meta"]["path_disclaimer"]
    for r in routes_doc["routes"]:
        assert "illustrative" in r["path_note"], r["id"]


def test_importers_validate():
    doc = _load("importers.json")
    for rec in doc["groups"] + doc["countries"]:
        Provenance(**{k: rec[k] for k in ("source", "source_url", "data_year", "is_estimate")})
        assert rec["share_of_route_flow_pct"] is not None or rec["volume_bpd"] is not None
    ids = {r["id"] for r in _load("routes.json")["routes"]}
    assert all(rec["route_id"] in ids for rec in doc["groups"] + doc["countries"])


def test_lithium_validates_and_matches_usgs_totals():
    doc = _load("lithium_usgs.json")
    Provenance(**{k: doc["_meta"][k] for k in ("source", "source_url", "data_year", "is_estimate")})
    world = doc["world"]
    countries = doc["countries"]
    # Guards against the glued-footnote-digit extraction error (see _meta.extraction_note)
    p24 = sum(c["mine_production_t_li"]["2024"] or 0 for c in countries)
    p25 = sum(c["mine_production_t_li"]["2025"] or 0 for c in countries)
    assert p24 == pytest.approx(world["mine_production_t_li"]["2024"], rel=0.01)
    assert p25 == pytest.approx(world["mine_production_t_li"]["2025"], rel=0.01)
    reserves = sum(c["reserves_t_li"] for c in countries)
    assert reserves == pytest.approx(world["reserves_t_li"], rel=0.03)
    assert doc["_meta"]["lce_conversion"]["factor_lce_per_t_li"] == pytest.approx(5.323, abs=0.001)
