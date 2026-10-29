import { CatmullRomCurve3, Vector3 } from "three";
import type { RouteSummary, RouteType } from "../types";
import { TOKENS } from "./constants";
import { fmtMbd } from "./format";
import { latLngToVector3 } from "./geo";

// Colours: lane blue is a NEW token (cool, distinct from --color-ion teal, which the design system
// reserves for EV/lithium). Pipelines reuse --color-crude (oil). Disrupted routes use --color-alarm.
export const ROUTE_COLORS: Record<RouteType | "disrupted", string> = {
  chokepoint: TOKENS.lane,
  sea_lane: TOKENS.lane,
  pipeline: TOKENS.crude,
  disrupted: TOKENS.alarm,
};

export const ROUTE_TYPE_LABEL: Record<RouteType, string> = {
  chokepoint: "Chokepoint lane",
  sea_lane: "Sea lane",
  pipeline: "Pipeline",
};

const DEG = Math.PI / 180;

/** Great-circle interpolation between waypoints, lifted to `radius`, so lines hug the sphere
 * instead of cutting chords through it. Waypoints are illustrative geometry (see routes.json). */
export function routePoints(path: [number, number][], radius: number, maxStepDeg = 1.5): Vector3[] {
  const pts: Vector3[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = latLngToVector3(path[i][0], path[i][1], 1).normalize();
    const b = latLngToVector3(path[i + 1][0], path[i + 1][1], 1).normalize();
    const angle = Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
    const steps = Math.max(1, Math.ceil(angle / (maxStepDeg * DEG)));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const sin = Math.sin(angle) || 1;
      const p = a
        .clone()
        .multiplyScalar(Math.sin((1 - t) * angle) / sin)
        .add(b.clone().multiplyScalar(Math.sin(t * angle) / sin));
      pts.push(p.normalize().multiplyScalar(radius));
    }
  }
  const last = path[path.length - 1];
  pts.push(latLngToVector3(last[0], last[1], radius));
  return pts;
}

export function routeCurve(points: Vector3[]): CatmullRomCurve3 {
  return new CatmullRomCurve3(points, false, "centripetal");
}

/** Line width in pixels from annual flow (sqrt scale, 1.6 to 5) or nameplate capacity for pipelines (thin, 1.2 to 2.4). */
export function routeLineWidth(r: RouteSummary): number {
  if (r.type === "pipeline") {
    const cap = r.capacity_bpd ?? 0;
    return 1.2 + Math.min(1, cap / 5_000_000) * 1.2;
  }
  const flow = r.annual_flow_bpd ?? 0;
  return 1.6 + Math.min(1, Math.sqrt(flow / 23_000_000)) * 3.4;
}

/** Middle waypoint: where the camera flies to and where rings sit. */
export function routeMidpoint(path: [number, number][]): [number, number] {
  return path[Math.floor(path.length / 2)];
}

export function formatMbpd(bpd: number | null | undefined): string {
  return bpd == null ? "n/a" : fmtMbd(bpd);
}
