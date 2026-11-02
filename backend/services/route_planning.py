"""Real sea distances for the five representative voyages (ShipFinder route planning), with plausibility checks run BEFORE anything is stored.

The voyage-day figures in routes.json used to be great-circle sums over hand-placed waypoints. Each plan below replaces one of them. A result is only
accepted if (1) the distance is within a band around today's estimate, (2) the planner's own distance matches the length of the waypoint line it returned,
(3) the route really passes through the straits the voyage is supposed to use (and avoids the ones it must avoid), and (4) the Cape voyage is clearly
longer than the Suez voyage. A result that fails is kept as a raw copy only and the run stops.
"""

import math
from dataclasses import dataclass, field

TANKER_KNOTS = 14.0
EARTH_RADIUS_NM = 3440.065

# (lat_min, lat_max, lng_min, lng_max). Rough boxes around each strait; wide on purpose, they only need to tell "passes there" from "does not".
BOX = {
    "hormuz":      (25.5, 27.5, 55.0, 57.5),
    "bab_el_mandeb": (12.2, 13.2, 43.0, 43.8),
    "suez_canal":  (29.8, 31.4, 32.2, 32.7),
    "red_sea":     (13.3, 27.5, 33.0, 43.0),
    "malacca":     (1.0, 6.0, 98.0, 104.5),
    "bosphorus":   (40.9, 41.3, 28.9, 29.3),
    "dardanelles": (39.9, 40.5, 26.0, 26.8),
    "danish":      (54.5, 58.0, 9.5, 13.5),
    "cape":        (-37.5, -33.0, 15.0, 30.0),
}


@dataclass(frozen=True)
class Plan:
    id: str
    service: str                       # "route_port" or "route_point"
    params: dict
    replaces: tuple[str, ...]          # route ids whose baseline_voyage_days this voyage defines
    estimate_nm: float                 # today's hand-waypoint distance
    band: tuple[float, float]          # accepted multiple of the estimate
    must_pass: tuple[str, ...] = ()
    must_avoid: tuple[str, ...] = ()
    note: str = ""
    cross_check_of: str | None = None  # plan id this point-to-point result is compared with


PLANS: list[Plan] = [
    Plan("ras_tanura_rotterdam_suez", "route_port", {"start_port": "SARTA", "end_port": "NLRTM"}, ("bab_el_mandeb", "suez"), 7126, (0.75, 1.30),
         must_pass=("hormuz", "bab_el_mandeb", "suez_canal"), note="Ras Tanura to Rotterdam via Hormuz, Bab el-Mandeb and Suez"),
    Plan("ras_tanura_rotterdam_cape", "route_port", {"start_port": "SARTA", "end_port": "NLRTM", "avoid": [2]}, ("cape_good_hope",), 11401, (0.80, 1.25),
         must_pass=("hormuz", "cape"), must_avoid=("suez_canal", "red_sea", "bab_el_mandeb"), note="same ports, avoid=2 (Suez Canal) forces the Cape"),
    Plan("ras_tanura_ningbo", "route_port", {"start_port": "SARTA", "end_port": "CNNBG"}, ("hormuz", "malacca"), 5784, (0.85, 1.30),
         must_pass=("hormuz", "malacca"), note="Ras Tanura to Ningbo via Hormuz and Malacca"),
    Plan("novorossiysk_trieste", "route_port", {"start_port": "RUNVS", "end_port": "ITTRS"}, ("turkish_straits",), 1704, (0.80, 1.40),
         must_pass=("bosphorus", "dardanelles"), note="Novorossiysk to Trieste via the Turkish Straits"),
    Plan("primorsk_rotterdam", "route_port", {"start_port": "RUPRI", "end_port": "NLRTM"}, ("danish_straits",), 1425, (0.80, 1.50),
         must_pass=("danish",), note="Primorsk to Rotterdam via the Danish Straits"),
    Plan("xcheck_ras_tanura_ningbo_point", "route_point", {"start": (50.15, 26.7), "end": (122.2, 29.9)}, (), 5784, (0.85, 1.30),
         must_pass=("hormuz", "malacca"), note="point-to-point cross-check of the Port-to-Port result", cross_check_of="ras_tanura_ningbo"),
    Plan("xcheck_primorsk_rotterdam_point", "route_point", {"start": (28.6, 60.35), "end": (4.1, 51.95)}, (), 1425, (0.80, 1.50),
         must_pass=("danish",), note="point-to-point cross-check of the Port-to-Port result", cross_check_of="primorsk_rotterdam"),
]
PLAN_BY_ID = {p.id: p for p in PLANS}


