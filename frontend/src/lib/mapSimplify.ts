// Country outlines at three levels of detail. The bundled Natural Earth file has about 100,000 vertices; drawing all of them on every frame is what made the
// 2D map crawl on software rendering (1.7 frames a second). A far-out view cannot show a 1 km coastline wiggle, so it draws a simplified copy instead.
// The simplification is Douglas-Peucker: a vertex is dropped only if the line stays within `tolerance` degrees of where it was.

type Pt = number[];
type FeatureCollection = { type: "FeatureCollection"; features: { type: "Feature"; properties?: unknown; geometry: { type: string; coordinates: unknown } }[] };

/** Keeps the first and last point and every point that sticks out more than `tol` from the straight line between its neighbours (iterative; no recursion limit). */
export function simplifyLine(pts: Pt[], tol: number): Pt[] {
  const n = pts.length;
  if (n <= 2 || tol <= 0) return pts;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let worst = -1, at = -1;
    for (let i = a + 1; i < b; i++) {
      let d2: number;
      if (len2 === 0) d2 = (pts[i][0] - ax) ** 2 + (pts[i][1] - ay) ** 2;
      else {
        const t = Math.max(0, Math.min(1, ((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / len2));
        d2 = (pts[i][0] - (ax + t * dx)) ** 2 + (pts[i][1] - (ay + t * dy)) ** 2;
      }
      if (d2 > worst) { worst = d2; at = i; }
    }
    if (worst > tol2 && at > 0) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return pts.filter((_, i) => keep[i] === 1);
}

function ringArea(r: Pt[]): number {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return Math.abs(s / 2);
}

/** A polygon ring needs 4 points (closed); a ring that collapses, or is smaller than a speck at this detail, is dropped. */
function simplifyRing(r: Pt[], tol: number): Pt[] | null {
  const s = simplifyLine(r, tol);
  return s.length >= 4 && ringArea(s) > tol * tol * 4 ? s : null;
}

function simplifyPolygon(rings: Pt[][], tol: number): Pt[][] | null {
  const outer = simplifyRing(rings[0], tol);
  if (!outer) return null;
  return [outer, ...rings.slice(1).map((r) => simplifyRing(r, tol)).filter((r): r is Pt[] => r !== null)];
}

export function simplifyCountries(fc: object, tol: number): object {
  const src = fc as FeatureCollection;
  const features = src.features.flatMap((f) => {
    const g = f.geometry;
    if (g.type === "Polygon") {
      const p = simplifyPolygon(g.coordinates as Pt[][], tol);
      return p ? [{ ...f, geometry: { type: "Polygon", coordinates: p } }] : [];
    }
    if (g.type === "MultiPolygon") {
      const ps = (g.coordinates as Pt[][][]).map((p) => simplifyPolygon(p, tol)).filter((p): p is Pt[][] => p !== null);
      return ps.length ? [{ ...f, geometry: { type: "MultiPolygon", coordinates: ps } }] : [];
    }
    return [f];
  });
  return { ...src, features };
}

export function countVertices(fc: object): number {
  let n = 0;
  const walk = (c: unknown): void => { if (Array.isArray(c) && typeof c[0] === "number") n++; else if (Array.isArray(c)) c.forEach(walk); };
  (fc as FeatureCollection).features.forEach((f) => walk(f.geometry.coordinates));
  return n;
}

/** Detail by zoom. Thresholds are in map zoom units (the world is 1 to 9); a level changes the data object only when a threshold is crossed. */
export const DETAIL_LEVELS: { maxZoom: number; tolerance: number }[] = [
  { maxZoom: 3.5, tolerance: 0.2 },
  { maxZoom: 5.5, tolerance: 0.05 },
  { maxZoom: 99, tolerance: 0.01 },
];
export const detailIndex = (zoom: number): number => Math.max(0, DETAIL_LEVELS.findIndex((l) => zoom < l.maxZoom));
