// Simulated tankers and the live-AIS vessel set, both exposed through one VesselSource interface so a single InstancedMesh draws either.
//
// EVERYTHING in VesselSim is invented for illustration. Tankers are spread along the (illustrative) route polylines at a constant 14 knots, the
// project's tanker speed. The number of vessels per lane is proportional to lane length only so the lanes look evenly populated: it says nothing
// about real traffic, and no count from here may be shown as a route statistic. Time is compressed so motion is visible (SIM_HOURS_PER_SECOND).
import type { RouteSummary } from "../types";
import { routePoints } from "./routeGeometry";

export const SIM = {
  KNOTS: 14,
  KM_PER_KNOT_HOUR: 1.852,
  /** 1 real second = this many simulated hours. At 14 kn a tanker covers ~25.9 km per simulated hour, which would be invisible at real speed. */
  SIM_HOURS_PER_SECOND: 6,
  TRAIL_KM: 70,
  EARTH_KM: 6371,
  BLEND_SECONDS: 2.5,
} as const;
export const SIM_KM_PER_SECOND = SIM.KNOTS * SIM.KM_PER_KNOT_HOUR * SIM.SIM_HOURS_PER_SECOND;

export interface Scenario { disruptedId: string; altId: string | null }

export interface VesselInfo {
  kind: "simulated" | "ais";
  name: string;
  mmsi: string;
  flag: string;
  speed: string;
  course: string;
  destination: string;
  draught: string;
  status: string;
  lat: number;
  lng: number;
}

/** Buffers the renderer owns; a source fills them every frame. */
export interface FillTarget {
  matrix: Float32Array;       // 16 per vessel (instanceMatrix)
  color: Float32Array;        // 3 per vessel (instanceColor)
  trail: Float32Array;        // 6 per vessel: head xyz, tail xyz
  trailColor: Float32Array;   // 6 per vessel
  pos: Float32Array;          // 3 per VESSEL (not per instance): local position, for picking and the selection ring
  /** instances written by the last fill: only vessels facing the camera are packed into matrix/color/trail, in order */
  count: number;
}

/** Which vessels to draw: those whose unit position has dot(p, cam) >= minDot (cam is the camera direction in the globe's local frame). null = all. */
export interface View { cam: number[]; minDot: number }

export interface VesselSource {
  readonly kind: "simulated" | "ais";
  readonly count: number;
  step(dtSeconds: number, scenario: Scenario | null): void;
  fill(out: FillTarget, radius: number, size: number, view: View | null): void;
  info(i: number): VesselInfo;
}

const DEG = Math.PI / 180;
const NORMAL = [0.93, 0.96, 1.0], REROUTED = [1.0, 0.55, 0.05], HALTED = [1.0, 0.23, 0.23], AIS = [0.35, 0.88, 0.79];

// ----------------------------------------------------------------------------------------------- geometry helpers
/** Unit vector for lat/lng using the same convention as lib/geo.ts. */
function unit(lat: number, lng: number, out: number[]): void {
  const phi = (90 - lat) * DEG, theta = (lng + 180) * DEG;
  out[0] = -Math.sin(phi) * Math.cos(theta); out[1] = Math.cos(phi); out[2] = Math.sin(phi) * Math.sin(theta);
}
function eastNorth(p: number[]): { e: number[]; n: number[] } {
  const phi = Math.acos(Math.max(-1, Math.min(1, p[1])));
  const theta = Math.atan2(p[2], -p[0]);
  return { e: [Math.sin(theta), 0, Math.cos(theta)], n: [Math.cos(phi) * Math.cos(theta), Math.sin(phi), -Math.cos(phi) * Math.sin(theta)] };
}
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function toLatLng(p: number[]): { lat: number; lng: number } {
  return { lat: Math.asin(Math.max(-1, Math.min(1, p[1]))) / DEG, lng: ((Math.atan2(p[2], -p[0]) / DEG) - 180 + 540) % 360 - 180 };
}
function bearing(p: number[], t: number[]): number {
  const { e, n } = eastNorth(p);
  return (Math.atan2(dot(t, e), dot(t, n)) / DEG + 360) % 360;
}

const SCRATCH = [0, 0, 0];