def voyage_days(distance_nm: float) -> float:
    return round(distance_nm / (TANKER_KNOTS * 24), 1)


def gc_nm(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * EARTH_RADIUS_NM * math.asin(math.sqrt(h))


def polyline_nm(route: list[dict]) -> float:
    pts = [(p["lat"], p["lng"]) for p in route]
    return sum(gc_nm(a, b) for a, b in zip(pts, pts[1:]))


def _in(box: str, p: dict) -> bool:
    la0, la1, lo0, lo1 = BOX[box]
    return la0 <= p["lat"] <= la1 and lo0 <= p["lng"] <= lo1


def crosses(box: str, route: list[dict], step_deg: float = 0.05) -> int:
    """Number of sample points, taken along every SEGMENT of the route (not only at its waypoints), that fall inside the box.
    The planner draws a canal as one long straight segment between two sparse waypoints (Suez: 29.5 N to 31.5 N), so waypoints alone miss it."""
    hits = 0
    for a, b in zip(route, route[1:]):
        n = max(1, int(max(abs(b["lat"] - a["lat"]), abs(b["lng"] - a["lng"])) / step_deg))
        for i in range(n + 1):
            f = i / n
            if _in(box, {"lat": a["lat"] + f * (b["lat"] - a["lat"]), "lng": a["lng"] + f * (b["lng"] - a["lng"])}):
                hits += 1
    return hits


def check(plan: Plan, body: dict, stored: dict[str, dict] | None = None) -> list[str]:
    """Returns the list of problems (empty = plausible). `stored` holds already-accepted results by plan id for the relation checks."""
    stored = stored or {}
    problems: list[str] = []
    data = body.get("data") if isinstance(body, dict) else None
    if not isinstance(data, dict) or not isinstance(data.get("distance"), (int, float)) or not isinstance(data.get("route"), list):
        return ["response has no data.distance / data.route"]
    nm, route = float(data["distance"]), data["route"]
    if len(route) < 5 or any(not isinstance(p, dict) or "lat" not in p or "lng" not in p for p in route):
        return [f"route has {len(route)} usable waypoints"]
    lo, hi = plan.band[0] * plan.estimate_nm, plan.band[1] * plan.estimate_nm
    if not lo <= nm <= hi:
        problems.append(f"distance {nm:.0f} nm is outside {lo:.0f} to {hi:.0f} nm (today's estimate {plan.estimate_nm:.0f} nm)")
    line = polyline_nm(route)
    if abs(line - nm) / nm > 0.08:
        problems.append(f"reported distance {nm:.0f} nm differs from the waypoint line length {line:.0f} nm by more than 8%")
    for b in plan.must_pass:
        if not crosses(b, route):
            problems.append(f"route does not pass through {b}")
    for b in plan.must_avoid:
        if crosses(b, route):
            problems.append(f"route should avoid {b} but it passes through it")
    if plan.id == "ras_tanura_rotterdam_cape":
        suez = stored.get("ras_tanura_rotterdam_suez")
        if not suez:
            problems.append("the Suez result must be stored first so the Cape result can be compared with it")
        elif not (nm >= 1.3 * suez["distance_nm"] and nm - suez["distance_nm"] >= 2500):
            problems.append(f"Cape {nm:.0f} nm is not clearly longer than Suez {suez['distance_nm']:.0f} nm (need at least 1.3x and 2,500 nm more)")
    if plan.cross_check_of and plan.cross_check_of in stored:
        ref = stored[plan.cross_check_of]["distance_nm"]
        if abs(nm - ref) / ref > 0.10:
            problems.append(f"point-to-point {nm:.0f} nm and port-to-port {ref:.0f} nm differ by more than 10%")
    return problems
