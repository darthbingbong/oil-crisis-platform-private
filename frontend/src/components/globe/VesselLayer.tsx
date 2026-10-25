import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  type BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  type InstancedMesh,
  type LineSegments,
  type Mesh,
  Vector3,
} from "three";
import type { FillTarget, Scenario, VesselInfo, VesselSource, View } from "../../lib/vesselSim";
import { EARTH_RADIUS } from "./Earth";

const LIFT = 1.01;            // above the route lines (1.004), below a disrupted route (1.014)
const SIZE = 1;               // matrix scale; the cone itself is sized below
const PICK_PX = 12;
/** Vessels sit on the route lines, so a click near a lane is ambiguous. Zoomed in (camera closer than this) a click picks a vessel; at the default
 * view it picks the route as before. Shift-click picks a vessel at any zoom, Alt-click always goes to the route. */
const PICK_ZOOM_DISTANCE = 4.6;
const TICK_SECONDS = 0.25;    // how often the open vessel panel is refreshed
/** The simulation is stepped and the buffers refilled at this rate, not every frame: at ~6 px/s of motion a 20 Hz update is indistinguishable and
 * it is the single biggest CPU saving (measured; see the README performance note). */
const UPDATE_HZ = 20;
const HORIZON_MARGIN = 0.1;   // extra dot-product slack so vessels appear just before they cross the limb

interface Props {
  source: VesselSource;
  scenario: Scenario | null;
  paused: boolean;
  interactive: boolean;
  selected: number | null;
  onSelect: (index: number | null) => void;
  onTick: (info: VesselInfo | null) => void;
}

interface DebugApi {
  count: number;
  kind: string;
  /** screen position (px, relative to the canvas) of vessel i, or null when it is on the far side */
  project: (i: number) => { x: number; y: number } | null;
  /** vessel indices nearest to a lat/lng, with their screen positions */
  near: (lat: number, lng: number, n: number) => { i: number; x: number; y: number }[];
  select: (i: number | null) => void;
  info: (i: number) => VesselInfo;
  drawn: () => { instances: number; filled: number };
  ring: () => { visible: boolean; x: number; y: number; z: number; parentVisible?: boolean } | null;
}

/** All vessels (simulated or from AIS) drawn with ONE InstancedMesh plus ONE LineSegments for the short trails.
 * Click picking is done in screen space on the canvas (nearest vessel within PICK_PX), so a click near a vessel never falls through to the route under it. */