/** Write vessel i. Its position always goes to out.pos[i]; the instance data (matrix, colour, trail) is only written, at the next free slot, when it is in view. */
function writeInstance(out: FillTarget, i: number, p: number[], f: number[], radius: number, size: number, rgb: number[], trailRad: number, offset: number, view: View | null): void {
  // orthonormal basis: up = p, forward = f projected onto the surface, right = up x forward
  const d = dot(f, p);
  let fx = f[0] - d * p[0], fy = f[1] - d * p[1], fz = f[2] - d * p[2];
  const fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
  fx /= fl; fy /= fl; fz /= fl;
  const rx = p[1] * fz - p[2] * fy, ry = p[2] * fx - p[0] * fz, rz = p[0] * fy - p[1] * fx;
  if (offset) {                                   // sideways shift so a lane is a band, not a single line (opposite directions use opposite sides)
    const ox = p[0] + rx * offset, oy = p[1] + ry * offset, oz = p[2] + rz * offset, ol = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
    SCRATCH[0] = ox / ol; SCRATCH[1] = oy / ol; SCRATCH[2] = oz / ol;
    p = SCRATCH;
  }
  out.pos[i * 3] = p[0] * radius; out.pos[i * 3 + 1] = p[1] * radius; out.pos[i * 3 + 2] = p[2] * radius;
  if (view && dot(p, view.cam) < view.minDot) return;                  // far side of the globe: not drawn
  const m = out.matrix, o = out.count * 16;
  m[o] = rx * size; m[o + 1] = ry * size; m[o + 2] = rz * size; m[o + 3] = 0;
  m[o + 4] = p[0] * size; m[o + 5] = p[1] * size; m[o + 6] = p[2] * size; m[o + 7] = 0;
  m[o + 8] = fx * size; m[o + 9] = fy * size; m[o + 10] = fz * size; m[o + 11] = 0;
  const px = p[0] * radius, py = p[1] * radius, pz = p[2] * radius;
  m[o + 12] = px; m[o + 13] = py; m[o + 14] = pz; m[o + 15] = 1;
  const c = out.count * 3;
  out.color[c] = rgb[0]; out.color[c + 1] = rgb[1]; out.color[c + 2] = rgb[2];
  // trail: from the vessel back along its heading, fading to black (additive blending makes black invisible)
  let tx = p[0] - fx * trailRad, ty = p[1] - fy * trailRad, tz = p[2] - fz * trailRad;
  const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
  tx = (tx / tl) * radius; ty = (ty / tl) * radius; tz = (tz / tl) * radius;
  const k = out.count * 6;
  out.trail[k] = px; out.trail[k + 1] = py; out.trail[k + 2] = pz; out.trail[k + 3] = tx; out.trail[k + 4] = ty; out.trail[k + 5] = tz;
  out.trailColor[k] = rgb[0] * 0.55; out.trailColor[k + 1] = rgb[1] * 0.55; out.trailColor[k + 2] = rgb[2] * 0.55;
  out.trailColor[k + 3] = 0; out.trailColor[k + 4] = 0; out.trailColor[k + 5] = 0;
  out.count++;
}

// ----------------------------------------------------------------------------------------------- lanes
export interface SimLane { id: string; name: string; pts: Float64Array; cum: Float64Array; km: number }

/** Sea routes only (pipelines carry no ships; routes marked excluded have no sourced figure but are still drawn, so they get no vessels either). */
export function buildLanes(routes: RouteSummary[]): SimLane[] {
  const lanes: SimLane[] = [];
  for (const r of routes) {
    if (r.type === "pipeline" || r.excluded_from_calculations || r.path.length < 2) continue;
    const v = routePoints(r.path, 1, 1.5);
    const pts = new Float64Array(v.length * 3), cum = new Float64Array(v.length);
    for (let i = 0; i < v.length; i++) {
      pts[i * 3] = v[i].x; pts[i * 3 + 1] = v[i].y; pts[i * 3 + 2] = v[i].z;
      if (i > 0) {
        const c = Math.max(-1, Math.min(1, v[i].dot(v[i - 1])));
        cum[i] = cum[i - 1] + Math.acos(c) * SIM.EARTH_KM;
      }
    }
    lanes.push({ id: r.id, name: r.name, pts, cum, km: cum[cum.length - 1] });
  }
  return lanes;
}

/** Position (unit vector) and forward tangent at distance d km along the lane. */
export function sampleLane(lane: SimLane, d: number, p: number[], t: number[]): void {
  const { cum, pts } = lane;
  let lo = 0, hi = cum.length - 1;
  d = Math.max(0, Math.min(lane.km, d));
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
  const span = cum[hi] - cum[lo] || 1, f = (d - cum[lo]) / span;
  const a = lo * 3, b = hi * 3;
  let x = pts[a] + (pts[b] - pts[a]) * f, y = pts[a + 1] + (pts[b + 1] - pts[a + 1]) * f, z = pts[a + 2] + (pts[b + 2] - pts[a + 2]) * f;
  const l = Math.sqrt(x * x + y * y + z * z) || 1;
  p[0] = x / l; p[1] = y / l; p[2] = z / l;
  t[0] = pts[b] - pts[a]; t[1] = pts[b + 1] - pts[a + 1]; t[2] = pts[b + 2] - pts[a + 2];
  const tl = Math.sqrt(t[0] * t[0] + t[1] * t[1] + t[2] * t[2]) || 1;
  t[0] /= tl; t[1] /= tl; t[2] /= tl;
}

