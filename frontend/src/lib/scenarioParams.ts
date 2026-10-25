import type { ReportRequest } from "./api";

/** The whole scenario lives in the URL (/results?route=suez&type=detour&detour=20&...), so a refresh or a shared link restores it. */
export interface ScenarioParams {
  route: string;
  type: "blockade" | "detour";
  share: number;            // % of the route blocked (blockade)
  detour: number | null;    // extra voyage days (detour); null = the route's derived default
  dur: number;              // disruption duration, days
  conf: number;             // conflict intensity 0-10
  dem: number;              // demand change %
  ev: number;               // % of lost fuel demand replaced by EVs
  li: number;               // % of world lithium production available
  fleet: boolean;           // detour: fixed tanker fleet (worst case)
  horizon: number;          // years for the headline EV / lithium numbers
  by: number | null;        // baseline-year override (e.g. 2024 for Suez)
}

export const SCENARIO_DEFAULTS = {
  type: "blockade", share: 100, detour: null, dur: 30, conf: 5, dem: 0, ev: 100, li: 10, fleet: true, horizon: 5, by: null,
} as const;

export type ParseResult = { ok: true; value: ScenarioParams } | { ok: false; errors: string[] };

interface NumSpec { key: "share" | "detour" | "dur" | "conf" | "dem" | "ev" | "li" | "horizon" | "by"; label: string; min: number; max: number; integer?: boolean; exclusiveMin?: boolean }

// Ranges mirror the backend's ReportRequest validation, so a bad value is explained here, in words, before any request is made.
const NUMERIC: NumSpec[] = [
  { key: "share", label: "share of the route blocked (share)", min: 0, max: 100 },
  { key: "detour", label: "detour days (detour)", min: 0, max: 120 },
  { key: "dur", label: "disruption duration in days (dur)", min: 0, max: 730, exclusiveMin: true },
  { key: "conf", label: "conflict intensity (conf)", min: 0, max: 10 },
  { key: "dem", label: "demand change % (dem)", min: -50, max: 50 },
  { key: "ev", label: "EV substitution % (ev)", min: 0, max: 100 },
  { key: "li", label: "lithium availability % (li)", min: 0, max: 100 },
  { key: "horizon", label: "horizon in years (horizon)", min: 1, max: 10, integer: true },
  { key: "by", label: "baseline year (by)", min: 1990, max: 2030, integer: true },
];

export function parseScenario(search: URLSearchParams): ParseResult {
  const errors: string[] = [];
  const route = (search.get("route") ?? "").trim();
  if (!route) errors.push("No route was given. Pick a route on the map and press \"Run full simulation\".");

  const typeRaw = (search.get("type") ?? SCENARIO_DEFAULTS.type).toLowerCase();
  if (typeRaw !== "blockade" && typeRaw !== "detour") errors.push(`The disruption type must be "blockade" or "detour" (got "${search.get("type")}").`);

  const out: Record<string, number | null> = { share: SCENARIO_DEFAULTS.share, detour: null, dur: SCENARIO_DEFAULTS.dur, conf: SCENARIO_DEFAULTS.conf,
    dem: SCENARIO_DEFAULTS.dem, ev: SCENARIO_DEFAULTS.ev, li: SCENARIO_DEFAULTS.li, horizon: SCENARIO_DEFAULTS.horizon, by: null };
  for (const spec of NUMERIC) {
    const raw = search.get(spec.key);
    if (raw === null || raw === "") continue;                                  // absent = use the default
    const n = Number(raw);
    const lowOk = spec.exclusiveMin ? n > spec.min : n >= spec.min;
    if (!Number.isFinite(n) || !lowOk || n > spec.max || (spec.integer && !Number.isInteger(n))) {
      errors.push(`The ${spec.label} must be ${spec.integer ? "a whole " : "a "}number ${spec.exclusiveMin ? "above" : "from"} ${spec.min} ${spec.exclusiveMin ? "up to" : "to"} ${spec.max} (got "${raw}").`);
    } else out[spec.key] = n;
  }

  const fleetRaw = (search.get("fleet") ?? "1").toLowerCase();
  if (!["1", "0", "true", "false"].includes(fleetRaw)) errors.push(`"fleet" must be 1 or 0 (got "${search.get("fleet")}").`);

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      route, type: typeRaw as "blockade" | "detour",
      share: out.share as number, detour: out.detour, dur: out.dur as number, conf: out.conf as number, dem: out.dem as number,
      ev: out.ev as number, li: out.li as number, fleet: fleetRaw === "1" || fleetRaw === "true", horizon: out.horizon as number, by: out.by,
    },
  };
}

export function encodeScenario(p: ScenarioParams): string {
  const q = new URLSearchParams();
  q.set("route", p.route);
  q.set("type", p.type);
  if (p.type === "blockade") q.set("share", String(p.share));
  if (p.type === "detour" && p.detour !== null) q.set("detour", String(p.detour));
  q.set("dur", String(p.dur));
  q.set("conf", String(p.conf));
  q.set("dem", String(p.dem));
  q.set("ev", String(p.ev));
  q.set("li", String(p.li));
  if (!p.fleet) q.set("fleet", "0");
  q.set("horizon", String(p.horizon));
  if (p.by !== null) q.set("by", String(p.by));
  return q.toString();
}

export function toReportRequest(p: ScenarioParams): ReportRequest {
  return {
    route_id: p.route,
    disruption_type: p.type,
    blocked_share_pct: p.share,
    detour_days: p.type === "detour" ? p.detour : null,
    duration_days: p.dur,
    conflict_intensity: p.conf,
    demand_change_pct: p.dem,
    ev_substitution_rate_pct: p.ev,
    lithium_availability_pct: p.li,
    fleet_constrained: p.fleet,
    horizon_years: p.horizon,
    baseline_year: p.by,
  };
}
