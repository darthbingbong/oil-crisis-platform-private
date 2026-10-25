import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { Vector3, type Group } from "three";
import { useVesselStream } from "../../hooks/useVesselStream";
import { AisVessels, VesselSim, buildLanes, type Scenario, type VesselInfo, type VesselSource } from "../../lib/vesselSim";
import { VesselControls, VesselPanel, type VesselMode } from "../VesselUi";
import VesselLayer from "./VesselLayer";
import { latLngToVector3 } from "../../lib/geo";
import { ROUTE_TYPE_LABEL, formatMbpd, routeMidpoint } from "../../lib/routeGeometry";
import { useReducedMotion } from "../../lib/useReducedMotion";
import type { ConflictEvent, CurrentConditions, Location, RouteScenarioPrefill, RouteSummary } from "../../types";
import RoutePanel from "../RoutePanel";
import Atmosphere from "./Atmosphere";
import Clouds from "./Clouds";
import Earth, { EARTH_RADIUS } from "./Earth";
import LocationDetail from "./LocationDetail";
import Markers from "./Markers";
import RouteLayer from "./RouteLayer";

interface Props {
  locations: Location[];
  conflicts: ConflictEvent[];
  routes: RouteSummary[];
  currentConditions: CurrentConditions | null;
  /** Route under an active scenario (drawn crimson/elevated) and the alternate lane for a detour. */
  disruptedRouteId: string | null;
  altRouteId: string | null;
  conflictIntensity: number;
  onSimulateRoute: (prefill: Omit<RouteScenarioPrefill, "nonce">) => void;
}

type Phase = "idle" | "traveling" | "detail" | "returning";

const TRAVEL_DISTANCE = 3.6;
const TRAVEL_DURATION_S = 1.1;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

interface RotatingGlobeProps {
  locations: Location[];
  groupRef: React.RefObject<Group | null>;
  paused: boolean;
  reducedMotion: boolean;
  hoveredId: string | null;
  focusedId: string | null;
  setHoveredId: Dispatch<SetStateAction<string | null>>;
  setFocusedId: Dispatch<SetStateAction<string | null>>;
  onActivate: (loc: Location) => void;
  interactive: boolean;
  vessels: {
    source: VesselSource | null;
    scenario: Scenario | null;
    selected: number | null;
    onSelect: (i: number | null) => void;
    onTick: (info: VesselInfo | null) => void;
  };
  routeLayer: {
    routes: RouteSummary[];
    hoveredRouteId: string | null;
    focusedRouteId: string | null;
    disruptedRouteId: string | null;
    altRouteId: string | null;
    conflictIntensity: number;
    onHover: (id: string | null, x?: number, y?: number) => void;
    onSelect: (route: RouteSummary) => void;
  };
}

/** Owns rotation for Earth + Markers together, so markers stay glued to
 * their real lat/lng as the globe turns (~150s per rotation). Rotation
 * pauses whenever a marker is targeted, the camera is traveling/showing
 * detail/returning, OR the user has asked for reduced motion -- a spinning
 * globe under an active camera flight or a fixed detail view would fight
 * both the animation and the reader, and continuous ambient spin is exactly
 * the kind of non-essential motion prefers-reduced-motion asks to remove. */
function RotatingGlobe({
  locations,
  groupRef,
  paused,
  reducedMotion,
  hoveredId,
  focusedId,
  setHoveredId,
  setFocusedId,
  onActivate,
  interactive,
  vessels,
  routeLayer,
}: RotatingGlobeProps) {
  useFrame((_, delta) => {
    if (groupRef.current && !paused) {
      groupRef.current.rotation.y += delta * ((Math.PI * 2) / 150);
    }
  });

  return (
    <group ref={groupRef}>
      <Earth />
      <Markers
        locations={locations}
        hoveredId={hoveredId}
        focusedId={focusedId}
        setHoveredId={setHoveredId}
        setFocusedId={setFocusedId}
        onActivate={onActivate}
        interactive={interactive}
        reducedMotion={reducedMotion}
      />
      <RouteLayer
        routes={routeLayer.routes}
        hoveredId={routeLayer.hoveredRouteId}
        focusedId={routeLayer.focusedRouteId}
        disruptedId={routeLayer.disruptedRouteId}
        altId={routeLayer.altRouteId}
        conflictIntensity={routeLayer.conflictIntensity}
        interactive={interactive}
        reducedMotion={reducedMotion}
        onHover={routeLayer.onHover}
        onSelect={routeLayer.onSelect}
      />
      {vessels.source && (
        <VesselLayer
          source={vessels.source}
          scenario={vessels.scenario}
          paused={reducedMotion}
          interactive={interactive}
          selected={vessels.selected}
          onSelect={vessels.onSelect}
          onTick={vessels.onTick}
        />
      )}
    </group>
  );
}

