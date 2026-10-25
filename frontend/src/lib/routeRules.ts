import type { RouteSummary } from "../types";

/** Same normalisation the backend uses, so "Bab el-Mandeb", "bab-el-mandeb" and "bab_el_mandeb" are one route. */
export const normalizeRouteId = (raw: string): string => raw.trim().toLowerCase().replace(/[ -]/g, "_");

/** Why a route cannot be simulated, or null if it can. These mirror the backend's own checks (backend/services/report.py), which still
 * enforce them; checking here first lets the page explain a rejection without making a request that is certain to fail. */
export function cannotSimulateReason(route: RouteSummary): string | null {
  if (route.excluded_from_calculations) {
    return `${route.name} is excluded from calculations: no sourced throughput or capacity exists for it yet.`;
  }
  if (route.type === "pipeline" || !route.annual_flow_bpd) {
    return `${route.name} is a pipeline with nameplate capacity only; no sourced throughput exists, so a disruption cannot be sized. Simulate a chokepoint instead, such as Hormuz or Suez.`;
  }
  if (route.type === "sea_lane") {
    return `${route.name} is the alternate lane used when Suez / Bab el-Mandeb traffic is rerouted, not a route you would disrupt. Simulate Suez or Bab el-Mandeb with a detour instead.`;
  }
  return null;
}
