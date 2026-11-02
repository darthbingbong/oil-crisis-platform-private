"""The plausibility checks that guard what is stored from route planning: distance band, line-length match, required and forbidden straits, Cape vs Suez."""
import math

from services import route_planning as rp


def wp(*pts):
    return [{"lat": a, "lng": b} for a, b in pts]


def body(points, nm=None):
    nm = rp.polyline_nm(points) if nm is None else nm
    return {"status": 0, "msg": "", "data": {"distance": nm, "route": points}}


SUEZ_ROUTE = wp((26.7, 50.2), (26.5, 56.3), (23.0, 60.0), (13.0, 50.0), (12.7, 43.4), (20.0, 38.5), (27.7, 33.6), (30.2, 32.55), (31.3, 32.3), (34.0, 28.0),
                (36.0, 14.0), (36.0, -5.5), (43.5, -9.5), (48.5, -5.5), (51.9, 4.0))
CAPE_ROUTE = wp((26.7, 50.2), (26.5, 56.3), (23.0, 60.0), (5.0, 55.0), (-10.0, 48.0), (-25.0, 38.0), (-34.5, 25.0), (-35.0, 19.0), (-28.0, 13.0), (-15.0, 8.0),
                (0.0, 2.0), (15.0, -17.5), (37.0, -9.5), (48.5, -5.5), (51.9, 4.0))


def test_voyage_days_uses_14_knots():
    assert rp.voyage_days(7126) == 21.2 and rp.voyage_days(5784) == 17.2 and rp.voyage_days(1704) == 5.1


def test_a_good_suez_result_passes():
    assert rp.check(rp.PLAN_BY_ID["ras_tanura_rotterdam_suez"], body(SUEZ_ROUTE)) == []


def test_distance_outside_the_band_is_rejected():
    plan = rp.PLAN_BY_ID["ras_tanura_rotterdam_suez"]
    short = body(SUEZ_ROUTE, nm=2000)
    assert any("outside" in p for p in rp.check(plan, short))


def test_reported_distance_must_match_the_waypoint_line():
    plan = rp.PLAN_BY_ID["ras_tanura_rotterdam_suez"]
    real = rp.polyline_nm(SUEZ_ROUTE)
    assert any("waypoint line" in p for p in rp.check(plan, body(SUEZ_ROUTE, nm=real * 1.2)))


def test_suez_route_that_skips_the_canal_is_rejected():
    plan = rp.PLAN_BY_ID["ras_tanura_rotterdam_suez"]
    problems = rp.check(plan, body(CAPE_ROUTE))
    assert any("suez_canal" in p for p in problems) and any("bab_el_mandeb" in p for p in problems)


def test_cape_route_that_still_uses_suez_is_rejected():
    plan = rp.PLAN_BY_ID["ras_tanura_rotterdam_cape"]
    stored = {"ras_tanura_rotterdam_suez": {"distance_nm": 6400}}
    problems = rp.check(plan, body(SUEZ_ROUTE, nm=rp.polyline_nm(SUEZ_ROUTE)), stored)
    assert any("avoid suez_canal" in p for p in problems) and any("does not pass through cape" in p for p in problems)


def test_cape_route_passes_when_clearly_longer_than_suez():
    plan = rp.PLAN_BY_ID["ras_tanura_rotterdam_cape"]
    suez_nm = rp.polyline_nm(SUEZ_ROUTE)
    assert rp.check(plan, body(CAPE_ROUTE), {"ras_tanura_rotterdam_suez": {"distance_nm": suez_nm}}) == []


def test_cape_route_not_clearly_longer_than_suez_is_rejected():
    plan = rp.PLAN_BY_ID["ras_tanura_rotterdam_cape"]
    cape_nm = rp.polyline_nm(CAPE_ROUTE)
    problems = rp.check(plan, body(CAPE_ROUTE), {"ras_tanura_rotterdam_suez": {"distance_nm": cape_nm * 0.9}})
    assert any("not clearly longer" in p for p in problems)


def test_cape_cannot_be_judged_before_suez_is_stored():
    assert any("must be stored first" in p for p in rp.check(rp.PLAN_BY_ID["ras_tanura_rotterdam_cape"], body(CAPE_ROUTE), {}))


def test_malformed_responses_are_rejected_not_crashed():
    plan = rp.PLAN_BY_ID["novorossiysk_trieste"]
    assert rp.check(plan, {"status": 0, "data": {}})
    assert rp.check(plan, {"status": 0, "data": {"distance": 1700, "route": [{"lat": 1, "lng": 2}]}})
    assert rp.check(plan, {"status": 0, "data": {"distance": 1700, "route": [{"lat": 1}] * 6}})
    assert rp.check(plan, "nope")


def test_point_to_point_cross_check_flags_a_big_disagreement():
    plan = rp.PLAN_BY_ID["xcheck_primorsk_rotterdam_point"]
    pts = wp((60.3, 28.6), (59.5, 24.0), (57.0, 18.5), (55.0, 14.0), (55.3, 10.9), (57.8, 10.7), (56.5, 3.5), (51.9, 4.1))
    nm = rp.polyline_nm(pts)
    assert rp.check(plan, body(pts), {"primorsk_rotterdam": {"distance_nm": nm}}) == []
    assert any("differ by more than 10%" in p for p in rp.check(plan, body(pts), {"primorsk_rotterdam": {"distance_nm": nm * 1.25}}))


def test_every_plan_has_an_estimate_a_band_and_known_boxes():
    for p in rp.PLANS:
        assert p.estimate_nm > 0 and p.band[0] < 1 < p.band[1]
        assert all(b in rp.BOX for b in p.must_pass + p.must_avoid)
    assert len({p.id for p in rp.PLANS}) == 7 and sum(p.service == "route_port" for p in rp.PLANS) == 5
    assert math.isclose(rp.gc_nm((0, 0), (0, 1)), 60.0, rel_tol=0.01)
