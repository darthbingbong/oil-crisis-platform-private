import { Html, Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import { Vector3, type Group } from "three";
import { latLngToVector3 } from "../../lib/geo";
import type { WatchVessel } from "../../types";
import { EARTH_RADIUS } from "./Earth";

const TEAL = "#59e0c9";
const LIFT = 1.006;               // above the route lines (1.004)
const FACING = 0.1;

interface Props {
  vessels: WatchVessel[];
  selectedMmsi: number | null;
  /** the saved past track of the selected vessel, [lng, lat] points in time order */
  track: [number, number][] | null;
  interactive: boolean;
  onSelect: (v: WatchVessel) => void;
  /** the globe stops turning while a dot is under the pointer, so it cannot slide away from it */
  onHover?: (mmsi: number | null) => void;
}

/** The saved real tankers on the globe: a teal dot each (the same colour as the 2D map), click to open the shared vessel panel, and the saved past track of the selected
 *  one drawn on the surface. Dots on the far side of the globe are hidden and cannot be hit. Every one of them is a SNAPSHOT: nothing here moves. */
export default function WatchLayer({ vessels, selectedMmsi, track, interactive, onSelect, onHover }: Props) {
  const groupRef = useRef<Group>(null);
  const scratch = useRef(new Vector3());
  const [hover, setHover] = useState<number | null>(null);
  const items = useMemo(() => vessels.map((v) => ({ v, pos: latLngToVector3(v.lat, v.lng, EARTH_RADIUS * LIFT) })), [vessels]);
  const normals = useMemo(() => items.map((it) => it.pos.clone().normalize()), [items]);
  const trackPoints = useMemo(() => (track && track.length > 1 ? track.map(([lng, lat]) => latLngToVector3(lat, lng, EARTH_RADIUS * LIFT)) : null), [track]);

  useFrame((state) => {
    const g = groupRef.current;
    if (!g) return;
    state.camera.getWorldPosition(scratch.current);
    g.worldToLocal(scratch.current);
    scratch.current.normalize();
    g.children.forEach((child, i) => { if (normals[i]) child.visible = normals[i].dot(scratch.current) > FACING; });
  });

  const hovered = hover !== null ? items.find((it) => it.v.mmsi === hover) : null;
  return (
    <group>
      <group ref={groupRef}>
        {items.map(({ v, pos }) => {
          const sel = v.mmsi === selectedMmsi;
          return (
            <group key={v.mmsi} position={pos}>
              <mesh
                onPointerOver={(e) => { e.stopPropagation(); if (interactive) { setHover(v.mmsi); onHover?.(v.mmsi); } }}
                onPointerOut={(e) => { e.stopPropagation(); setHover((h) => (h === v.mmsi ? null : h)); onHover?.(null); }}
                onClick={(e) => { e.stopPropagation(); if (interactive) onSelect(v); }}
              >
                <sphereGeometry args={[0.022, 10, 10]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
              <mesh>
                <sphereGeometry args={[sel ? 0.011 : 0.007, 12, 12]} />
                <meshBasicMaterial color={TEAL} />
              </mesh>
              <mesh>
                <sphereGeometry args={[sel ? 0.026 : 0.017, 12, 12]} />
                <meshBasicMaterial color={TEAL} transparent opacity={sel ? 0.32 : 0.18} depthWrite={false} />
              </mesh>
            </group>
          );
        })}
      </group>
      {trackPoints && <Line points={trackPoints} color={TEAL} lineWidth={2.2} transparent opacity={0.95} />}
      {hovered && interactive && (
        <group position={hovered.pos}>
          <Html center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
            <div data-testid="globe-watch-tooltip" style={{ transform: "translateY(-26px)", whiteSpace: "nowrap", background: "rgba(3,3,3,0.9)", border: "1px solid rgba(89,224,201,0.4)", borderRadius: 6, padding: "5px 9px" }}>
              <div className="section-label" style={{ color: TEAL }}>SNAPSHOT · REAL VESSEL</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-bone)" }}>{hovered.v.name ?? `MMSI ${hovered.v.mmsi}`}</div>
              <div className="data-readout" style={{ fontSize: 10, color: "var(--color-ash)" }}>{hovered.v.nav_status} · {hovered.v.area}</div>
            </div>
          </Html>
        </group>
      )}
    </group>
  );
}