function mulberry32(seed: number): () => number {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Largest-remainder split of `total` over weights, with a floor per lane. */
export function allocate(weights: number[], total: number, floor = 30): number[] {
  const floored = weights.map(() => floor);
  const rest = total - floor * weights.length;
  if (rest <= 0) return floored;
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const exact = weights.map((w) => (w / sum) * rest), base = exact.map(Math.floor);
  let left = rest - base.reduce((a, b) => a + b, 0);
  exact.map((v, i) => ({ i, r: v - Math.floor(v) })).sort((a, b) => b.r - a.r).forEach(({ i }) => { if (left-- > 0) base[i]++; });
  return base.map((b, i) => b + floored[i]);
}

// ----------------------------------------------------------------------------------------------- the simulation
export class VesselSim implements VesselSource {
  readonly kind = "simulated" as const;
  readonly count: number;
  private lanes: SimLane[];
  private home: Int16Array;       // lane the vessel belongs to
  private lane: Int16Array;       // lane it is on now (differs from home when rerouted)
  private dist: Float64Array;     // km along the current lane
  private dir: Int8Array;         // +1 or -1
  private side: Float32Array;    // sideways offset (unit-sphere radians) within the lane band
  private state: Uint8Array;      // 0 normal, 1 rerouted, 2 halted
  private blend: Float32Array;    // 0..1 smoothing after a reroute
  private from: Float32Array;     // unit position when the reroute started
  private key = "";
  private p = [0, 0, 0]; private t = [0, 0, 0];

  constructor(lanes: SimLane[], total = 2000, seed = 7) {
    this.lanes = lanes;
    const per = allocate(lanes.map((l) => l.km), total);
    this.count = lanes.length ? per.reduce((a, b) => a + b, 0) : 0;
    this.home = new Int16Array(this.count); this.lane = new Int16Array(this.count);
    this.dist = new Float64Array(this.count); this.dir = new Int8Array(this.count); this.side = new Float32Array(this.count); this.state = new Uint8Array(this.count);
    this.blend = new Float32Array(this.count).fill(1); this.from = new Float32Array(this.count * 3);
    const rnd = mulberry32(seed);
    let i = 0;
    per.forEach((n, li) => {
      for (let k = 0; k < n; k++, i++) {
        this.home[i] = this.lane[i] = li;
        this.dist[i] = ((k + rnd() * 0.8) / n) * lanes[li].km;           // evenly spread with jitter
        this.dir[i] = k % 2 === 0 ? 1 : -1;
        this.side[i] = this.dir[i] * (0.0008 + rnd() * 0.0042);          // ~5 to 32 km either side of the lane centre
      }
    });
  }

  private reassign(scenario: Scenario | null): void {
    const disrupted = scenario ? this.lanes.findIndex((l) => l.id === scenario.disruptedId) : -1;
    const alt = scenario?.altId ? this.lanes.findIndex((l) => l.id === scenario.altId) : -1;
    for (let i = 0; i < this.count; i++) {
      const onDisrupted = disrupted >= 0 && this.home[i] === disrupted;
      const target = onDisrupted && alt >= 0 ? alt : this.home[i];
      const state = onDisrupted ? (alt >= 0 ? 1 : 2) : 0;
      if (target !== this.lane[i]) {
        const cur = this.lanes[this.lane[i]];
        sampleLane(cur, this.dist[i], this.p, this.t);
        this.from[i * 3] = this.p[0]; this.from[i * 3 + 1] = this.p[1]; this.from[i * 3 + 2] = this.p[2];
        const frac = cur.km ? this.dist[i] / cur.km : 0;
        this.lane[i] = target;
        this.dist[i] = frac * this.lanes[target].km;
        this.blend[i] = 0;
      }
      this.state[i] = state;
    }
  }

  step(dt: number, scenario: Scenario | null): void {
    const key = scenario ? `${scenario.disruptedId}>${scenario.altId ?? "none"}` : "";
    if (key !== this.key) { this.key = key; this.reassign(scenario); }
    const adv = SIM_KM_PER_SECOND * Math.min(dt, 0.1);
    for (let i = 0; i < this.count; i++) {
      if (this.blend[i] < 1) this.blend[i] = Math.min(1, this.blend[i] + dt / SIM.BLEND_SECONDS);
      if (this.state[i] === 2) continue;                                 // halted: a blockade with no alternate lane
      const km = this.lanes[this.lane[i]].km;
      let d = this.dist[i] + this.dir[i] * adv;
      if (d >= km) d -= km; else if (d < 0) d += km;
      this.dist[i] = d;
    }
  }

  fill(out: FillTarget, radius: number, size: number, view: View | null): void {
    const trailRad = SIM.TRAIL_KM / SIM.EARTH_KM, p = this.p, t = this.t;
    out.count = 0;
    for (let i = 0; i < this.count; i++) {
      const lane = this.lanes[this.lane[i]];
      sampleLane(lane, this.dist[i], p, t);
      const b = this.blend[i];
      if (b < 1) {                                                        // glide from the old position to the new lane
        const e = b * b * (3 - 2 * b), fx = this.from[i * 3], fy = this.from[i * 3 + 1], fz = this.from[i * 3 + 2];
        const x = fx + (p[0] - fx) * e, y = fy + (p[1] - fy) * e, z = fz + (p[2] - fz) * e, l = Math.sqrt(x * x + y * y + z * z) || 1;
        p[0] = x / l; p[1] = y / l; p[2] = z / l;
      }
      const s = this.state[i];
      if (this.dir[i] < 0) { t[0] = -t[0]; t[1] = -t[1]; t[2] = -t[2]; }
      writeInstance(out, i, p, t, radius, s === 1 ? size * 1.6 : size, s === 1 ? REROUTED : s === 2 ? HALTED : NORMAL, s === 2 ? 0 : trailRad, this.side[i], view);
    }
  }

  info(i: number): VesselInfo {
    const lane = this.lanes[this.lane[i]], s = this.state[i];
    sampleLane(lane, this.dist[i], this.p, this.t);
    if (this.dir[i] < 0) { this.t[0] = -this.t[0]; this.t[1] = -this.t[1]; this.t[2] = -this.t[2]; }
    const { lat, lng } = toLatLng(this.p);
    const status = s === 1 ? `rerouted onto ${lane.name} (simulated)` : s === 2 ? `held: no alternate lane in this scenario (simulated)` : `underway on ${lane.name} (simulated)`;
    return {
      kind: "simulated", name: `SIM TANKER ${String(i + 1).padStart(4, "0")} (simulated)`, mmsi: "simulated", flag: "simulated",
      speed: s === 2 ? "0.0 kn (simulated, held)" : `${SIM.KNOTS.toFixed(1)} kn (simulated)`,
      course: s === 2 ? "n/a (held)" : `${bearing(this.p, this.t).toFixed(0).padStart(3, "0")}° (from the lane drawing, simulated)`,
      destination: "simulated", draught: "simulated", status, lat, lng,
    };
  }
}

// ----------------------------------------------------------------------------------------------- AIS vessels from the backend
export interface AisVessel {
  mmsi: string; name: string | null; flag: string | null; lat: number; lon: number; speed_kn: number | null; course_deg: number | null;
  heading_deg: number | null; destination: string | null; draught_m: number | null; updated_at: string;
}

export class AisVessels implements VesselSource {
  readonly kind = "ais" as const;
  private list: AisVessel[];
  constructor(vessels: AisVessel[]) { this.list = vessels; }
  get count() { return this.list.length; }
  step(): void { /* positions only change when a new report arrives */ }

  fill(out: FillTarget, radius: number, size: number, view: View | null): void {
    const p = [0, 0, 0];
    out.count = 0;
    for (let i = 0; i < this.list.length; i++) {
      const v = this.list[i];
      unit(v.lat, v.lon, p);
      const { e, n } = eastNorth(p), b = (v.heading_deg ?? v.course_deg ?? 0) * DEG;
      const f = [n[0] * Math.cos(b) + e[0] * Math.sin(b), n[1] * Math.cos(b) + e[1] * Math.sin(b), n[2] * Math.cos(b) + e[2] * Math.sin(b)];
      writeInstance(out, i, p, f, radius, size, AIS, (v.speed_kn ?? 0) > 0.5 ? SIM.TRAIL_KM / SIM.EARTH_KM : 0, 0, view);
    }
  }

  info(i: number): VesselInfo {
    const v = this.list[i], na = "not reported";
    return {
      kind: "ais", name: v.name ?? na, mmsi: v.mmsi, flag: v.flag ? `${v.flag} (from MMSI prefix)` : na,
      speed: v.speed_kn == null ? na : `${v.speed_kn.toFixed(1)} kn`, course: v.course_deg == null ? na : `${v.course_deg.toFixed(0).padStart(3, "0")}°`,
      destination: v.destination ? `${v.destination} (self-reported, unreliable)` : na, draught: v.draught_m == null ? na : `${v.draught_m.toFixed(1)} m`,
      status: `AIS report at ${v.updated_at.replace("T", " ").replace("Z", " UTC")}`, lat: v.lat, lng: v.lon,
    };
  }
}
