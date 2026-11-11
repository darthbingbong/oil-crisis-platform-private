"""The two sets of voyage distances (DECISIONS D29).

data/routes.json holds the ShipFinder-derived set (v2.0): baseline_voyage_days = planned sea distance / 14 kn, with the earlier hand estimate kept in
voyage_derivation.previous_hand_estimate. A public deployment may not republish a provider's derived numbers, so hosted mode serves the earlier set:
great-circle sums over illustrative waypoints (an ESTIMATE, labelled so), and the default Suez / Bab el-Mandeb detour recomputed from it as
(Cape days - Suez days), the same rule as before.

Pure function: no network, no files. The input document is not changed.
"""

import copy

SPEED_KNOTS = 14.0
ESTIMATE_NOTE = ("Earlier ESTIMATE: great-circle distance summed over illustrative waypoints, divided by 14 kn (the project's tanker speed, an assumption). "
                 "Not a surveyed or planned distance.")


def estimated_voyages(doc: dict) -> dict:
    out = copy.deepcopy(doc)
    days_by_id: dict[str, float] = {}
    for r in out["routes"]:
        d = r.get("voyage_derivation")
        if not d or not d.get("provider"):
            continue
        prev = d.get("previous_hand_estimate") or {}
        if prev.get("days") is None:
            continue
        nm, days = prev["distance_nm"], prev["days"]
        days_by_id[r["id"]] = days
        r["voyage_derivation"] = {
            "representative_voyage": d.get("representative_voyage"), "distance_nm": nm, "speed_knots": SPEED_KNOTS, "days": days,
            "calculation": f"{nm:g} nm / ({SPEED_KNOTS:g} kn x 24 h) = {days} days", "method_note": ESTIMATE_NOTE, "is_estimate": True,
        }
        if r.get("baseline_voyage_days") is not None:
            r["baseline_voyage_days"] = days
            r["baseline_voyage_note"] = "Typical FULL voyage for cargoes using this route (not the transit time through the chokepoint): " + ESTIMATE_NOTE
            if "baseline_voyage_days" not in r.get("estimate_fields", []):
                r["estimate_fields"] = [*r.get("estimate_fields", []), "baseline_voyage_days"]
    cape = days_by_id.get("cape_good_hope")
    for r in out["routes"]:
        if r["id"] in ("suez", "bab_el_mandeb") and cape is not None and r["id"] in days_by_id:
            r["default_detour_days"] = round(cape - days_by_id[r["id"]], 1)
    meta = out.get("_meta", {})
    if "voyage_distances" in meta:
        meta["voyage_distances"] = {"source": "earlier estimates (great-circle sums over illustrative waypoints)", "speed_knots": SPEED_KNOTS,
                                    "note": "The public deployment serves the earlier estimated distances; the ShipFinder-derived set is not republished (DECISIONS D29)."}
    return out