/** DEV-ONLY test bridge (stripped from production builds): lets a browser test project a lat/lng to screen
 * pixels and turn the globe to face the camera, so screenshots can target a route deterministically. */
function DebugBridge({ groupRef }: { groupRef: React.RefObject<Group | null> }) {
  const { camera, size, gl } = useThree();
  useEffect(() => {
    const w = window as unknown as { __globe?: unknown };
    w.__globe = {
      stats: () => ({ calls: gl.info.render.calls, triangles: gl.info.render.triangles, geometries: gl.info.memory.geometries }),
      project(lat: number, lng: number) {
        const g = groupRef.current;
        if (!g) return null;
        const v = g.localToWorld(latLngToVector3(lat, lng, EARTH_RADIUS * 1.004)).project(camera);
        return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height, front: v.z < 1 };
      },
      /** Turn the globe AND tilt the camera so (lat, lng) is dead centre at distance `dist`. */
      look(lat: number, lng: number, dist: number) {
        const g = groupRef.current;
        if (!g) return;
        const p = latLngToVector3(lat, lng, 1);
        g.rotation.y = Math.atan2(camera.position.x, camera.position.z) - Math.atan2(p.x, p.z);
        g.updateMatrixWorld(true);
        camera.position.copy(g.localToWorld(p.clone()).normalize().multiplyScalar(dist));
        camera.lookAt(0, 0, 0);
      },
      face(lat: number, lng: number) {
        const g = groupRef.current;
        if (!g) return;
        // azimuth' = azimuth + rotation.y, so rotate by (camera azimuth - point azimuth)
        const p = latLngToVector3(lat, lng, 1);
        g.rotation.y = Math.atan2(camera.position.x, camera.position.z) - Math.atan2(p.x, p.z);
      },
    };
    return () => {
      delete w.__globe;
    };
  }, [camera, size, gl, groupRef]);
  return null;
}

interface CameraRigProps {
  phase: Phase;
  travelTargetLocal: Vector3 | null;
  rotatingGroupRef: React.RefObject<Group | null>;
  savedCamera: React.RefObject<{ position: Vector3; distance: number } | null>;
  reducedMotion: boolean;
  onArrived: () => void;
  onReturned: () => void;
}

/** Drives the camera imperatively during "traveling"/"returning" -- OrbitControls
 * is unmounted for the duration (see EarthGlobe below) so it can't fight this
 * every frame. Interpolates direction-from-center and distance separately
 * (rather than lerping raw positions) so the camera arcs over the globe's
 * surface instead of cutting straight through it. */
function CameraRig({ phase, travelTargetLocal, rotatingGroupRef, savedCamera, reducedMotion, onArrived, onReturned }: CameraRigProps) {
  const { camera } = useThree();
  const startDir = useRef(new Vector3());
  const startDist = useRef(0);
  const endDir = useRef(new Vector3());
  const endDist = useRef(0);
  const elapsed = useRef(0);
  const running = useRef<"traveling" | "returning" | null>(null);

  useEffect(() => {
    if (phase === "traveling" && travelTargetLocal && rotatingGroupRef.current) {
      const worldTarget = rotatingGroupRef.current.localToWorld(travelTargetLocal.clone());
      savedCamera.current = { position: camera.position.clone(), distance: camera.position.length() };
      startDir.current.copy(camera.position).normalize();
      startDist.current = camera.position.length();
      endDir.current.copy(worldTarget).normalize();
      endDist.current = TRAVEL_DISTANCE;
      elapsed.current = 0;
      running.current = "traveling";
    } else if (phase === "returning" && savedCamera.current) {
      startDir.current.copy(camera.position).normalize();
      startDist.current = camera.position.length();
      endDir.current.copy(savedCamera.current.position).normalize();
      endDist.current = savedCamera.current.distance;
      elapsed.current = 0;
      running.current = "returning";
    }
    // Deliberately re-run only on phase changes: the start/end refs above are
    // meant to be captured once per transition, not recomputed every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useFrame((_, delta) => {
    if (!running.current) return;
    const duration = reducedMotion ? 0.001 : TRAVEL_DURATION_S;
    elapsed.current += delta;
    const t = Math.min(elapsed.current / duration, 1);
    const eased = easeInOutCubic(t);

    const dir = startDir.current.clone().lerp(endDir.current, eased).normalize();
    const dist = startDist.current + (endDist.current - startDist.current) * eased;
    camera.position.copy(dir.multiplyScalar(dist));
    camera.lookAt(0, 0, 0);

    if (t >= 1) {
      const finished = running.current;
      running.current = null;
      if (finished === "traveling") onArrived();
      else onReturned();
    }
  });

  return null;
}

