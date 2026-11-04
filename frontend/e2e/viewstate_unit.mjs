// Unit checks for the shared view state (URL parameters) and the 2D map geometry. Plain node, no browser:
//   node --experimental-strip-types e2e/viewstate_unit.mjs
import assert from "node:assert/strict";
import { DEFAULT_CAMERA, LAYER_IDS, defaultLayers, parseViewParams, writeViewParams } from "../src/lib/viewState.ts";
import { DETAIL_LEVELS, detailIndex, simplifyCountries, simplifyLine } from "../src/lib/mapSimplify.ts";
import { AFFECTED_ZONE_KM, graticule, pulsePhase, ringRadiusKm, splitAtAntimeridian, toLngLat } from "../src/lib/mapGeometry.ts";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("PASS ", name); };
const P = (q) => parseViewParams(new URLSearchParams(q));

// ---- parsing
t("no parameters: globe, default camera, default layers, nothing selected, no problems", () => {
  const v = P("");
  assert.equal(v.view, "globe"); assert.deepEqual(v.camera, DEFAULT_CAMERA); assert.equal(v.cameraFromUrl, false);
  assert.equal(v.layers, null); assert.equal(v.selected, null); assert.deepEqual(v.problems, []);
});
t("a complete, valid map URL is read exactly", () => {
  const v = P("view=map&lat=26.5&lon=56.25&zoom=5.5&layers=routes,chokepoints,watchlist&selected=hormuz");
  assert.equal(v.view, "map"); assert.deepEqual(v.camera, { lat: 26.5, lon: 56.25, zoom: 5.5 }); assert.equal(v.cameraFromUrl, true);
  assert.deepEqual(v.layers, ["routes", "chokepoints", "watchlist"]); assert.equal(v.selected, "hormuz"); assert.deepEqual(v.problems, []);
});
for (const bad of ["map2", "MAP", "", "globe;drop", "<script>"]) {
  t(`bad view=${JSON.stringify(bad)} falls back to the globe`, () => assert.equal(P("view=" + encodeURIComponent(bad)).view, "globe"));
}
for (const q of ["lat=abc&lon=10&zoom=3", "lat=95&lon=10&zoom=3", "lat=10&lon=181&zoom=3", "lat=10&lon=10&zoom=0.2", "lat=10&lon=10&zoom=99", "lat=NaN&lon=10&zoom=3", "lat=Infinity&lon=10&zoom=3"]) {
  t(`out-of-range or non-numeric camera (${q}) is ignored, default camera used`, () => {
    const v = P("view=map&" + q);
    assert.deepEqual(v.camera, DEFAULT_CAMERA); assert.equal(v.cameraFromUrl, false); assert.ok(v.problems.length > 0);
  });
}
t("a half-given camera is ignored", () => { const v = P("view=map&lat=10&lon=20"); assert.equal(v.cameraFromUrl, false); assert.deepEqual(v.camera, DEFAULT_CAMERA); });
t("unknown layers are dropped, valid ones kept, duplicates removed", () => {
  const v = P("layers=routes,bogus,routes,tankers,watchlist");
  assert.deepEqual(v.layers, ["routes", "watchlist"]); assert.ok(v.problems.some((p) => p.startsWith("layers=")));
});
t("a layers list with nothing valid means the defaults", () => assert.equal(P("layers=x,y").layers, null));
t("an empty layers value means the defaults", () => assert.equal(P("layers=").layers, null));
for (const bad of ["a b", "../etc", "x".repeat(81), "id;rm", "<b>", ""]) {
  t(`bad selected=${JSON.stringify(bad.slice(0, 12))} is ignored`, () => assert.equal(P("selected=" + encodeURIComponent(bad)).selected, null));
}
t("legal selected ids are kept (route and location ids)", () => {
  assert.equal(P("selected=suez").selected, "suez"); assert.equal(P("selected=chokepoint-hormuz").selected, "chokepoint-hormuz");
});
t("default layers: tankers are the saved watchlist when there is one, simulated otherwise, never both", () => {
  assert.deepEqual(defaultLayers(true), ["routes", "chokepoints", "watchlist", "scenario"]);
  assert.deepEqual(defaultLayers(false), ["routes", "chokepoints", "simulated", "scenario"]);
  for (const l of [...defaultLayers(true), ...defaultLayers(false)]) assert.ok(LAYER_IDS.includes(l));
});

