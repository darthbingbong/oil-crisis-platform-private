// Shared view state for the GLOBE | MAP switch. The single source of truth is the URL (so a view can be shared and survives a reload):
//   ?view=map|globe&lat=&lon=&zoom=&layers=a,b,c&selected=<id>
// Every parameter is validated; a bad value falls back to its default and is listed in `problems` (never thrown, never shown as an error).
// Pure functions only, so they can be tested with plain node (e2e/viewstate_unit.mjs).

export type ViewMode = "globe" | "map";

export const LAYER_IDS = ["routes", "chokepoints", "places", "watchlist", "simulated", "scenario"] as const;
export type LayerId = (typeof LAYER_IDS)[number];

export interface MapCamera { lat: number; lon: number; zoom: number }

// Chosen so all six routes, the Cape lane and the Huelva tankers are in view and clear of the layers panel on a laptop screen.
export const DEFAULT_CAMERA: MapCamera = { lat: 22, lon: 22, zoom: 2 };
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 9;
export const LAT_LIMIT = 80;          // Web Mercator is unusable towards the poles

/** Routes, chokepoints and tankers are on by default. Tankers = the saved real watchlist when there is one, otherwise the simulated traffic (never both by default). */
export function defaultLayers(hasSnapshot: boolean): LayerId[] {
  return hasSnapshot ? ["routes", "chokepoints", "watchlist", "scenario"] : ["routes", "chokepoints", "simulated", "scenario"];
}

export interface ParsedView {
  view: ViewMode;
  camera: MapCamera;
  cameraFromUrl: boolean;
  /** null = not given or nothing valid in it: use the defaults */
  layers: LayerId[] | null;
  selected: string | null;
  /** the selected real vessel (a 9-digit MMSI), shared by both views; null when not given or not valid */
  vessel: number | null;
  problems: string[];
}

const SELECTED_RE = /^[A-Za-z0-9_.:-]{1,80}$/;

function num(raw: string | null, lo: number, hi: number): number | null {
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : NaN;       // NaN = present but invalid
}

export function parseViewParams(p: URLSearchParams): ParsedView {
  const problems: string[] = [];
  const rawView = p.get("view");
  let view: ViewMode = "globe";
  if (rawView === "map" || rawView === "globe") view = rawView;
  else if (rawView !== null) problems.push(`view=${rawView.slice(0, 20)}`);

  const lat = num(p.get("lat"), -LAT_LIMIT, LAT_LIMIT), lon = num(p.get("lon"), -180, 180), zoom = num(p.get("zoom"), ZOOM_MIN, ZOOM_MAX);
  for (const [k, v] of [["lat", lat], ["lon", lon], ["zoom", zoom]] as const) if (typeof v === "number" && Number.isNaN(v)) problems.push(`${k}=${(p.get(k) ?? "").slice(0, 20)}`);
  const ok = (v: number | null): v is number => typeof v === "number" && !Number.isNaN(v);
  const cameraFromUrl = ok(lat) && ok(lon) && ok(zoom);                 // all three or none: a half-given camera is ignored
  const camera = cameraFromUrl ? { lat, lon, zoom } : DEFAULT_CAMERA;
  if (!cameraFromUrl && [lat, lon, zoom].some(ok)) problems.push("camera needs lat, lon and zoom together");

  let layers: LayerId[] | null = null;
  const rawLayers = p.get("layers");
  if (rawLayers !== null) {
    const known = new Set<string>(LAYER_IDS);
    const wanted = rawLayers.split(",").map((s) => s.trim()).filter(Boolean);
    const valid = [...new Set(wanted.filter((s) => known.has(s)))] as LayerId[];
    if (valid.length !== wanted.length) problems.push(`layers=${rawLayers.slice(0, 40)}`);
    layers = valid.length ? valid : null;
  }

  const rawSel = p.get("selected");
  let selected: string | null = null;
  if (rawSel !== null) {
    if (SELECTED_RE.test(rawSel)) selected = rawSel;
    else problems.push("selected");
  }
  const rawVessel = p.get("vessel");
  let vessel: number | null = null;
  if (rawVessel !== null) {
    if (/^\d{9}$/.test(rawVessel)) vessel = Number(rawVessel);
    else problems.push("vessel");
  }
  return { view, camera, cameraFromUrl, layers, selected, vessel, problems };
}

export interface ViewWrite { view: ViewMode; camera?: MapCamera | null; layers?: LayerId[] | null; selected?: string | null; vessel?: number | null }

/** New query string with the view parameters set (others, such as the scenario ones, are kept). Camera values are rounded so the address stays short. */
export function writeViewParams(current: URLSearchParams, w: ViewWrite): URLSearchParams {
  const next = new URLSearchParams(current);
  next.set("view", w.view);
  if (w.view === "map" && w.camera) {
    next.set("lat", String(Math.round(w.camera.lat * 1000) / 1000));
    next.set("lon", String(Math.round(w.camera.lon * 1000) / 1000));
    next.set("zoom", String(Math.round(w.camera.zoom * 100) / 100));
  } else if (w.view === "globe") {
    for (const k of ["lat", "lon", "zoom", "layers"]) next.delete(k);
  }
  if (w.view === "map" && w.layers !== undefined) {              // null = the defaults: no parameter, so a bad value in the address is removed rather than kept
    if (w.layers) next.set("layers", w.layers.join(","));
    else next.delete("layers");
  }
  if (w.selected) next.set("selected", w.selected);
  else next.delete("selected");
  if (w.vessel) next.set("vessel", String(w.vessel));
  else next.delete("vessel");
  return next;
}