export default function EarthGlobe({
  locations,
  conflicts,
  routes,
  currentConditions,
  disruptedRouteId,
  altRouteId,
  conflictIntensity,
  onSimulateRoute,
}: Props) {
  const [hoveredRoute, setHoveredRoute] = useState<{ id: string; x: number; y: number; width: number } | null>(null);
  const [activeRoute, setActiveRoute] = useState<RouteSummary | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [activeLocation, setActiveLocation] = useState<Location | null>(null);
  const [travelTargetLocal, setTravelTargetLocal] = useState<Vector3 | null>(null);

  const [vesselMode, setVesselMode] = useState<VesselMode>("simulated");
  const [selectedVessel, setSelectedVessel] = useState<number | null>(null);
  const [vesselInfo, setVesselInfo] = useState<VesselInfo | null>(null);
  const stream = useVesselStream(vesselMode === "ais");
  const sim = useMemo(() => {
    const lanes = buildLanes(routes);
    return lanes.length ? new VesselSim(lanes, 2000) : null;
  }, [routes]);
  const ais = useMemo(() => new AisVessels(stream.vessels), [stream.vessels]);
  const showingAis = vesselMode === "ais" && stream.status?.state === "streaming";
  // DEV-only switch for performance comparisons (?vessels=0). Production builds always draw the vessel layer.
  const vesselsOff = import.meta.env.DEV && new URLSearchParams(window.location.search).get("vessels") === "0";
  const vesselSource: VesselSource | null = vesselsOff ? null : showingAis ? ais : sim;
  const vesselScenario = useMemo<Scenario | null>(
    () => (disruptedRouteId ? { disruptedId: disruptedRouteId, altId: altRouteId } : null),
    [disruptedRouteId, altRouteId]
  );

  const rotatingGroupRef = useRef<Group>(null);
  const savedCamera = useRef<{ position: Vector3; distance: number } | null>(null);
  const reducedMotion = useReducedMotion();

  const targeting = hoveredId !== null || focusedId !== null || hoveredRoute !== null;
  const paused = targeting || phase !== "idle" || reducedMotion;
  const interactive = phase === "idle";

  const handleActivate = useCallback(
    (loc: Location) => {
      if (phase !== "idle") return; // guard against overlapping transitions (rapid double-click, etc.)
      setActiveLocation(loc);
      setTravelTargetLocal(latLngToVector3(loc.lat, loc.lng, EARTH_RADIUS * 1.003));
      setPhase("traveling");
    },
    [phase]
  );

  const handleSelectRoute = useCallback(
    (route: RouteSummary) => {
      if (phase !== "idle") return;
      const [lat, lng] = routeMidpoint(route.path);
      setActiveRoute(route);
      setActiveLocation(null);
      setHoveredRoute(null);
      setTravelTargetLocal(latLngToVector3(lat, lng, EARTH_RADIUS * 1.003));
      setPhase("traveling");
    },
    [phase]
  );

  const handleRouteHover = useCallback((id: string | null, x?: number, y?: number) => {
    if (id === null) return setHoveredRoute(null);
    // position relative to the globe container, computed here (an event handler), not during render
    const rect = containerRef.current?.getBoundingClientRect();
    setHoveredRoute({ id, x: (x ?? 0) - (rect?.left ?? 0), y: (y ?? 0) - (rect?.top ?? 0), width: rect?.width ?? 1000 });
  }, []);

  const handleBack = useCallback(() => {
    if (phase !== "detail") return;
    setPhase("returning");
  }, [phase]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (phase === "detail") {
        handleBack();
      } else if (phase === "idle" && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, handleBack]);

  const hoveredRouteData = hoveredRoute ? (routes.find((r) => r.id === hoveredRoute.id) ?? null) : null;

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%" }}>
      <Canvas
        camera={{ position: [0, 0, 5.5], fov: 45 }}
        gl={{ antialias: true }}
        dpr={[1, 2]}
      >
        <color attach="background" args={["#030303"]} />
        <ambientLight intensity={0.15} />

        <Suspense fallback={null}>
          <RotatingGlobe
            locations={locations}
            groupRef={rotatingGroupRef}
            paused={paused}
            reducedMotion={reducedMotion}
            hoveredId={hoveredId}
            focusedId={focusedId}
            setHoveredId={setHoveredId}
            setFocusedId={setFocusedId}
            onActivate={handleActivate}
            interactive={interactive}
            vessels={{
              source: vesselSource,
              scenario: showingAis ? null : vesselScenario,
              selected: selectedVessel,
              onSelect: setSelectedVessel,
              onTick: setVesselInfo,
            }}
            routeLayer={{
              routes,
              hoveredRouteId: hoveredRoute?.id ?? null,
              focusedRouteId: activeRoute?.id ?? null,
              disruptedRouteId,
              altRouteId,
              conflictIntensity,
              onHover: handleRouteHover,
              onSelect: handleSelectRoute,
            }}
          />
          {import.meta.env.DEV && <DebugBridge groupRef={rotatingGroupRef} />}
          <Clouds reducedMotion={reducedMotion} />
          <Atmosphere />
        </Suspense>

        {(phase === "traveling" || phase === "returning") && (
          <CameraRig
            phase={phase}
            travelTargetLocal={travelTargetLocal}
            rotatingGroupRef={rotatingGroupRef}
            savedCamera={savedCamera}
            reducedMotion={reducedMotion}
            onArrived={() => setPhase("detail")}
            onReturned={() => {
              setPhase("idle");
              setActiveLocation(null);
              setActiveRoute(null);
              setTravelTargetLocal(null);
            }}
          />
        )}

        {phase === "idle" && (
          <OrbitControls
            enablePan={false}
            enableZoom
            minDistance={3.2}
            maxDistance={9}
            autoRotate={!targeting && !reducedMotion}
            autoRotateSpeed={0.15}
            rotateSpeed={0.4}
            enableDamping
            dampingFactor={0.08}
          />
        )}
      </Canvas>

      <VesselControls
        mode={vesselMode}
        setMode={(m) => { setVesselMode(m); setSelectedVessel(null); setVesselInfo(null); }}
        showingAis={showingAis}
        phase={stream.phase}
        status={stream.status}
        aisCount={stream.vessels.length}
      />
      {selectedVessel !== null && vesselInfo && phase === "idle" && (
        <VesselPanel info={vesselInfo} onClose={() => { setSelectedVessel(null); setVesselInfo(null); }} />
      )}

      {hoveredRouteData && hoveredRoute && (
        <div
          data-testid="route-tooltip"
          role="tooltip"
          style={{
            position: "absolute",
            left: Math.min(hoveredRoute.x + 14, hoveredRoute.width - 250),
            top: hoveredRoute.y + 14,
            pointerEvents: "none",
            zIndex: 5,
            background: "rgba(3,3,3,0.9)",
            border: "1px solid rgba(244,241,234,0.16)",
            borderRadius: 6,
            padding: "7px 11px",
            maxWidth: 240,
          }}
        >
          <div style={{ fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 600, color: "var(--color-bone)" }}>
            {hoveredRouteData.name}
          </div>
          <div className="data-readout" style={{ fontSize: 10, color: "var(--color-ash)", marginTop: 2 }}>
            {ROUTE_TYPE_LABEL[hoveredRouteData.type]}
          </div>
          <div
            className="data-readout"
            style={{ fontSize: 11, color: hoveredRouteData.type === "pipeline" ? "var(--color-crude)" : "#5aa9ff", marginTop: 2 }}
          >
            {hoveredRouteData.excluded_from_calculations
              ? "n/a (no sourced figure)"
              : hoveredRouteData.type === "pipeline"
                ? `nameplate capacity ${formatMbpd(hoveredRouteData.capacity_bpd)}`
                : `flow ${formatMbpd(hoveredRouteData.annual_flow_bpd)} (${hoveredRouteData.baseline_year ?? hoveredRouteData.data_year})`}
          </div>
        </div>
      )}

      {activeLocation && (
        <LocationDetail
          location={activeLocation}
          conflicts={conflicts}
          visible={phase === "detail"}
          onBack={handleBack}
          currentConditions={currentConditions}
        />
      )}

      {activeRoute && (
        <RoutePanel
          route={activeRoute}
          visible={phase === "detail"}
          onClose={handleBack}
          onSimulate={(prefill) => {
            onSimulateRoute(prefill);
            handleBack();
          }}
        />
      )}
    </div>
  );
}