// ---- writing
t("writing keeps unrelated parameters (the scenario ones) and sets the view", () => {
  const out = writeViewParams(new URLSearchParams("route=suez&detour=20&dur=60"), { view: "map", camera: { lat: 26.123456, lon: 56.987654, zoom: 4.56789 }, layers: ["routes", "simulated"], selected: "suez" });
  assert.equal(out.get("route"), "suez"); assert.equal(out.get("detour"), "20"); assert.equal(out.get("view"), "map");
  assert.equal(out.get("lat"), "26.123"); assert.equal(out.get("lon"), "56.988"); assert.equal(out.get("zoom"), "4.57");
  assert.equal(out.get("layers"), "routes,simulated"); assert.equal(out.get("selected"), "suez");
});
t("switching to the globe drops the camera and layers but keeps the selection", () => {
  const out = writeViewParams(new URLSearchParams("view=map&lat=1&lon=2&zoom=3&layers=routes&selected=suez"), { view: "globe", selected: "suez" });
  assert.equal(out.get("view"), "globe"); assert.equal(out.get("lat"), null); assert.equal(out.get("layers"), null); assert.equal(out.get("selected"), "suez");
});
t("clearing the selection removes the parameter", () => assert.equal(writeViewParams(new URLSearchParams("selected=suez"), { view: "map", selected: null }).get("selected"), null));
t("what is written is read back unchanged (round trip)", () => {
  const w = writeViewParams(new URLSearchParams(), { view: "map", camera: { lat: 12.6, lon: 43.3, zoom: 5 }, layers: ["routes", "chokepoints"], selected: "bab_el_mandeb" });
  const v = parseViewParams(w);
  assert.deepEqual([v.view, v.camera, v.layers, v.selected], ["map", { lat: 12.6, lon: 43.3, zoom: 5 }, ["routes", "chokepoints"], "bab_el_mandeb"]);
});

// ---- geometry
t("a line that never crosses the antimeridian is one piece, unchanged", () => {
  const line = [[10, 0], [20, 5], [30, 10]]; assert.deepEqual(splitAtAntimeridian(line), [line]);
});
t("a line crossing +180 eastward is cut exactly at the edge with interpolated latitude, no segment spans the map", () => {
  const parts = splitAtAntimeridian([[170, 10], [-170, 30]]);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts[0].at(-1), [180, 20]); assert.deepEqual(parts[1][0], [-180, 20]);
  for (const p of parts) for (let i = 1; i < p.length; i++) assert.ok(Math.abs(p[i][0] - p[i - 1][0]) <= 180);
});
t("a line crossing -180 westward is cut the other way", () => {
  const parts = splitAtAntimeridian([[-175, 0], [175, 10]]);
  assert.equal(parts.length, 2); assert.equal(parts[0].at(-1)[0], -180); assert.equal(parts[1][0][0], 180);
  assert.ok(Math.abs(parts[0].at(-1)[1] - 5) < 1e-9);
});
t("a long route crossing twice becomes three pieces, every segment shorter than half the map", () => {
  const parts = splitAtAntimeridian([[160, 0], [-170, 5], [-150, 5], [170, 8], [150, 8]]);
  assert.equal(parts.length, 3);
  for (const p of parts) for (let i = 1; i < p.length; i++) assert.ok(Math.abs(p[i][0] - p[i - 1][0]) <= 180);
});
t("degenerate input is safe", () => { assert.deepEqual(splitAtAntimeridian([]), []); assert.deepEqual(splitAtAntimeridian([[1, 2]]), [[[1, 2]]]); });
t("route data [lat, lng] becomes deck order [lng, lat]", () => assert.deepEqual(toLngLat([[26.7, 50.2], [12, 45]]), [[50.2, 26.7], [45, 12]]));
t("the pulse repeats and the ring grows with conflict intensity but stays bounded", () => {
  assert.ok(Math.abs(pulsePhase(0.6, 2.4) - pulsePhase(3.0, 2.4)) < 1e-9);
  assert.ok(ringRadiusKm(9, 1) > ringRadiusKm(2, 1)); assert.ok(ringRadiusKm(99, 1) === ringRadiusKm(10, 1)); assert.ok(ringRadiusKm(0, 0) > 0);
  assert.ok(AFFECTED_ZONE_KM > 0);
});
t("the graticule covers every 30 degrees", () => assert.equal(graticule(30).length, 13 + 5));

