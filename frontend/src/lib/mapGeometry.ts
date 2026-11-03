// Geometry helpers for the 2D map. Pure functions (no imports) so they can be tested with plain node (e2e/viewstate_unit.mjs).
// Coordinates here are [lng, lat] (deck.gl order). Route data in the app is [lat, lng].

export type LngLat = [number, number];

export const toLngLat = (path: [number, number][]): LngLat[] => path.map(([lat, lng]) => [lng, lat]);

/** Split a line wherever it crosses the antimeridian, so Web Mercator never draws a line across the whole map.
 *  Each piece ends exactly on lng +-180 (latitude interpolated), and the next piece starts on the other edge. */
export function splitAtAntimeridian(coords: LngLat[]): LngLat[][] {
  if (coords.length < 2) return coords.length ? [coords] : [];
  const out: LngLat[][] = [];
  let cur: LngLat[] = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const [lng1, lat1] = coords[i - 1], [lng2, lat2] = coords[i];
    const dl = lng2 - lng1;
    if (Math.abs(dl) > 180) {                              // the short way round goes through +-180
      const east = dl < 0;                                // from e.g. 170 to -170: moving east across +180
      const edge1 = east ? 180 : -180, edge2 = -edge1;
      const unwrapped2 = east ? lng2 + 360 : lng2 - 360;
      const f = (edge1 - lng1) / (unwrapped2 - lng1);
      const latX = lat1 + (lat2 - lat1) * f;
      cur.push([edge1, latX]);
      out.push(cur);
      cur = [[edge2, latX]];
    }
    cur.push([lng2, lat2]);
  }
  out.push(cur);
  return out.filter((c) => c.length >= 2);
}

/** Pulsing ring: 0..1 phase repeating every `period` seconds. */
export const pulsePhase = (t: number, period = 2.4): number => (t % period) / period;

/** Ring radius in kilometres for a disrupted chokepoint: grows with the scenario's conflict intensity (0 to 10). */
export const ringRadiusKm = (conflictIntensity: number, phase: number): number => (60 + 45 * Math.max(0, Math.min(10, conflictIntensity))) * (0.55 + 0.45 * phase);

/** Affected-zone circle drawn around a disrupted route's midpoint. Illustrative: a fixed focus area, not a modelled extent. */
export const AFFECTED_ZONE_KM = 260;

/** Sea and ocean label positions [lng, lat]. Labels only; none of them carries data. */
export const SEA_LABELS: { name: string; lngLat: LngLat; minZoom: number }[] = [
  { name: "ARABIAN SEA", lngLat: [64, 15], minZoom: 2 }, { name: "PERSIAN GULF", lngLat: [51.5, 27.2], minZoom: 3.4 }, { name: "GULF OF OMAN", lngLat: [58.5, 24.6], minZoom: 3.6 },
  { name: "GULF OF ADEN", lngLat: [48, 12.2], minZoom: 3.6 }, { name: "RED SEA", lngLat: [38.6, 21], minZoom: 3 }, { name: "MEDITERRANEAN SEA", lngLat: [17, 34.6], minZoom: 2.6 },
  { name: "BLACK SEA", lngLat: [34.5, 43.3], minZoom: 3.4 }, { name: "BALTIC SEA", lngLat: [19.5, 58.5], minZoom: 3.6 }, { name: "NORTH SEA", lngLat: [3.5, 56], minZoom: 3.4 },
  { name: "INDIAN OCEAN", lngLat: [78, -12], minZoom: 1.6 }, { name: "ATLANTIC OCEAN", lngLat: [-30, 24], minZoom: 1.6 }, { name: "PACIFIC OCEAN", lngLat: [-150, 10], minZoom: 1.6 },
  { name: "SOUTH CHINA SEA", lngLat: [113, 13], minZoom: 3 }, { name: "BAY OF BENGAL", lngLat: [88, 14], minZoom: 3 }, { name: "GULF OF GUINEA", lngLat: [2, 2], minZoom: 3.4 },
  { name: "CARIBBEAN SEA", lngLat: [-76, 15], minZoom: 3 }, { name: "GULF OF MEXICO", lngLat: [-90, 25], minZoom: 3.2 },
];

/** Graticule: a meridian and a parallel every `step` degrees (subtle grid under the countries). */
export function graticule(step = 30): LngLat[][] {
  const lines: LngLat[][] = [];
  for (let lng = -180; lng <= 180; lng += step) lines.push([[lng, -80], [lng, 80]]);
  for (let lat = -60; lat <= 60; lat += step) lines.push([[-180, lat], [180, lat]]);
  return lines;
}
