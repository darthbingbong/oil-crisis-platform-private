import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import AlertFeed from "../components/AlertFeed";
import ChokepointPanel from "../components/ChokepointPanel";
import EarthGlobe from "../components/globe/EarthGlobe";
import Header from "../components/Header";
import PriceTicker from "../components/PriceTicker";
import ScenarioPanel from "../components/ScenarioPanel";
import { mockConflicts } from "../data/mockConflicts";
import { mockRefineries } from "../data/mockRefineries";
import { useLiveOrMock, type DataStatus } from "../hooks/useLiveOrMock";
import { useNewsStream } from "../hooks/useNewsStream";
import { useRoutes } from "../hooks/useRoutes";
import { useWatchlist } from "../hooks/useWatchlist";
import { getConflicts, getRefineries } from "../lib/api";
import { buildLocations } from "../lib/locations";
import { parseScenario } from "../lib/scenarioParams";
import { parseViewParams, writeViewParams, type LayerId, type MapCamera, type ViewMode, type ViewWrite } from "../lib/viewState";
import type { ConflictEvent, RouteScenarioPrefill } from "../types";

// The 2D map (deck.gl and the country outlines) is only downloaded when someone opens it.
const MapView = lazy(() => import("../components/map/MapView"));

export default function Dashboard() {
  const [selectedChokepoint, setSelectedChokepoint] = useState<string | null>(null);

  // Route layer: sourced route data from the backend (never mocked). Failure just means no route layer.
  const routesState = useRoutes();
  const routes = useMemo(() => routesState.data?.routes ?? [], [routesState.data]);
  const currentConditions = routesState.data?.current_conditions ?? null;

  // "Simulate disruption on this route" -> pre-fills the scenario controls; the scenario panel reports
  // back which route is disrupted so the globe can draw it crimson.
  // "Edit scenario" on the Results page comes back here as /?edit=1&route=...: every control is restored from the URL when the
  // page mounts, and the address is then tidied.
  const [search, setSearch] = useSearchParams();

  // GLOBE | MAP, the selected route or place, the active map layers and the map camera all live in the URL: one shared state for both views, shareable and
  // surviving a reload. Every parameter is validated (lib/viewState.ts); a bad one falls back to its default.
  const viewParams = useMemo(() => parseViewParams(search), [search]);
  const view = viewParams.view;
  const watchlist = useWatchlist();
  const cameraRef = useRef<MapCamera | null>(null);
  // Every write starts from the browser's CURRENT address, not from the last rendered copy: a camera write that fires just after a layer toggle must not
  // undo it (React Router may not have re-rendered between the two).
  const updateView = useCallback(
    (patch: Partial<ViewWrite>, replace = true) => {
      const prev = new URLSearchParams(window.location.search);
      const cur = parseViewParams(prev);
      setSearch(writeViewParams(prev, { view: cur.view, camera: cur.cameraFromUrl ? cur.camera : undefined, layers: cur.layers, selected: cur.selected, ...patch }), { replace });
    },
    [setSearch]
  );
  const handleViewChange = useCallback((v: ViewMode) => updateView({ view: v, camera: v === "map" ? cameraRef.current ?? undefined : null }, false), [updateView]);
  const handleSelectedChange = useCallback((id: string | null) => updateView({ selected: id }), [updateView]);
  const handleLayersChange = useCallback((ids: LayerId[]) => updateView({ layers: ids }), [updateView]);
  const handleCameraChange = useCallback((c: MapCamera) => { cameraRef.current = c; updateView({ camera: c }); }, [updateView]);
  const [prefill, setPrefill] = useState<RouteScenarioPrefill | null>(() => {
    if (search.get("edit") !== "1") return null;
    const parsed = parseScenario(search);
    if (!parsed.ok) return null;
    const v = parsed.value;
    return {
      routeId: v.route, disruptionType: v.type, blockedSharePct: v.share, detourDays: v.detour ?? 12, nonce: Date.now(),
      detourUserSet: v.detour !== null, durationDays: v.dur, lithiumAvailabilityPct: v.li, conflictIntensity: v.conf, demandChangePct: v.dem,
      evSubstitutionPct: v.ev, horizonYears: v.horizon, fleetConstrained: v.fleet, baselineYear: v.by,
    };
  });
  useEffect(() => {
    if (search.get("edit") === "1") setSearch({}, { replace: true });
  }, [search, setSearch]);
  const [disrupted, setDisrupted] = useState<{ routeId: string; altRouteId: string | null } | null>(null);
  const [conflictIntensity, setConflictIntensity] = useState(6);
  const handleSimulateRoute = useCallback(
    (p: Omit<RouteScenarioPrefill, "nonce">) => setPrefill({ ...p, nonce: Date.now() }),
    []
  );
  const handleRouteScenarioChange = useCallback(
    (state: { routeId: string; altRouteId: string | null } | null, intensity: number) => {
      setDisrupted((prev) =>
        prev?.routeId === state?.routeId && prev?.altRouteId === state?.altRouteId ? prev : state && { routeId: state.routeId, altRouteId: state.altRouteId }
      );
      setConflictIntensity(intensity);
    },
    []
  );

  const refineriesFetcher = useCallback(() => getRefineries(), []);
  const { data: refineries, status: refineriesStatus } = useLiveOrMock(refineriesFetcher, mockRefineries);

  // Conflicts needs to be refetchable (not just fetched once on mount) --
  // the news pipeline appends live, real events to the same /api/v1/conflicts
  // endpoint the historical chart already reads, so a live price_event
  // should pull those in without a page reload.
  const [conflicts, setConflicts] = useState<ConflictEvent[]>(mockConflicts);
  const [conflictsStatus, setConflictsStatus] = useState<DataStatus>("loading");
  const refetchConflicts = useCallback(() => {
    getConflicts()
      .then((result) => {
        setConflicts(result);
        setConflictsStatus("live");
      })
      .catch(() => {
        setConflicts(mockConflicts);
        setConflictsStatus("mock");
      });
  }, []);
  useEffect(() => {
    refetchConflicts();
  }, [refetchConflicts]);

  const { status: streamStatus, priceState, alerts, lastEventId } = useNewsStream();

  // A live price-moving event -> the historical chart should pick up the
  // new row. lastEventId starts null (snapshot doesn't set it) so this
  // deliberately does NOT fire on initial mount, only on an actual push.
  useEffect(() => {
    if (lastEventId !== null) {
      refetchConflicts();
    }
  }, [lastEventId, refetchConflicts]);

  const locations = useMemo(() => buildLocations(refineries), [refineries]);

  const backendStatus =
    conflictsStatus === "loading" || refineriesStatus === "loading"
      ? "loading"
      : conflictsStatus === "live" && refineriesStatus === "live"
        ? "live"
        : "mock";

  return (
    <div className="h-screen flex flex-col bg-void">
      <PriceTicker />
      <Header backendStatus={backendStatus} priceState={priceState} streamStatus={streamStatus} view={view} onViewChange={handleViewChange} />
      <main className="flex-1 flex flex-col overflow-y-auto lg:grid lg:grid-cols-[1fr_400px] lg:overflow-hidden gap-0">
        <div className="flex flex-col lg:min-h-0">
          <div className="min-h-[320px] h-[320px] md:h-[480px] lg:h-auto lg:flex-1 relative">
            {view === "globe" ? (
              <EarthGlobe
                locations={locations}
                conflicts={conflicts}
                routes={routes}
                currentConditions={currentConditions}
                disruptedRouteId={disrupted?.routeId ?? null}
                altRouteId={disrupted?.altRouteId ?? null}
                conflictIntensity={conflictIntensity}
                onSimulateRoute={handleSimulateRoute}
                selectedId={viewParams.selected}
                onSelectedChange={handleSelectedChange}
              />
            ) : (
              <Suspense fallback={<div data-testid="map-loading" className="h-full flex items-center justify-center text-xs" style={{ color: "var(--color-ash)" }}>Loading the map...</div>}>
                <MapView
                  locations={locations}
                  conflicts={conflicts}
                  routes={routes}
                  currentConditions={currentConditions}
                  disruptedRouteId={disrupted?.routeId ?? null}
                  altRouteId={disrupted?.altRouteId ?? null}
                  conflictIntensity={conflictIntensity}
                  onSimulateRoute={handleSimulateRoute}
                  selectedId={viewParams.selected}
                  onSelectedChange={handleSelectedChange}
                  layers={viewParams.layers}
                  onLayersChange={handleLayersChange}
                  camera={viewParams.camera}
                  cameraFromUrl={viewParams.cameraFromUrl}
                  onCameraChange={handleCameraChange}
                  watchlist={watchlist}
                />
              </Suspense>
            )}
            <RouteLayerStatus state={routesState} legend={view === "globe"} />
          </div>
        </div>
        <div className="flex flex-col gap-16 lg:overflow-y-auto px-8 py-10 lg:border-l border-white/5">
          <ScenarioPanel
            newsUpdateSignal={lastEventId}
            routes={routes}
            prefill={prefill}
            onRouteScenarioChange={handleRouteScenarioChange}
          />
          <ChokepointPanel
            selected={selectedChokepoint}
            onSelect={setSelectedChokepoint}
            refineries={refineries}
          />
          <AlertFeed alerts={alerts} status={streamStatus} />
        </div>
      </main>
    </div>
  );
}

/** Small, honest status for the route layer: loading, failed (backend offline), or the legend. */
function RouteLayerStatus({ state, legend }: { state: ReturnType<typeof useRoutes>; legend: boolean }) {
  return (
    <div
      data-testid="route-legend"
      className="absolute left-4 bottom-3 text-[11px] flex flex-col gap-1"
      style={{ color: "var(--color-ash)", pointerEvents: "none" }}
    >
      {state.status === "loading" && <span>Loading routes...</span>}
      {state.status === "error" && <span style={{ color: "var(--color-alarm)" }}>Route layer unavailable: backend not reachable.</span>}
      {state.status === "ready" && legend && (
        <>
          <span><span style={{ color: "var(--color-lane)" }}>━ ━</span> sea lane / chokepoint (flow)</span>
          <span><span style={{ color: "var(--color-crude)" }}>━━</span> pipeline (nameplate capacity)</span>
          <span><span style={{ color: "var(--color-alarm)" }}>━ ━</span> disrupted route</span>
          <span>Route geometry is illustrative, not surveyed.</span>
        </>
      )}
    </div>
  );
}