export default function VesselLayer({ source, scenario, paused, interactive, selected, onSelect, onTick }: Props) {
  const n = source.count;
  const meshRef = useRef<InstancedMesh>(null);
  const trailRef = useRef<LineSegments>(null);
  const ringRef = useRef<Mesh>(null);
  const { camera, gl, size } = useThree();
  const tick = useRef(0);
  const filled = useRef(false);
  const acc = useRef(0);
  const scratch = useMemo(() => new Vector3(), []);

  // One flat arrowhead (a single triangle, lying in the surface plane, tip along +Z = the heading): 2,000 vessels cost 2,000 triangles.
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute([0, 0, 0.0095, -0.0034, 0, -0.0032, 0.0034, 0, -0.0032], 3));
    g.computeBoundingSphere();
    return g;
  }, []);

  const target = useMemo<FillTarget>(
    () => ({
      matrix: new Float32Array(n * 16), color: new Float32Array(n * 3), trail: new Float32Array(n * 6), trailColor: new Float32Array(n * 6), pos: new Float32Array(n * 3), count: 0,
    }),
    [n]
  );
  const trailGeometry = useMemo(() => {
    const g = new BufferGeometry();
    const p = new Float32BufferAttribute(target.trail, 3), c = new Float32BufferAttribute(target.trailColor, 3);
    p.setUsage(DynamicDrawUsage); c.setUsage(DynamicDrawUsage);
    g.setAttribute("position", p); g.setAttribute("color", c);
    return g;
  }, [target]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.instanceColor = new InstancedBufferAttribute(target.color, 3);
    mesh.instanceColor.setUsage(DynamicDrawUsage);
    // use our buffer as the instance matrix store so fill() writes straight into the GPU-bound array
    (mesh.instanceMatrix as unknown as { array: Float32Array }).array = target.matrix;
    mesh.count = n;
    filled.current = false;
  }, [target, n]);

  useFrame((_, delta) => {
    const mesh = meshRef.current, trails = trailRef.current;
    if (!mesh || !trails || n === 0) return;
    acc.current += delta;
    if (acc.current >= 1 / UPDATE_HZ || !filled.current) {
      if (!paused) source.step(acc.current, scenario);
      acc.current = 0;
      if (!paused || !filled.current) {
        // camera direction in the globe's local frame, to skip vessels on the far side
        mesh.updateWorldMatrix(true, false);
        mesh.worldToLocal(scratch.copy(camera.position));
        const dist = scratch.length() || 1;
        const view: View = { cam: [scratch.x / dist, scratch.y / dist, scratch.z / dist], minDot: Math.min(0.97, (EARTH_RADIUS * LIFT) / dist) - HORIZON_MARGIN };
        source.fill(target, EARTH_RADIUS * LIFT, SIZE, view);
        filled.current = true;
        const c = target.count;
        mesh.count = c;
        mesh.instanceMatrix.clearUpdateRanges();
        mesh.instanceMatrix.addUpdateRange(0, c * 16);
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) {
          mesh.instanceColor.clearUpdateRanges();
          mesh.instanceColor.addUpdateRange(0, c * 3);
          mesh.instanceColor.needsUpdate = true;
        }
        trails.geometry.setDrawRange(0, c * 2);
        for (const a of [trails.geometry.attributes.position, trails.geometry.attributes.color] as BufferAttribute[]) {
          a.clearUpdateRanges();
          a.addUpdateRange(0, c * 6);
          a.needsUpdate = true;
        }
      }
    }
    const ring = ringRef.current;
    if (ring) {
      ring.visible = selected !== null && selected < n;
      if (ring.visible && selected !== null) {
        ring.position.set(target.pos[selected * 3], target.pos[selected * 3 + 1], target.pos[selected * 3 + 2]);
        ring.lookAt(0, 0, 0);                  // lie flat on the surface
      }
    }
    tick.current += delta;
    if (tick.current >= TICK_SECONDS) {
      tick.current = 0;
      onTick(selected !== null && selected < n ? source.info(selected) : null);
    }
  });

  // --- screen-space picking, registered in the capture phase so it runs before the globe's own click handlers
  const pickRef = useRef({ source, n, interactive, onSelect });
  useEffect(() => { pickRef.current = { source, n, interactive, onSelect }; });

  useEffect(() => {
    const el = gl.domElement;
    let down: { x: number; y: number } | null = null;
    const nearest = (cx: number, cy: number, limit: number) => {
      const mesh = meshRef.current;
      if (!mesh) return null;
      mesh.updateWorldMatrix(true, false);
      const rect = el.getBoundingClientRect(), v = new Vector3(), cam = camera.position.clone().normalize();
      let best = -1, bestD = limit;
      for (let i = 0; i < pickRef.current.n; i++) {
        v.set(target.pos[i * 3], target.pos[i * 3 + 1], target.pos[i * 3 + 2]).applyMatrix4(mesh.matrixWorld);
        if (v.clone().normalize().dot(cam) < 0.15) continue;           // far side of the globe
        v.project(camera);
        const d = Math.hypot(((v.x + 1) / 2) * rect.width + rect.left - cx, ((1 - v.y) / 2) * rect.height + rect.top - cy);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best >= 0 ? best : null;
    };
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onClick = (e: MouseEvent) => {
      if (!pickRef.current.interactive || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;   // a drag, not a click
      if (e.altKey || !(e.shiftKey || camera.position.length() <= PICK_ZOOM_DISTANCE)) return;                          // let the route handle it
      const hit = nearest(e.clientX, e.clientY, PICK_PX);
      if (hit !== null) {
        e.stopImmediatePropagation();
        e.preventDefault();
        pickRef.current.onSelect(hit);
      }
    };
    el.addEventListener("pointerdown", onDown, true);
    el.addEventListener("click", onClick, true);

    if (import.meta.env.DEV) {
      const api: DebugApi = {
        count: n,
        kind: source.kind,
        project(i) {
          const mesh = meshRef.current;
          if (!mesh) return null;
          mesh.updateWorldMatrix(true, false);
          const v = new Vector3(target.pos[i * 3], target.pos[i * 3 + 1], target.pos[i * 3 + 2]).applyMatrix4(mesh.matrixWorld);
          if (v.clone().normalize().dot(camera.position.clone().normalize()) < 0.15) return null;
          v.project(camera);
          return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height };
        },
        near(lat, lng, k) {
          const mesh = meshRef.current;
          if (!mesh) return [];
          const phi = (90 - lat) * (Math.PI / 180), theta = (lng + 180) * (Math.PI / 180);
          const ref = new Vector3(-Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
          const scored: { i: number; d: number }[] = [];
          for (let i = 0; i < n; i++) scored.push({ i, d: ref.distanceToSquared(new Vector3(target.pos[i * 3], target.pos[i * 3 + 1], target.pos[i * 3 + 2]).normalize()) });
          scored.sort((a, b) => a.d - b.d);
          return scored.slice(0, k).map(({ i }) => ({ i, ...(api.project(i) ?? { x: -1, y: -1 }) }));
        },
        select: (i) => pickRef.current.onSelect(i),
        info: (i) => pickRef.current.source.info(i),
        drawn: () => ({ instances: meshRef.current?.count ?? 0, filled: target.count }),
        ring: () => { const r = ringRef.current; return r ? { visible: r.visible, x: r.position.x, y: r.position.y, z: r.position.z, parentVisible: r.parent?.visible } : null; },
      };
      (window as unknown as { __vessels?: DebugApi }).__vessels = api;
    }
    return () => {
      el.removeEventListener("pointerdown", onDown, true);
      el.removeEventListener("click", onClick, true);
      if (import.meta.env.DEV) delete (window as unknown as { __vessels?: DebugApi }).__vessels;
    };
  }, [gl, camera, size, target, n, source]);

  return (
    <group>
      <instancedMesh key={n} ref={meshRef} args={[geometry, undefined, n]} frustumCulled={false}>
        <meshBasicMaterial toneMapped={false} side={DoubleSide} />
      </instancedMesh>
      <lineSegments ref={trailRef} geometry={trailGeometry} frustumCulled={false}>
        <lineBasicMaterial vertexColors transparent blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
      </lineSegments>
      <mesh ref={ringRef} visible={false}>
        <ringGeometry args={[0.03, 0.038, 32]} />
        <meshBasicMaterial color="#f4f1ea" transparent opacity={0.95} depthWrite={false} toneMapped={false} side={DoubleSide} />
      </mesh>
    </group>
  );
}
