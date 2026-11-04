import { FlyToInterpolator, MapView as DeckMapView, type MapViewState, type PickingInfo } from "@deck.gl/core";
import DeckGL, { type DeckGLRef } from "@deck.gl/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import countriesUrl from "../../assets/ne_50m_countries.json?url";
import type { WatchlistState } from "../../hooks/useWatchlist";
import { fmtUtc } from "../../lib/format";
import { ROUTE_TYPE_LABEL, formatMbpd, routeMidpoint } from "../../lib/routeGeometry";
import { useReducedMotion } from "../../lib/useReducedMotion";
import { VesselSim, buildLanes, makeGeoTarget, type Scenario, type VesselInfo } from "../../lib/vesselSim";
import { DEFAULT_CAMERA, LAYER_IDS, ZOOM_MAX, ZOOM_MIN, defaultLayers, type LayerId, type MapCamera } from "../../lib/viewState";
import type { ConflictEvent, CurrentConditions, Location, RouteScenarioPrefill, RouteSummary, WatchVessel } from "../../types";
import LocationDetail from "../globe/LocationDetail";
import RoutePanel from "../RoutePanel";
import { VesselPanel } from "../VesselUi";
import LayersPanel from "./LayersPanel";
import WatchVesselPanel from "./WatchVesselPanel";
import { buildBaseLayers, buildLayers, type CountryLevel, makeSimVessels, packSimVessels, routePieces, watchGroupLabels } from "./mapLayers";
import { SEA_LABELS } from "../../lib/mapGeometry";
import { DETAIL_LEVELS, detailIndex, simplifyCountries } from "../../lib/mapSimplify";

interface Props {
  locations: Location[];
  conflicts: ConflictEvent[];
  routes: RouteSummary[];
  currentConditions: CurrentConditions | null;
  disruptedRouteId: string | null;
  altRouteId: string | null;
  conflictIntensity: number;
  onSimulateRoute: (prefill: Omit<RouteScenarioPrefill, "nonce">) => void;
  /** shared with the globe through the URL */
  selectedId: string | null;
  onSelectedChange: (id: string | null) => void;
  /** null = the defaults */
  layers: LayerId[] | null;
  onLayersChange: (ids: LayerId[]) => void;
  camera: MapCamera;
  /** true when the address carried its own lat, lon and zoom: a shared link keeps that view rather than flying to the selection on load */
  cameraFromUrl: boolean;
  onCameraChange: (c: MapCamera) => void;
  watchlist: WatchlistState;
}

type Hover = { kind: "route" | "location" | "sim" | "watch"; x: number; y: number; id?: string; index?: number; mmsi?: number } | null;

const TICK_MS = 50;
// Constants, not created in render: the map re-renders 20 times a second while vessels move, and deck.gl resets its input handling whenever it is handed new view
// or controller objects, which would swallow a click between the press and the release.
const MAP_VIEW = new DeckMapView({ repeat: true });
const CONTROLLER = { dragRotate: false, touchRotate: false, keyboard: true, doubleClickZoom: true, inertia: 120 };
const cursor = ({ isDragging, isHovering }: { isDragging: boolean; isHovering: boolean }) => (isDragging ? "grabbing" : isHovering ? "pointer" : "grab");
const DECK_STYLE = { position: "absolute", inset: "0" } as const;
const BASE_STYLE = { position: "absolute", inset: "0", pointerEvents: "none" } as const;
const wrapLng = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180;
const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

/** DEV-only: a bigger simulated fleet for the performance test (?sim=5000). Production always uses 2,000. */
function simCount(): number {
  if (!import.meta.env.DEV) return 2000;
  const n = Number(new URLSearchParams(window.location.search).get("sim"));
  return Number.isFinite(n) && n >= 100 && n <= 20000 ? Math.round(n) : 2000;
}

const Panels = memo(function Panels(p: {
  route: RouteSummary | null; location: Location | null; conflicts: ConflictEvent[]; currentConditions: CurrentConditions | null;
  onClose: () => void; onSimulate: (x: Omit<RouteScenarioPrefill, "nonce">) => void;
}) {
  return (
    <>
      {p.location && <LocationDetail location={p.location} conflicts={p.conflicts} visible onBack={p.onClose} currentConditions={p.currentConditions} />}
      {p.route && <RoutePanel route={p.route} visible onClose={p.onClose} onSimulate={(x) => { p.onSimulate(x); p.onClose(); }} />}
    </>
  );
});

