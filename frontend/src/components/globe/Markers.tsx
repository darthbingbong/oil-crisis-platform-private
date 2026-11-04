import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Color, Vector3, type Group } from "three";
import { latLngToVector3 } from "../../lib/geo";
import type { Location } from "../../types";
import { EARTH_RADIUS } from "./Earth";

const CRUDE = "#e8871e";
const ION = "#35e0c9";
const FACING_THRESHOLD = 0.08;

interface Props {
  locations: Location[];
  hoveredId: string | null;
  focusedId: string | null;
  setHoveredId: Dispatch<SetStateAction<string | null>>;
  setFocusedId: Dispatch<SetStateAction<string | null>>;
  onActivate: (loc: Location) => void;
  /** false while the camera is traveling/showing detail/returning -- guards
   * against overlapping transitions (e.g. a rapid second click mid-flight). */
  interactive: boolean;
  reducedMotion?: boolean;
}

/** Idle pulse plus targeting: mouse hover and keyboard focus are tracked
 * separately (a clicked button stays focused in a real browser long after
 * the mouse moves away, so collapsing them into one signal would leave the
 * globe stuck paused) -- either one previews a marker (brighten, scale,
 * label). Click/Enter activates it (hands off to EarthGlobe's travel state
 * machine). Back-facing markers are excluded from both rendering and
 * hit-testing each frame so a marker hidden behind the globe can never be
 * "phantom hovered". */
export default function Markers({
  locations,
  hoveredId,
  focusedId,
  setHoveredId,
  setFocusedId,
  onActivate,
  interactive,
  reducedMotion = false,
}: Props) {
  const groupRef = useRef<Group>(null);
  const activeId = hoveredId ?? focusedId;

  const markers = useMemo(
    () =>
      locations.map((loc, i) => {
        const position = latLngToVector3(loc.lat, loc.lng, EARTH_RADIUS * 1.003);
        const baseColor = loc.accent === "crude" ? CRUDE : ION;
        return {
          loc,
          position,
          normal: position.clone().normalize(),
          phase: (i / Math.max(1, locations.length)) * Math.PI * 2,
          baseColor,
          brightColor: new Color(baseColor).lerp(new Color("#ffffff"), 0.55).getStyle(),
        };
      }),
    [locations]
  );

  const [facing, setFacing] = useState<boolean[]>(() => locations.map(() => true));
  const facingRef = useRef<boolean[]>(facing);
  const scratchCam = useRef(new Vector3());

  useFrame((state) => {
    const group = groupRef.current;
    if (!group) return;
    const t = state.clock.elapsedTime;

    state.camera.getWorldPosition(scratchCam.current);
    group.worldToLocal(scratchCam.current);
    scratchCam.current.normalize();

    let changed = false;
    const nextFacing = facingRef.current.slice();

    group.children.forEach((child, i) => {
      const m = markers[i];
      if (!m) return;

      const isActive = m.loc.id === activeId;
      const pulse = isActive
        ? 1.7
        : reducedMotion
          ? 0.85
          : 0.85 + Math.sin(t * 1.4 + m.phase) * 0.15 * (0.4 + m.loc.severity);
      child.scale.setScalar(pulse);

      const isFacing = m.normal.dot(scratchCam.current) > FACING_THRESHOLD;
      if (isFacing !== nextFacing[i]) {
        nextFacing[i] = isFacing;
        changed = true;
      }
    });

    if (changed) {
      facingRef.current = nextFacing;
      setFacing(nextFacing);
    }
  });

  return (
    <group ref={groupRef}>
      {markers.map(({ loc, position, baseColor, brightColor }, i) => {
        const isActive = loc.id === activeId;
        const isFacing = facing[i] ?? true;
        const dotColor = isActive ? brightColor : baseColor;
        const glowOpacity = isActive ? 0.5 : 0.18;
        const size = 0.012 + loc.severity * 0.02;
        const teaser = loc.metrics[0];
        const teaserColor = loc.accent === "crude" ? "var(--color-crude)" : "var(--color-ion)";

        return (
          <group key={loc.id} position={position}>
            <mesh
              visible={isFacing && interactive}
              onPointerOver={(e) => {
                e.stopPropagation();
                if (facingRef.current[i]) setHoveredId(loc.id);
              }}
              onPointerOut={(e) => {
                e.stopPropagation();
                setHoveredId((h) => (h === loc.id ? null : h));
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (!facingRef.current[i]) return;
                onActivate(loc);
              }}
            >
              <sphereGeometry args={[size * 4, 12, 12]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>

            <mesh>
              <sphereGeometry args={[size, 12, 12]} />
              <meshBasicMaterial color={dotColor} />
            </mesh>
            <mesh>
              <sphereGeometry args={[size * 2.4, 12, 12]} />
              <meshBasicMaterial color={dotColor} transparent opacity={glowOpacity} />
            </mesh>

            <Html center>
              <button
                type="button"
                aria-label={teaser ? `${loc.name}, ${teaser.label} ${teaser.value}` : loc.name}
                onMouseEnter={() => interactive && setHoveredId(loc.id)}
                onMouseLeave={() => setHoveredId((h) => (h === loc.id ? null : h))}
                onFocus={() => interactive && setFocusedId(loc.id)}
                onBlur={() => setFocusedId((f) => (f === loc.id ? null : f))}
                onClick={() => interactive && onActivate(loc)}
                tabIndex={interactive ? 0 : -1}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "9999px",
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  display: isFacing && interactive ? "block" : "none",
                  pointerEvents: "auto",
                }}
              />
              {isActive && isFacing && (
                <div
                  aria-hidden
                  data-testid="marker-tooltip"
                  style={{
                    position: "absolute",
                    left: "50%",
                    bottom: "20px",
                    transform: "translateX(-50%)",
                    whiteSpace: "nowrap",
                    pointerEvents: "none",
                    background: "rgba(3,3,3,0.85)",
                    border: "1px solid rgba(244,241,234,0.14)",
                    borderRadius: "6px",
                    padding: "6px 10px",
                  }}
                >
                  <div
                    style={{
                      fontFamily: "var(--font-body)",
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: "0.02em",
                      color: "var(--color-bone)",
                    }}
                  >
                    {loc.name}
                  </div>
                  {teaser && (
                    <div
                      className="data-readout"
                      style={{ fontSize: 11, color: teaserColor, marginTop: 2 }}
                    >
                      {teaser.label}: {teaser.value}
                    </div>
                  )}
                </div>
              )}
            </Html>
          </group>
        );
      })}
    </group>
  );
}
