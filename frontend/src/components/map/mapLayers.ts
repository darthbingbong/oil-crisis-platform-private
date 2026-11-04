import { PathStyleExtension, type PathStyleExtensionProps } from "@deck.gl/extensions";
import { GeoJsonLayer, IconLayer, PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import { TOKENS } from "../../lib/constants";
import { AFFECTED_ZONE_KM, SEA_LABELS, graticule, pulsePhase, ringRadiusKm, splitAtAntimeridian, toLngLat, type LngLat } from "../../lib/mapGeometry";
import { routeLineWidth, routeMidpoint } from "../../lib/routeGeometry";
import type { LayerId } from "../../lib/viewState";
import type { Location, RouteSummary, WatchVessel } from "../../types";

export type RGBA = [number, number, number, number];

export function rgba(hex: string, alpha = 255): RGBA {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

// Same colours as the globe (lib/constants TOKENS): lane blue, pipeline amber, disrupted crimson. Real tankers use the globe's AIS teal; simulated ones its white-blue.
const C = {
  land: rgba("#14171c"), landLine: rgba("#2c323b"), grid: [255, 255, 255, 14] as RGBA, label: rgba(TOKENS.ash, 170), bone: rgba(TOKENS.bone),
  lane: rgba(TOKENS.lane), pipeline: rgba(TOKENS.crude), alarm: rgba(TOKENS.alarm), crude: rgba(TOKENS.crude), ion: rgba(TOKENS.ion),
  real: [89, 224, 201, 255] as RGBA, simNormal: [237, 245, 255, 235] as RGBA, simRerouted: [255, 140, 13, 255] as RGBA, simHalted: [255, 59, 59, 255] as RGBA,
};

export interface RoutePiece { id: string; name: string; type: RouteSummary["type"]; path: LngLat[]; width: number; dashed: boolean }

/** One piece per antimeridian-free part of each route. Computed once per route list. */
export function routePieces(routes: RouteSummary[]): RoutePiece[] {
  return routes.flatMap((r) => splitAtAntimeridian(toLngLat(r.path)).map((path) => ({ id: r.id, name: r.name, type: r.type, path, width: routeLineWidth(r), dashed: r.type !== "pipeline" })));
}

export interface SimVessels {
  count: number;
  /** interleaved lng, lat; bearing as a deck angle (counter-clockwise degrees); RGBA bytes */
  position: Float32Array;
  angle: Float32Array;
  color: Uint8ClampedArray;
  size: Float32Array;
  version: number;
}

export function makeSimVessels(n: number): SimVessels {
  return { count: n, position: new Float32Array(n * 2), angle: new Float32Array(n), color: new Uint8ClampedArray(n * 4), size: new Float32Array(n), version: 0 };
}

export function packSimVessels(out: SimVessels, lng: Float32Array, lat: Float32Array, bearing: Float32Array, state: Uint8Array): void {
  for (let i = 0; i < out.count; i++) {
    out.position[i * 2] = lng[i]; out.position[i * 2 + 1] = lat[i];
    out.angle[i] = -bearing[i];
    const c = state[i] === 1 ? C.simRerouted : state[i] === 2 ? C.simHalted : C.simNormal;
    out.color[i * 4] = c[0]; out.color[i * 4 + 1] = c[1]; out.color[i * 4 + 2] = c[2]; out.color[i * 4 + 3] = c[3];
    out.size[i] = state[i] === 1 ? 15 : 11;
  }
  out.version++;
}

let arrowAtlas: string | null = null;
/** A white arrow pointing north, drawn once; deck.gl tints it per vessel (mask) and turns it by the bearing. */
function arrowIcon(): string {
  if (!arrowAtlas) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    if (g) {
      g.fillStyle = "#fff";
      g.beginPath(); g.moveTo(32, 4); g.lineTo(56, 58); g.lineTo(32, 45); g.lineTo(8, 58); g.closePath(); g.fill();
    }
    arrowAtlas = c.toDataURL();
  }
  return arrowAtlas;
}
const ICON_MAPPING = { arrow: { x: 0, y: 0, width: 64, height: 64, mask: true } };

// deck.gl rebuilds a layer (and, for text, its glyph atlas) whenever its `data` is a different object. This function runs on every frame while vessels move, so
// anything that does not change must be the SAME object each time: a fresh array per frame made the map crawl and dropped clicks (a press is only a click if nothing
// is rebuilt between pressing and releasing).
const GRATICULE = graticule(30);
const seaLabelCache = new Map<string, typeof SEA_LABELS>();
function seaLabelsAt(zoom: number): typeof SEA_LABELS {
  const shown = SEA_LABELS.filter((s) => zoom >= s.minZoom);
  const key = shown.map((s) => s.name).join("|");
  let hit = seaLabelCache.get(key);
  if (!hit) { hit = shown; seaLabelCache.set(key, hit); }
  return hit;
}
const placeSplit = new WeakMap<Location[], { chokepoints: Location[]; places: Location[] }>();
function splitPlaces(locations: Location[]) {
  let hit = placeSplit.get(locations);
  if (!hit) { hit = { chokepoints: locations.filter((l) => l.type === "chokepoint"), places: locations.filter((l) => l.type !== "chokepoint") }; placeSplit.set(locations, hit); }
  return hit;
}
/** One label per group of real tankers (Huelva, Malacca): "SNAPSHOT", where, and when the group was seen. The time is a range when the group's records were fetched at different
 *  moments (the Malacca seed was confirmed with Vessel Position at 16:13, the rest came from the 16:28 Nearby sample), never a single time that hides that. */
const groupLabels = new WeakMap<WatchVessel[], { lng: number; lat: number; text: string }[]>();
export function watchGroupLabels(watch: WatchVessel[]) {
  let hit = groupLabels.get(watch);
  if (hit) return hit;
  const by = new Map<string, WatchVessel[]>();
  for (const v of watch) by.set(v.area, [...(by.get(v.area) ?? []), v]);
  hit = [...by.entries()].map(([area, vs]) => {
    const times = vs.map((v) => v.record_fetched_utc).filter((x): x is string => !!x).sort();
    const hm = (s: string) => s.slice(11, 16);
    const seen = times.length ? (hm(times[0]) === hm(times[times.length - 1]) ? `${hm(times[0])} UTC` : `${hm(times[0])} to ${hm(times[times.length - 1])} UTC`) : "time unknown";
    return { lng: vs.reduce((s, v) => s + v.lng, 0) / vs.length, lat: Math.max(...vs.map((v) => v.lat)), text: `SNAPSHOT · ${area.replace(/ \(.*\)$/, "")} · seen ${seen} · ${vs.length} tankers` };
  });
  groupLabels.set(watch, hit);
  return hit;
}
/** The simulated fleet as deck.gl binary attributes: a new copy only when the simulation has stepped (version changed), never twice for the same step. */
const simData = new WeakMap<SimVessels, { version: number; data: object }>();
function simBinary(s: SimVessels): object {
  const hit = simData.get(s);
  if (hit && hit.version === s.version) return hit.data;
  const data = { length: s.count, attributes: { getPosition: { value: s.position.slice(), size: 2 }, getAngle: { value: s.angle.slice(), size: 1 }, getColor: { value: s.color.slice(), size: 4, normalized: true }, getSize: { value: s.size.slice(), size: 1 } } };
  simData.set(s, { version: s.version, data });
  return data;
}

export interface MapLayerInput {
  pieces: RoutePiece[];
  routes: RouteSummary[];
  locations: Location[];
  on: Set<LayerId>;
  hoveredRouteId: string | null;
  selectedRouteId: string | null;
  disrupted: { routeId: string; altRouteId: string | null } | null;
  conflictIntensity: number;
  /** seconds, drives the pulsing ring */
  time: number;
  zoom: number;
  sim: SimVessels | null;
  selectedSim: { lng: number; lat: number } | null;
  watch: WatchVessel[];
  selectedWatchMmsi: number | null;
}

/** The part of the map that never moves between camera changes: graticule, country outlines, sea names. Drawn on its OWN canvas under the live layers, so a moving
 *  vessel does not make the browser redraw ~100,000 coastline vertices 20 times a second (on software rendering that alone was 1.7 frames a second). */
export interface CountryLevel { index: number; data: object }
export function buildBaseLayers(levels: CountryLevel[], active: number, zoom: number): Layer[] {
  const layers: Layer[] = [];
  layers.push(new PathLayer<LngLat[]>({ id: "graticule", data: GRATICULE, getPath: (d) => d, getColor: C.grid, getWidth: 1, widthUnits: "pixels", pickable: false }));
  // One layer per level of detail that has been needed so far. Changing a layer's data makes deck.gl re-tessellate every polygon on the main thread (seconds on software
  // rendering), so each level is built ONCE and only its `visible` flag changes afterwards.
  for (const lv of levels) {
    layers.push(new GeoJsonLayer({ id: `countries-${lv.index}`, visible: lv.index === active, data: lv.data as never, filled: true, stroked: true, getFillColor: C.land, getLineColor: C.landLine, lineWidthMinPixels: 0.6, lineJointRounded: false, lineCapRounded: false, pickable: false }));
  }
  layers.push(new TextLayer<{ name: string; lngLat: LngLat; minZoom: number }>({
    id: "sea-labels", data: seaLabelsAt(zoom), getText: (d) => d.name, getPosition: (d) => d.lngLat, getSize: 11, getColor: C.label,
    fontFamily: "Inter, system-ui, sans-serif", fontWeight: 500, characterSet: "auto", getTextAnchor: "middle", getAlignmentBaseline: "center", pickable: false,
  }));

  return layers;
}

export function buildLayers(i: MapLayerInput): Layer[] {
  const layers: Layer[] = [];
  const routeById = new Map(i.routes.map((r) => [r.id, r]));

  if (i.on.has("routes")) {
    const altId = i.disrupted?.altRouteId ?? null, disId = i.disrupted?.routeId ?? null;
    const colorOf = (d: RoutePiece): RGBA => (d.id === disId ? C.alarm : d.type === "pipeline" ? C.pipeline : C.lane);
    layers.push(new PathLayer<RoutePiece, PathStyleExtensionProps<RoutePiece>>({
      id: "routes", data: i.pieces, getPath: (d) => d.path, pickable: true, widthUnits: "pixels", capRounded: true, jointRounded: true,
      getColor: (d) => { const c = colorOf(d); return [c[0], c[1], c[2], d.id === i.hoveredRouteId || d.id === i.selectedRouteId || d.id === disId || d.id === altId ? 255 : 200]; },
      getWidth: (d) => d.width * (d.id === i.hoveredRouteId || d.id === i.selectedRouteId ? 1.6 : 1) * (d.id === disId || d.id === altId ? 1.3 : 1),
      getDashArray: (d) => (d.dashed || d.id === disId ? [5, 3] : [0, 0]), dashJustified: true, extensions: [new PathStyleExtension({ dash: true })],
      updateTriggers: { getColor: [i.hoveredRouteId, i.selectedRouteId, disId, altId], getWidth: [i.hoveredRouteId, i.selectedRouteId, disId, altId], getDashArray: [disId] },
    }));
  }

  if (i.on.has("scenario") && i.disrupted) {
    const route = routeById.get(i.disrupted.routeId);
    if (route) {
      const [lat, lng] = routeMidpoint(route.path);
      const ph = pulsePhase(i.time);
      layers.push(new ScatterplotLayer<{ p: LngLat }>({
        id: "scenario-zone", data: [{ p: [lng, lat] }], getPosition: (d) => d.p, radiusUnits: "meters", getRadius: AFFECTED_ZONE_KM * 1000, filled: true, stroked: true,
        getFillColor: [255, 59, 59, 22], getLineColor: [255, 59, 59, 120], lineWidthMinPixels: 1, lineWidthUnits: "pixels", pickable: false,
      }));
      layers.push(new ScatterplotLayer<{ p: LngLat }>({
        id: "pulse", data: [{ p: [lng, lat] }], getPosition: (d) => d.p, radiusUnits: "meters", getRadius: ringRadiusKm(i.conflictIntensity, ph) * 1000, filled: false, stroked: true,
        getLineColor: [255, 59, 59, Math.round((1 - ph) * 220)], lineWidthMinPixels: 2, lineWidthUnits: "pixels", pickable: false, updateTriggers: { getRadius: [i.time, i.conflictIntensity], getLineColor: [i.time] },
      }));
    }
  }

  const { chokepoints, places } = splitPlaces(i.locations);
  if (i.on.has("chokepoints")) {
    layers.push(new ScatterplotLayer<Location>({
      id: "chokepoint-halo", data: chokepoints, getPosition: (d) => [d.lng, d.lat], radiusUnits: "pixels", getRadius: (d) => 11 + d.severity * 9, filled: true, getFillColor: [232, 135, 30, 38], pickable: false,
    }));
    layers.push(new ScatterplotLayer<Location>({
      id: "chokepoints", data: chokepoints, getPosition: (d) => [d.lng, d.lat], radiusUnits: "pixels", getRadius: 6, filled: true, stroked: true, getFillColor: C.crude, getLineColor: C.bone, lineWidthMinPixels: 1.5,
      lineWidthUnits: "pixels", pickable: true,
    }));
    layers.push(new TextLayer<Location>({
      id: "chokepoint-labels", data: chokepoints, getText: (d) => d.name, getPosition: (d) => [d.lng, d.lat], getSize: 12, getColor: C.bone, getPixelOffset: [0, -18], fontFamily: "Inter, system-ui, sans-serif",
      fontWeight: 600, getTextAnchor: "middle", getAlignmentBaseline: "bottom", characterSet: "auto", outlineWidth: 3, outlineColor: [3, 3, 3, 230], fontSettings: { sdf: true }, pickable: false,
    }));
  }

  if (i.on.has("places")) {
    layers.push(new ScatterplotLayer<Location>({
      id: "places", data: places, getPosition: (d) => [d.lng, d.lat], radiusUnits: "pixels", getRadius: 3.5, filled: true,
      getFillColor: (d) => (d.accent === "ion" ? C.ion : C.crude), pickable: true,
    }));
  }

  if (i.on.has("simulated") && i.sim && i.sim.count > 0) {
    const s = i.sim;
    layers.push(new IconLayer({
      id: "vessels-sim", data: simBinary(s) as never,
      iconAtlas: arrowIcon(), iconMapping: ICON_MAPPING, getIcon: () => "arrow", sizeUnits: "pixels", sizeMinPixels: 5, pickable: true, billboard: false, alphaCutoff: 0.05,
    }));
    if (i.selectedSim) {
      layers.push(new ScatterplotLayer({
        id: "vessel-sim-ring", data: [i.selectedSim], getPosition: (d: { lng: number; lat: number }) => [d.lng, d.lat], radiusUnits: "pixels", getRadius: 13, filled: false, stroked: true, getLineColor: C.bone, lineWidthMinPixels: 2,
        lineWidthUnits: "pixels", pickable: false,
      }));
    }
  }

  if (i.on.has("watchlist") && i.watch.length) {
    layers.push(new ScatterplotLayer<WatchVessel>({
      id: "vessels-watch-halo", data: i.watch, getPosition: (d) => [d.lng, d.lat], radiusUnits: "pixels", getRadius: (d) => (d.mmsi === i.selectedWatchMmsi ? 17 : 12), filled: true, stroked: true,
      getFillColor: [89, 224, 201, 28], getLineColor: [89, 224, 201, 190], lineWidthMinPixels: 1.5, lineWidthUnits: "pixels", pickable: false, updateTriggers: { getRadius: [i.selectedWatchMmsi] },
    }));
    layers.push(new IconLayer<WatchVessel>({
      id: "vessels-watch", data: i.watch, getPosition: (d) => [d.lng, d.lat], getAngle: (d) => -(d.heading_deg ?? d.cog_deg ?? 0), getColor: C.real, iconAtlas: arrowIcon(), iconMapping: ICON_MAPPING,
      getIcon: () => "arrow", getSize: 18, sizeUnits: "pixels", pickable: true, alphaCutoff: 0.05,
    }));
    layers.push(new TextLayer<{ lng: number; lat: number; text: string }>({
      id: "watch-group-labels", data: watchGroupLabels(i.watch), getText: (d) => d.text, getPosition: (d) => [d.lng, d.lat], getSize: 11, getColor: [89, 224, 201, 255], getPixelOffset: [0, -26],
      fontFamily: "Inter, system-ui, sans-serif", fontWeight: 600, getTextAnchor: "middle", getAlignmentBaseline: "bottom", characterSet: "auto", outlineWidth: 3, outlineColor: [3, 3, 3, 230],
      fontSettings: { sdf: true }, pickable: false,
    }));
  }
  return layers;
}