export default function MapView(props: Props) {
  const { locations, routes, selectedId, onSelectedChange, onCameraChange, watchlist } = props;
  const reducedMotion = useReducedMotion();
  const deckRef = useRef<DeckGLRef>(null);
  const [countries, setCountries] = useState<object | null>(null);
  const [viewState, setViewState] = useState<MapViewState>({ longitude: props.camera.lon, latitude: props.camera.lat, zoom: props.camera.zoom, pitch: 0, bearing: 0 });
  const [hover, setHover] = useState<Hover>(null);
  const [selectedSim, setSelectedSim] = useState<number | null>(null);
  const [selectedWatch, setSelectedWatch] = useState<number | null>(null);
  const [frame, setFrame] = useState(0);
  const timeRef = useRef(0);

  // ---- country outlines (bundled Natural Earth, public domain; fetched once, only when the map is opened)
  useEffect(() => {
    let cancelled = false;
    fetch(countriesUrl).then((r) => r.json()).then((d) => !cancelled && setCountries(d)).catch(() => undefined);   // no outlines = the lanes still draw on a plain dark sea
    return () => { cancelled = true; };
  }, []);

  // ---- layers on/off
  const wl = watchlist.data;
  const haveSnapshot = !!wl && wl.status === "SNAPSHOT" && wl.vessels.length > 0;
  // The URL is the shared store, but a checkbox must answer at once: the choice is held locally too and follows the URL when that changes (back button, shared link).
  const [localLayers, setLocalLayers] = useState<LayerId[] | null>(props.layers);
  const urlLayersKey = props.layers?.join(",") ?? "";
  useEffect(() => { setLocalLayers(props.layers); }, [urlLayersKey]);       // eslint-disable-line react-hooks/exhaustive-deps
  const on = useMemo(() => new Set<LayerId>((localLayers ?? defaultLayers(haveSnapshot)).filter((l) => LAYER_IDS.includes(l))), [localLayers, haveSnapshot]);
  const toggle = useCallback((id: LayerId) => {
    const next = new Set(on);
    if (next.has(id)) next.delete(id); else next.add(id);
    const ids = LAYER_IDS.filter((l) => next.has(l));
    setLocalLayers(ids);
    props.onLayersChange(ids);
  }, [on, props]);

  // ---- simulated traffic: the same simulation as the globe, written out as longitude/latitude
  const sim = useMemo(() => {
    const lanes = buildLanes(routes);
    return lanes.length ? new VesselSim(lanes, simCount()) : null;
  }, [routes]);
  const geo = useMemo(() => makeGeoTarget(sim?.count ?? 0), [sim]);
  const simPack = useMemo(() => makeSimVessels(sim?.count ?? 0), [sim]);
  const scenario = useMemo<Scenario | null>(() => (props.disruptedRouteId ? { disruptedId: props.disruptedRouteId, altId: props.altRouteId } : null), [props.disruptedRouteId, props.altRouteId]);
  const disrupted = useMemo(() => (props.disruptedRouteId ? { routeId: props.disruptedRouteId, altRouteId: props.altRouteId } : null), [props.disruptedRouteId, props.altRouteId]);
  const needsTick = !reducedMotion && ((on.has("simulated") && !!sim) || (on.has("scenario") && !!disrupted));

  const refill = useCallback((dt: number) => {
    if (!sim) return;
    sim.step(dt, scenario);
    sim.fillGeo(geo);
    packSimVessels(simPack, geo.lng, geo.lat, geo.bearing, geo.state);
  }, [sim, scenario, geo, simPack]);

  useEffect(() => {
    refill(reducedMotion ? 0 : 0.0001);                 // one frame so a static map (reduced motion, or paused) still shows the vessels
    setFrame((f) => f + 1);
    if (!needsTick) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now(), dt = (now - last) / 1000;
      last = now;
      timeRef.current += dt;
      refill(dt);
      setFrame((f) => f + 1);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [needsTick, refill, reducedMotion]);

  // ---- fly to the selection (route midpoint or place), whichever view made it
  const flyTo = useCallback((lat: number, lng: number, zoom: number) => {
    setViewState((vs) => ({ ...vs, latitude: lat, longitude: lng, zoom: clampZoom(zoom), transitionDuration: reducedMotion ? 0 : 900, transitionInterpolator: new FlyToInterpolator({ speed: 1.6 }) }));
  }, [reducedMotion]);
  const selectedRoute = useMemo(() => routes.find((r) => r.id === selectedId) ?? null, [routes, selectedId]);
  const selectedLocation = useMemo(() => (selectedRoute ? null : locations.find((l) => l.id === selectedId) ?? null), [locations, selectedId, selectedRoute]);
  const flownTo = useRef<string | null>(props.cameraFromUrl ? props.selectedId : null);
  useEffect(() => {
    if (!selectedId || flownTo.current === selectedId) return;
    if (selectedRoute) { const [lat, lng] = routeMidpoint(selectedRoute.path); flownTo.current = selectedId; flyTo(lat, lng, 4); }
    else if (selectedLocation) { flownTo.current = selectedId; flyTo(selectedLocation.lat, selectedLocation.lng, 5.2); }
  }, [selectedId, selectedRoute, selectedLocation, flyTo]);
  useEffect(() => { if (!selectedId) flownTo.current = null; }, [selectedId]);

  // ---- camera back to the URL (debounced; the URL is never read again after the first render, so there is no loop)
  const firstCamera = useRef(true);
  useEffect(() => {
    if (firstCamera.current) { firstCamera.current = false; return; }
    const id = window.setTimeout(() => onCameraChange({ lat: viewState.latitude, lon: wrapLng(viewState.longitude), zoom: viewState.zoom }), 500);
    return () => window.clearTimeout(id);
  }, [viewState, onCameraChange]);

  // ---- layers
  const pieces = useMemo(() => routePieces(routes), [routes]);
  const watch: WatchVessel[] = wl?.status === "SNAPSHOT" ? wl.vessels : [];
  const selectedSimInfo: VesselInfo | null = sim && selectedSim !== null ? sim.info(selectedSim) : null;
  const hoveredRouteId = hover?.kind === "route" ? hover.id ?? null : null;
  // Country outlines at the level of detail the zoom can show (lib/mapSimplify.ts). Each level is one deck.gl layer that is built ONCE, the first time it is needed, and
  // afterwards only shown or hidden: changing a layer's data makes deck.gl re-tessellate every polygon on the main thread (seconds on software rendering).
  // While the camera moves, every move redraws the outlines, so the coarsest level (9,000 vertices instead of 72,000) is the one shown; the right level for the
  // zoom comes back 220 ms after the camera stops.
  const [camMoving, setCamMoving] = useState(false);
  const camTimer = useRef<number | undefined>(undefined);
  const noteCameraMoved = useCallback(() => {
    setCamMoving(true);
    window.clearTimeout(camTimer.current);
    camTimer.current = window.setTimeout(() => setCamMoving(false), 220);
  }, []);
  useEffect(() => () => window.clearTimeout(camTimer.current), []);
  const wanted = detailIndex(viewState.zoom);
  const activeDetail = camMoving ? 0 : wanted;
  const loadedLevels = useRef<{ src: object | null; have: Map<number, object> }>({ src: null, have: new Map() });
  if (countries && loadedLevels.current.src !== countries) loadedLevels.current = { src: countries, have: new Map() };
  if (countries) for (const i of camMoving ? [0] : [0, wanted]) if (!loadedLevels.current.have.has(i)) loadedLevels.current.have.set(i, simplifyCountries(countries, DETAIL_LEVELS[i].tolerance));
  const levelCount = loadedLevels.current.have.size;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const countryLevels = useMemo<CountryLevel[]>(() => [...loadedLevels.current.have.entries()].sort((a, b) => a[0] - b[0]).map(([index, data]) => ({ index, data })), [countries, levelCount]);
  const seaLabelCount = SEA_LABELS.filter((s) => viewState.zoom >= s.minZoom).length;     // the labels shown are fully decided by how many pass the zoom test
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const baseLayers = useMemo(() => buildBaseLayers(countryLevels, activeDetail, viewState.zoom), [countryLevels, activeDetail, seaLabelCount]);
  const layers = buildLayers({
    pieces, routes, locations, on, hoveredRouteId, selectedRouteId: selectedRoute?.id ?? null, disrupted, conflictIntensity: props.conflictIntensity,
    time: reducedMotion ? 0.7 * 2.4 : timeRef.current, zoom: viewState.zoom, sim: sim && on.has("simulated") ? simPack : null,
    selectedSim: selectedSimInfo ? { lng: selectedSimInfo.lng, lat: selectedSimInfo.lat } : null, watch, selectedWatchMmsi: selectedWatch,
  });
  void frame;

  const pick = useCallback((info: PickingInfo, kind: "hover" | "click") => {
    const id = info.layer?.id;
    if (kind === "hover") {
      if (!id || !info.picked) return setHover(null);
      if (id === "routes") return setHover({ kind: "route", id: (info.object as { id: string }).id, x: info.x, y: info.y });
      if (id === "chokepoints" || id === "places") return setHover({ kind: "location", id: (info.object as Location).id, x: info.x, y: info.y });
      if (id === "vessels-sim") return setHover({ kind: "sim", index: info.index, x: info.x, y: info.y });
      if (id === "vessels-watch") return setHover({ kind: "watch", mmsi: (info.object as WatchVessel).mmsi, x: info.x, y: info.y });
      return setHover(null);
    }
    if (!id || !info.picked) { setSelectedSim(null); setSelectedWatch(null); return; }
    if (id === "routes") { setSelectedSim(null); setSelectedWatch(null); onSelectedChange((info.object as { id: string }).id); }
    else if (id === "chokepoints" || id === "places") { setSelectedSim(null); setSelectedWatch(null); onSelectedChange((info.object as Location).id); }
    else if (id === "vessels-sim") { setSelectedWatch(null); setSelectedSim(info.index); }
    else if (id === "vessels-watch") { setSelectedSim(null); setSelectedWatch((info.object as WatchVessel).mmsi); }
  }, [onSelectedChange]);

  const closePanels = useCallback(() => onSelectedChange(null), [onSelectedChange]);
  const resetView = useCallback(() => flyTo(DEFAULT_CAMERA.lat, DEFAULT_CAMERA.lon, DEFAULT_CAMERA.zoom), [flyTo]);
  const zoomBy = useCallback((d: number) => setViewState((vs) => ({ ...vs, zoom: clampZoom(vs.zoom + d), transitionDuration: reducedMotion ? 0 : 250, transitionInterpolator: new FlyToInterpolator({ speed: 3 }) })), [reducedMotion]);

  // ---- DEV-only test bridge (stripped from production builds)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __map?: unknown };
    w.__map = {
      project: (lat: number, lng: number) => { const vp = deckRef.current?.deck?.getViewports()[0]; if (!vp) return null; const [x, y] = vp.project([lng, lat]); return { x, y }; },
      zoom: () => viewState.zoom,
      simCount: () => sim?.count ?? 0,
      watchLabels: () => watchGroupLabels(watch).map((g) => g.text),
      layers: () => [...on],
      flyTo: (lat: number, lng: number, zoom: number) => setViewState((vs) => ({ ...vs, latitude: lat, longitude: lng, zoom, transitionDuration: 0 })),
      selectSim: (i: number | null) => setSelectedSim(i),
      firstSimNear: (lat: number, lng: number) => { if (!sim) return -1; let best = -1, bd = 1e9; for (let i = 0; i < sim.count; i++) { const d = (geo.lat[i] - lat) ** 2 + (geo.lng[i] - lng) ** 2; if (d < bd) { bd = d; best = i; } } return best; },
      rerouted: () => { for (let i = 0; i < geo.state.length; i++) if (geo.state[i] === 1) return i; return -1; },
    };
    return () => { delete w.__map; };
  });

  const hoveredRouteData = hover?.kind === "route" ? routes.find((r) => r.id === hover.id) ?? null : null;
  const hoveredLocation = hover?.kind === "location" ? locations.find((l) => l.id === hover.id) ?? null : null;
  const hoveredSim: VesselInfo | null = hover?.kind === "sim" && sim && hover.index !== undefined ? sim.info(hover.index) : null;
  const hoveredWatch = hover?.kind === "watch" ? watch.find((v) => v.mmsi === hover.mmsi) ?? null : null;
  const counts = {
    routes: routes.length, chokepoints: locations.filter((l) => l.type === "chokepoint").length, places: locations.filter((l) => l.type !== "chokepoint").length,
    simulated: sim?.count ?? 0, watchlist: wl, watchlistLoading: watchlist.status === "loading", scenarioRoute: routes.find((r) => r.id === props.disruptedRouteId)?.name ?? null,
  };
  const selectedWatchVessel = selectedWatch !== null ? watch.find((v) => v.mmsi === selectedWatch) ?? null : null;

  return (
    <div data-testid="map-view" style={{ position: "relative", width: "100%", height: "100%", background: "#05070a", overflow: "hidden" }} role="region" aria-label="2D map of oil routes and tankers">
      <DeckGL
        id="deck-base"
        views={MAP_VIEW}
        viewState={viewState}
        controller={false}
        layers={baseLayers}
        style={BASE_STYLE}
      />
      <DeckGL
        ref={deckRef}
        views={MAP_VIEW}
        viewState={viewState}
        onViewStateChange={({ viewState: vs }) => { setViewState(vs as MapViewState); noteCameraMoved(); }}
        controller={CONTROLLER}
        layers={layers}
        pickingRadius={6}
        onHover={(i) => pick(i, "hover")}
        onClick={(i) => pick(i, "click")}
        getCursor={cursor}
        style={DECK_STYLE}
      />

      <LayersPanel on={on} onToggle={toggle} counts={counts} />

      <div style={{ position: "absolute", left: 12, bottom: 12, zIndex: 5, display: "flex", flexDirection: "column", gap: 2, pointerEvents: "none" }} data-testid="route-legend" className="text-[11px]">
        <span style={{ color: "var(--color-ash)" }}><span style={{ color: "var(--color-lane)" }}>━ ━</span> sea lane / chokepoint (flow)</span>
        <span style={{ color: "var(--color-ash)" }}><span style={{ color: "var(--color-crude)" }}>━━</span> pipeline (nameplate capacity)</span>
        <span style={{ color: "var(--color-ash)" }}><span style={{ color: "var(--color-alarm)" }}>━ ━</span> disrupted route</span>
        <span style={{ color: "var(--color-ash)" }}>Route geometry is illustrative, not surveyed. Map: Natural Earth (public domain).</span>
      </div>

      <div style={{ position: "absolute", right: 12, bottom: 12, zIndex: 5, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, pointerEvents: "none", maxWidth: "min(360px, 60%)" }}>
        {on.has("watchlist") && haveSnapshot && (
          <div data-testid="watch-badge" className="data-readout" style={{ fontSize: 11, color: "var(--color-ion)", background: "rgba(3,3,3,0.9)", border: "1px solid rgba(89,224,201,0.4)", borderRadius: 4, padding: "5px 9px", textAlign: "right" }}>
            SNAPSHOT {fmtUtc(wl!.captured_at_utc)} · {wl!.vessels.length} REAL TANKERS
            <span style={{ display: "block", color: "var(--color-ash)" }}>{wl!.label}</span>
          </div>
        )}
        {on.has("simulated") && sim && (
          <div data-testid="vessel-badge" className="data-readout" style={{ fontSize: 11, color: "var(--color-crude)", background: "rgba(3,3,3,0.9)", border: "1px solid rgba(232,135,30,0.4)", borderRadius: 4, padding: "5px 9px", textAlign: "right" }}>
            SIMULATED VESSELS
            <span style={{ display: "block", color: "var(--color-ash)" }}>Invented for illustration. Not real traffic.</span>
          </div>
        )}
      </div>

      <div style={{ position: "absolute", left: 12, bottom: 116, zIndex: 5, display: "flex", flexDirection: "column", gap: 4 }}>
        {[["+", "Zoom in", 1], ["−", "Zoom out", -1]].map(([sym, label, d]) => (
          <button key={label as string} type="button" aria-label={label as string} data-testid={`map-zoom-${(d as number) > 0 ? "in" : "out"}`} onClick={() => zoomBy(d as number)}
            style={{ width: 30, height: 30, background: "rgba(3,3,3,0.9)", border: "1px solid rgba(244,241,234,0.2)", borderRadius: 4, color: "var(--color-bone)", cursor: "pointer", fontSize: 16 }}>{sym}</button>
        ))}
        <button type="button" data-testid="map-reset-view" onClick={resetView} className="text-xs" style={{ marginTop: 2, padding: "5px 8px", background: "rgba(3,3,3,0.9)", border: "1px solid rgba(244,241,234,0.2)", borderRadius: 4, color: "var(--color-bone)", cursor: "pointer" }}>Reset view</button>
      </div>

      <nav aria-label="Routes (keyboard access)" data-testid="route-keyboard-list" className="sr-only focus-within:not-sr-only"
        style={{ position: "absolute", left: 12, bottom: 96, zIndex: 8, maxWidth: 360, background: "rgba(3,3,3,0.94)", border: "1px solid rgba(244,241,234,0.2)", borderRadius: 6, padding: "8px 10px" }}>
        <div className="section-label" style={{ marginBottom: 6 }}>Open a route (Enter)</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {routes.map((r) => (
            <button key={r.id} type="button" onClick={() => onSelectedChange(r.id)} className="text-xs" style={{ padding: "3px 8px", border: "1px solid rgba(244,241,234,0.25)", borderRadius: 3, color: "var(--color-bone)", cursor: "pointer" }}>{r.name}</button>
          ))}
        </div>
      </nav>

      {hover && (hoveredRouteData || hoveredLocation || hoveredSim || hoveredWatch) && (
        <div data-testid="route-tooltip" role="tooltip" style={{ position: "absolute", left: Math.min(hover.x + 14, 9999), top: hover.y + 14, pointerEvents: "none", zIndex: 9, background: "rgba(3,3,3,0.92)", border: "1px solid rgba(244,241,234,0.16)", borderRadius: 6, padding: "7px 11px", maxWidth: 250 }}>
          {hoveredRouteData && (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-bone)" }}>{hoveredRouteData.name}</div>
              <div className="data-readout" style={{ fontSize: 10, color: "var(--color-ash)", marginTop: 2 }}>{ROUTE_TYPE_LABEL[hoveredRouteData.type]}</div>
              <div className="data-readout" style={{ fontSize: 11, color: hoveredRouteData.type === "pipeline" ? "var(--color-crude)" : "var(--color-lane)", marginTop: 2 }}>
                {hoveredRouteData.excluded_from_calculations ? "n/a (no sourced figure)" : hoveredRouteData.type === "pipeline" ? `nameplate capacity ${formatMbpd(hoveredRouteData.capacity_bpd)}` : `flow ${formatMbpd(hoveredRouteData.annual_flow_bpd)} (${hoveredRouteData.baseline_year ?? hoveredRouteData.data_year})`}
              </div>
            </>
          )}
          {hoveredLocation && (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-bone)" }}>{hoveredLocation.name}</div>
              <div className="data-readout" style={{ fontSize: 10, color: "var(--color-ash)", marginTop: 2 }}>{hoveredLocation.type === "chokepoint" ? "Chokepoint" : hoveredLocation.type === "hub" ? "Refinery / export hub" : "City (illustrative)"}</div>
              {hoveredLocation.metrics[0] && <div className="data-readout" style={{ fontSize: 11, color: "var(--color-crude)", marginTop: 2 }}>{hoveredLocation.metrics[0].label}: {hoveredLocation.metrics[0].value} {hoveredLocation.metrics[0].unit ?? ""}</div>}
            </>
          )}
          {hoveredSim && (
            <>
              <div className="section-label" style={{ color: "var(--color-crude)" }}>SIMULATED VESSEL</div>
              <div className="data-readout" style={{ fontSize: 11, color: "var(--color-bone)", marginTop: 2 }}>{hoveredSim.status}</div>
            </>
          )}
          {hoveredWatch && (
            <>
              <div className="section-label" style={{ color: "var(--color-ion)" }}>SNAPSHOT · REAL VESSEL</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-bone)", marginTop: 2 }}>{hoveredWatch.name ?? `MMSI ${hoveredWatch.mmsi}`}</div>
              <div className="data-readout" style={{ fontSize: 10, color: "var(--color-ash)", marginTop: 2 }}>{hoveredWatch.nav_status} · {hoveredWatch.area}</div>
            </>
          )}
        </div>
      )}

      {selectedSimInfo && <VesselPanel info={selectedSimInfo} onClose={() => setSelectedSim(null)} />}
      {selectedWatchVessel && <WatchVesselPanel vessel={selectedWatchVessel} onClose={() => setSelectedWatch(null)} />}
      <Panels route={selectedRoute} location={selectedLocation} conflicts={props.conflicts} currentConditions={props.currentConditions} onClose={closePanels} onSimulate={props.onSimulateRoute} />
    </div>
  );
}