// ---- a bad layers value is removed from the address, not kept
t("layers=null (the defaults) removes a stale or invalid layers parameter; undefined leaves it alone", () => {
  const cur = new URLSearchParams("view=map&layers=bogus,evil&lat=1");
  assert.equal(writeViewParams(cur, { view: "map", layers: null }).get("layers"), null);
  assert.equal(writeViewParams(cur, { view: "map" }).get("layers"), "bogus,evil");
  assert.equal(writeViewParams(cur, { view: "map", layers: ["routes", "chokepoints"] }).get("layers"), "routes,chokepoints");
});

// ---- country outline detail levels
t("simplifyLine keeps the ends and every bump bigger than the tolerance, drops the rest", () => {
  const line = [[0, 0], [1, 0.001], [2, 0], [3, 1], [4, 0]];
  const out = simplifyLine(line, 0.01);
  assert.deepEqual(out[0], [0, 0]); assert.deepEqual(out[out.length - 1], [4, 0]);
  assert.ok(out.some((p) => p[0] === 3 && p[1] === 1), "the real corner stays");
  assert.ok(!out.some((p) => p[0] === 1), "the 0.001 wiggle goes");
  assert.deepEqual(simplifyLine(line, 0), line);
});
t("simplifyCountries drops specks, keeps big countries valid (closed rings of 4+ points), and a coarser level has fewer vertices", () => {
  const ring = (x, y, s, k = 40) => { const r = []; for (let i = 0; i < k; i++) r.push([x + s * Math.cos((i / k) * 6.2832), y + s * Math.sin((i / k) * 6.2832)]); r.push(r[0]); return r; };
  const fc = { type: "FeatureCollection", features: [
    { type: "Feature", properties: { n: "big" }, geometry: { type: "Polygon", coordinates: [ring(0, 0, 10)] } },
    { type: "Feature", properties: { n: "speck" }, geometry: { type: "Polygon", coordinates: [ring(50, 50, 0.01, 8)] } },
    { type: "Feature", properties: { n: "archipelago" }, geometry: { type: "MultiPolygon", coordinates: [[ring(80, 0, 5)], [ring(95, 0, 0.01, 8)]] } },
  ] };
  const coarse = simplifyCountries(fc, 0.5), fine = simplifyCountries(fc, 0.01);
  assert.deepEqual(coarse.features.map((f) => f.properties.n), ["big", "archipelago"]);
  assert.equal(coarse.features[1].geometry.coordinates.length, 1, "the speck island of the archipelago goes");
  const count = (c) => JSON.stringify(c.features.map((f) => f.geometry.coordinates)).split("],[").length;
  assert.ok(count(coarse) < count(fine));
  for (const f of coarse.features) for (const p of f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates) { assert.ok(p[0].length >= 4); assert.deepEqual(p[0][0], p[0][p[0].length - 1]); }
});
t("detail level follows the zoom in three steps", () => {
  assert.equal(DETAIL_LEVELS.length, 3);
  assert.deepEqual([1, 3.4, 3.5, 5.4, 5.5, 9].map(detailIndex), [0, 0, 1, 1, 2, 2]);
});

console.log(`\n${n} checks passed`);
