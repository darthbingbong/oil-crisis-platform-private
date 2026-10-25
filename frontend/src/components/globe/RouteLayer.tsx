import { Line } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Quaternion, TubeGeometry, Vector3, type Group, type Mesh, type MeshBasicMaterial } from "three";
import {
  ROUTE_COLORS,
  routeCurve,
  routeLineWidth,
  routeMidpoint,
  routePoints,
} from "../../lib/routeGeometry";
import { latLngToVector3 } from "../../lib/geo";
import type { RouteSummary } from "../../types";
import { EARTH_RADIUS } from "./Earth";

const SEA_LIFT = 1.004;
const PIPE_LIFT = 1.003;
const DISRUPTED_LIFT = 1.014; // elevated so a disrupted route reads above the others
const HIT_RADIUS = 0.035;
const FACING_MIN = 0.12;

interface Props {
  routes: RouteSummary[];
  hoveredId: string | null;
  focusedId: string | null;
  /** Route currently under a scenario (blockade/detour): drawn crimson, elevated, pulsing. */
  disruptedId: string | null;
  /** Alternate lane highlighted when the disrupted route is a detour. */
  altId: string | null;
  /** Scenario conflict_intensity (0-10); scales the pulsing ring on the disrupted chokepoint. */
  conflictIntensity: number;
  interactive: boolean;
  reducedMotion: boolean;
  onHover: (id: string | null, clientX?: number, clientY?: number) => void;
  onSelect: (route: RouteSummary) => void;
}

interface Built {
  route: RouteSummary;
  lineWidth: number;
  points: Vector3[];
  pointsLifted: Vector3[];
  hitGeometry: TubeGeometry;
  mid: Vector3;
  midQuat: Quaternion;
}

/** All routes and pipelines, drawn with fat lines that follow (illustrative) waypoints.
 * Sea lanes/chokepoints: blue with animated dashes showing direction. Pipelines: amber, thinner, solid.
 * Disrupted route: crimson, elevated, pulsing. Hover/click use invisible tube meshes (raycasting). */
export default function RouteLayer({
  routes,
  hoveredId,
  focusedId,
  disruptedId,
  altId,
  conflictIntensity,
  interactive,
  reducedMotion,
  onHover,
  onSelect,
}: Props) {
  const built = useMemo<Built[]>(
    () =>
      routes.map((route) => {
        const lift = route.type === "pipeline" ? PIPE_LIFT : SEA_LIFT;
        const points = routePoints(route.path, EARTH_RADIUS * lift);
        const pointsLifted = routePoints(route.path, EARTH_RADIUS * DISRUPTED_LIFT);
        const [mlat, mlng] = routeMidpoint(route.path);
        const mid = latLngToVector3(mlat, mlng, EARTH_RADIUS * 1.006);
        const midQuat = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), mid.clone().normalize());
        return {
          route,
          lineWidth: routeLineWidth(route),
          points,
          pointsLifted,
          hitGeometry: new TubeGeometry(routeCurve(points), Math.min(400, points.length * 2), HIT_RADIUS, 6, false),
          mid,
          midQuat,
        };
      }),
    [routes]
  );

  const { camera } = useThree();
  const lineRefs = useRef<Record<string, { material: { dashOffset: number; opacity: number } } | null>>({});
  const ringRefs = useRef<Record<string, Group | null>>({});

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    for (const b of built) {
      const id = b.route.id;
      const line = lineRefs.current[id];
      const isDisrupted = id === disruptedId;
      if (line && !reducedMotion && (b.route.type !== "pipeline" || isDisrupted)) {
        line.material.dashOffset -= delta * (isDisrupted ? 0.5 : 0.28);
      }
      if (line && isDisrupted && !reducedMotion) {
        line.material.opacity = 0.65 + 0.35 * Math.sin(t * 4);
      }
      const ring = ringRefs.current[id];
      if (ring) {
        const intensity = isDisrupted ? conflictIntensity : 2;
        const speed = 0.35 + intensity * 0.1;
        const amp = 0.7 + intensity * 0.22;
        ring.children.forEach((child, i) => {
          const phase = reducedMotion ? 0.5 : (t * speed + i * 0.5) % 1;
          child.scale.setScalar(1 + phase * amp);
          const mat = (child as Mesh).material as MeshBasicMaterial;
          mat.opacity = (1 - phase) * (isDisrupted ? 0.85 : 0.35);
        });
      }
    }
  });

  const frontFacing = (point: Vector3) => point.clone().normalize().dot(camera.position.clone().normalize()) > FACING_MIN;

  return (
    <group>
      {built.map((b) => {
        const { route } = b;
        const id = route.id;
        const isDisrupted = id === disruptedId;
        const isAlt = id === altId && !isDisrupted;
        const isHovered = id === hoveredId;
        const dimmed = focusedId !== null && focusedId !== id;
        const color = isDisrupted ? ROUTE_COLORS.disrupted : ROUTE_COLORS[route.type];
        const width = b.lineWidth * (isHovered ? 1.6 : 1) * (isDisrupted || isAlt ? 1.3 : 1);
        const baseOpacity = dimmed ? 0.1 : route.excluded_from_calculations ? 0.35 : isHovered || isAlt ? 1 : 0.85;
        const dashed = route.type !== "pipeline" || isDisrupted;

        return (
          <group key={id}>
            <Line
              ref={(l: unknown) => {
                lineRefs.current[id] = l as { material: { dashOffset: number; opacity: number } } | null;
              }}
              points={isDisrupted ? b.pointsLifted : b.points}
              color={color}
              lineWidth={width}
              transparent
              opacity={baseOpacity}
              dashed={dashed}
              dashSize={isDisrupted ? 0.045 : 0.06}
              gapSize={isDisrupted ? 0.03 : 0.04}
              depthWrite={false}
            />

            {/* invisible, fatter hit target: raycast picking for hover/click */}
            <mesh
              geometry={b.hitGeometry}
              visible={interactive}
              onPointerOver={(e) => {
                e.stopPropagation();
                if (frontFacing(e.point)) onHover(id, e.nativeEvent.clientX, e.nativeEvent.clientY);
              }}
              onPointerMove={(e) => {
                e.stopPropagation();
                if (frontFacing(e.point)) onHover(id, e.nativeEvent.clientX, e.nativeEvent.clientY);
                else onHover(null);
              }}
              onPointerOut={(e) => {
                e.stopPropagation();
                onHover(null);
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (frontFacing(e.point)) onSelect(route);
              }}
            >
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>

            {route.type === "chokepoint" && (
              <group
                ref={(g) => {
                  ringRefs.current[id] = g;
                }}
                position={b.mid}
                quaternion={b.midQuat}
              >
                {[0, 1].map((i) => (
                  <mesh key={i}>
                    <ringGeometry args={[0.045, 0.052, 48]} />
                    <meshBasicMaterial color={color} transparent opacity={0.4} depthWrite={false} />
                  </mesh>
                ))}
              </group>
            )}
          </group>
        );
      })}
    </group>
  );
}
