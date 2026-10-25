import { useCallback, useEffect, useMemo, useState } from "react";
import AlertFeed from "./components/AlertFeed";
import ChokepointPanel from "./components/ChokepointPanel";
import EarthGlobe from "./components/globe/EarthGlobe";
import Header from "./components/Header";
import HistoricalChart from "./components/HistoricalChart";
import ScenarioPanel from "./components/ScenarioPanel";
import { mockConflicts } from "./data/mockConflicts";
import { mockRefineries } from "./data/mockRefineries";
import { useLiveOrMock, type DataStatus } from "./hooks/useLiveOrMock";
import { useNewsStream } from "./hooks/useNewsStream";
import { useRoutes } from "./hooks/useRoutes";
import { getConflicts, getRefineries } from "./lib/api";
import { buildLocations } from "./lib/locations";
import type { ConflictEvent, RouteScenarioPrefill } from "./types";

export default function App() {
  const [selectedChokepoint, setSelectedChokepoint] = useState<string | null>(null);

  // Route layer: sourced route data from the backend (never mocked). Failure just means no route layer.
  const routesState = useRoutes();
  const routes = useMemo(() => routesState.data?.routes ?? [], [routesState.data]);
  const currentConditions = routesState.data?.current_conditions ?? null;

  // "Simulate disruption on this route" -> pre-fills the scenario controls; the scenario panel reports
  // back which route is disrupted so the globe can draw it crimson.
  const [prefill, setPrefill] = useState<RouteScenarioPrefill | null>(null);
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
      <Header backendStatus={backendStatus} priceState={priceState} streamStatus={streamStatus} />
      <main className="flex-1 flex flex-col overflow-y-auto lg:grid lg:grid-cols-[1fr_400px] lg:overflow-hidden gap-0">
        <div className="flex flex-col lg:min-h-0">
          <div className="min-h-[320px] h-[320px] lg:h-auto lg:flex-1 relative">
            <EarthGlobe
              locations={locations}
              conflicts={conflicts}
              routes={routes}
              currentConditions={currentConditions}
              disruptedRouteId={disrupted?.routeId ?? null}
              altRouteId={disrupted?.altRouteId ?? null}
              conflictIntensity={conflictIntensity}
              onSimulateRoute={handleSimulateRoute}
            />
            <RouteLayerStatus state={routesState} />
          </div>
          <div className="px-8 pb-8 pt-2">
            <HistoricalChart conflicts={conflicts} />
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
function RouteLayerStatus({ state }: { state: ReturnType<typeof useRoutes> }) {
  return (
    <div
      data-testid="route-legend"
      className="absolute left-4 bottom-3 text-[11px] flex flex-col gap-1"
      style={{ color: "var(--color-ash)", pointerEvents: "none" }}
    >
      {state.status === "loading" && <span>Loading routes...</span>}
      {state.status === "error" && <span style={{ color: "var(--color-alarm)" }}>Route layer unavailable: backend not reachable.</span>}
      {state.status === "ready" && (
        <>
          <span><span style={{ color: "#5aa9ff" }}>━ ━</span> sea lane / chokepoint (flow)</span>
          <span><span style={{ color: "var(--color-crude)" }}>━━</span> pipeline (nameplate capacity)</span>
          <span><span style={{ color: "var(--color-alarm)" }}>━ ━</span> disrupted route</span>
          <span>Route geometry is illustrative, not surveyed.</span>
        </>
      )}
    </div>
  );
}
