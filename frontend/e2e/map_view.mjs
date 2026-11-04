// M11 end-to-end: the GLOBE | MAP switch and the 2D map, in a real browser.   SHOT_DIR=<dir> node e2e/map_view.mjs
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = process.env.SHOT_DIR;
const BASE = "http://localhost:5173";
const exe = path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe");
const browser = await chromium.launch({ executablePath: exe, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"] });
const logs = [];
let failures = 0;
const check = (name, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${name} ${extra}`); };
async function newPage(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  return page;
}
const page = await newPage(1440, 900);
const shot = async (p, name) => { await p.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log("      saved", name); };
const url = (p) => p.url().replace(BASE, "");
const params = (p) => new URL(p.url()).searchParams;
// A person moves to something, rests on it, then presses for a few tens of ms. deck.gl recognises a click from exactly that, so the test does the same.
async function mapClick(p, x, y) { await p.mouse.move(x - 3, y - 3); await p.mouse.move(x, y, { steps: 3 }); await p.waitForTimeout(350); await p.mouse.click(x, y, { delay: 90 }); }
const isMap = (p) => p.locator('[data-testid="map-view"]').count().then((n) => n > 0);
const pressed = (p, v) => p.locator(`[data-testid="view-${v}"]`).getAttribute("aria-pressed");
const bodyText = (p) => p.locator("body").innerText();
async function openMap(p, q) { await p.goto(`${BASE}/?${q}`, { waitUntil: "load" }); await p.waitForSelector('[data-testid="map-view"]', { timeout: 60000 }); await p.waitForFunction(() => window.__map?.simCount?.() > 0, null, { timeout: 60000 }); await p.waitForTimeout(1500); }
async function openGlobe(p, q) { await p.goto(`${BASE}/?${q}`, { waitUntil: "load" }); await p.waitForSelector('[data-testid="route-keyboard-list"]', { timeout: 60000, state: "attached" }); await p.waitForTimeout(1200); }
async function keyboardOpenRoute(p, name) {
  await p.mouse.click(5, 5);
  let inList = false;
  for (let i = 0; i < 80 && !inList; i++) { await p.keyboard.press("Tab"); inList = await p.evaluate(() => !!document.activeElement?.closest('[data-testid="route-keyboard-list"]')); }
  for (let i = 0; i < 20 && !(await p.evaluate((n) => (document.activeElement?.textContent ?? "").includes(n), name)); i++) await p.keyboard.press("Tab");
  await p.keyboard.press("Enter");
}

// ------------------------------------------------------------------ 1. default view and the switch
console.log("--- 1. the switch");
await openGlobe(page, "");
check("the dashboard still opens on the globe", (await pressed(page, "globe")) === "true" && !(await isMap(page)));
check("a 3D canvas is on screen", (await page.locator("canvas").count()) >= 1);
await page.locator('[data-testid="view-map"]').click();
await page.waitForSelector('[data-testid="map-view"]', { timeout: 60000 });
await page.waitForFunction(() => window.__map?.simCount?.() > 0, null, { timeout: 60000 });
await page.waitForTimeout(2500);
check("MAP switch shows the 2D map", (await isMap(page)) && (await pressed(page, "map")) === "true");
check("URL says view=map with a camera", params(page).get("view") === "map" && params(page).has("lat") && params(page).has("zoom"), `(${url(page)})`);
check("default layers: routes, chokepoints, real watchlist, scenario (simulated off while a snapshot exists)",
  JSON.stringify(await page.evaluate(() => window.__map.layers())) === JSON.stringify(["routes", "chokepoints", "watchlist", "scenario"]));
check("the real-tanker badge says SNAPSHOT with its time and that it is not chokepoint traffic", /SNAPSHOT 20\d\d-\d\d-\d\d \d\d:\d\d UTC/.test(await page.locator('[data-testid="watch-badge"]').innerText()) && /Not chokepoint traffic/.test(await page.locator('[data-testid="watch-badge"]').innerText()));
check("layers panel lists counts and chips", (await page.locator('[data-testid="layer-count-routes"]').innerText()) === "14" && /SNAPSHOT/.test(await page.locator('[data-testid="layer-chip-watchlist"]').innerText()) && (await page.locator('[data-testid="layer-chip-simulated"]').innerText()) === "SIMULATED");
await shot(page, "map_01_default_laptop");

// ------------------------------------------------------------------ 2. selection survives the switch, both ways
console.log("\n--- 2. selection is shared");
await keyboardOpenRoute(page, "Suez");
await page.waitForSelector('[data-testid="route-panel"]', { timeout: 15000 });
await page.waitForTimeout(2000);
const mapPanel = (await page.locator('[data-testid="route-panel"]').innerText()).replace(/\s+/g, " ");
check("map: Tab + Enter on the Suez button opens the same route panel as the globe", /Suez/.test(mapPanel) && mapPanel.includes("8.8 Mb/d"));
check("map: URL carries selected=suez", params(page).get("selected") === "suez", `(${url(page)})`);
await shot(page, "map_02_route_selected_laptop");
await page.locator('[data-testid="view-globe"]').click();
await page.waitForSelector('[data-testid="route-panel"]', { timeout: 30000 });
await page.waitForTimeout(2500);
const globePanel = (await page.locator('[data-testid="route-panel"]').innerText()).replace(/\s+/g, " ");
check("switch to globe: the same route panel is open (selection kept)", !(await isMap(page)) && /Suez/.test(globePanel) && globePanel.includes("8.8 Mb/d"));
check("globe URL: view=globe, selection kept, no map camera or layers", params(page).get("view") === "globe" && params(page).get("selected") === "suez" && !params(page).has("lat") && !params(page).has("layers"), `(${url(page)})`);
await shot(page, "globe_02_route_selected_laptop");
await page.locator('[data-testid="view-map"]').click();
await page.waitForSelector('[data-testid="route-panel"]', { timeout: 30000 });
await page.waitForTimeout(1500);
check("switch back to the map: the route panel is still there", (await isMap(page)) && /Suez/.test(await page.locator('[data-testid="route-panel"]').innerText()));
await page.goto(page.url(), { waitUntil: "load" });
await page.waitForSelector('[data-testid="route-panel"]', { timeout: 60000 });
check("a reload of that URL restores the same view and selection (shareable)", (await isMap(page)) && /Suez/.test(await page.locator('[data-testid="route-panel"]').innerText()));

// ------------------------------------------------------------------ 3. scenario on the map: simulate, overlay, rerouting simulated traffic
console.log("\n--- 3. 'Simulate on this route' and the scenario overlay");
await page.locator('[data-testid="route-panel"] button:has-text("detour")').click();
await page.locator('[data-testid="simulate-on-route"]').click();
await page.waitForSelector('[data-testid="route-scenario"]', { timeout: 20000 });
await page.waitForTimeout(2500);
check("the same 'Simulate' action works on the map: the scenario panel shows Suez", /Suez/.test(await page.locator('[data-testid="route-scenario"]').innerText()));
check("the route panel closed and the selection cleared in the URL", (await page.locator('[data-testid="route-panel"]').count()) === 0 && !params(page).has("selected"));
check("layers panel: scenario overlay ACTIVE for Suez", /ACTIVE/.test(await page.locator('[data-testid="layer-chip-scenario"]').innerText()) && (await page.locator('[data-testid="layer-count-scenario"]').innerText()) === "1");
await page.locator('[data-testid="layer-toggle-simulated"]').check();
await page.waitForTimeout(4500);
check("simulated layer on: the SIMULATED VESSELS badge shows and the real-tanker badge still says SNAPSHOT", /SIMULATED VESSELS/.test(await page.locator('[data-testid="vessel-badge"]').innerText()) && (await page.locator('[data-testid="watch-badge"]').count()) === 1);
const rer = await page.evaluate(() => window.__map.rerouted());
check("simulated vessels on the Suez lane have been rerouted onto the alternate lane", rer >= 0, `(first rerouted index ${rer})`);
await page.evaluate(([lat, lng]) => window.__map.flyTo(lat, lng, 3.6), [8, 40]);
await page.waitForTimeout(1500);
await shot(page, "map_03_scenario_overlay_simulated_traffic");
await page.evaluate((i) => window.__map.selectSim(i), rer);
await page.waitForTimeout(500);
const vp = await page.locator('[data-testid="vessel-panel"]').innerText();
check("simulated vessel panel is labelled and says cargo is not confirmed", /SIMULATED VESSEL/.test(vp) && /MMSI\s*simulated/i.test(vp.replace(/\s+/g, " ")) && /cargo type not confirmed by AIS/.test(vp));
await page.locator('[data-testid="vessel-panel-close"]').click();

// the scenario belongs to the dashboard, not to either view: it must survive the switch both ways
await page.locator('[data-testid="view-globe"]').click();
await page.waitForSelector('[data-testid="route-scenario"]', { timeout: 30000 });
await page.waitForTimeout(2000);
check("Globe/Map switch keeps the scenario: the globe view still shows the Suez scenario panel", !(await isMap(page)) && /Suez/.test(await page.locator('[data-testid="route-scenario"]').innerText()));
await shot(page, "globe_03_scenario_kept_after_switch");
await page.locator('[data-testid="view-map"]').click();
await page.waitForSelector('[data-testid="map-view"]', { timeout: 60000 });
await page.waitForFunction(() => window.__map?.simCount?.() > 0, null, { timeout: 60000 });
await page.waitForTimeout(1500);
check("...and back on the map the scenario overlay is still ACTIVE for Suez", /Suez/.test(await page.locator('[data-testid="route-scenario"]').innerText()) && /ACTIVE/.test(await page.locator('[data-testid="layer-chip-scenario"]').innerText()));

// ------------------------------------------------------------------ 4. hover and click: routes, chokepoints, real vessels
console.log("\n--- 4. hover and click");
const routes = await page.evaluate(() => fetch("/api/v1/routes").then((r) => r.json()));
const suez = routes.routes.find((r) => r.id === "suez");
const [slat, slng] = suez.path[1];
await page.evaluate(([a, b]) => window.__map.flyTo(a, b, 4.5), [slat, slng]);
await page.waitForTimeout(1200);
const sp = await page.evaluate(([a, b]) => window.__map.project(a, b), [slat, slng]);
const box = await page.locator('[data-testid="map-view"]').boundingBox();
await page.mouse.move(box.x + sp.x + 2, box.y + sp.y + 2);
await page.mouse.move(box.x + sp.x, box.y + sp.y);
await page.waitForTimeout(500);
const tip = await page.locator('[data-testid="route-tooltip"]').innerText().catch(() => "");
check("hovering a route shows its name, type and sourced flow", /Suez/.test(tip) && /flow 8\.8 Mb\/d/.test(tip), `(${tip.replace(/\s+/g, " ").slice(0, 80)})`);
await page.mouse.move(box.x + 20, box.y + box.height - 60);
await page.evaluate(() => window.__map.flyTo(26.57, 56.25, 5.5));
await page.waitForTimeout(1200);
const hp = await page.evaluate(() => window.__map.project(26.57, 56.25));
await mapClick(page, box.x + hp.x, box.y + hp.y);
await page.waitForSelector('[data-testid="location-detail"]', { timeout: 10000 }).catch(() => undefined);
await page.waitForTimeout(800);
check("clicking the Hormuz chokepoint opens the same location detail as the globe", /Hormuz/.test(await page.locator('[data-testid="location-detail"]').innerText().catch(() => "")));
await shot(page, "map_05_chokepoint_detail_hormuz");
await page.keyboard.press("Escape");
await page.evaluate(() => { const b = document.querySelector('[data-testid="location-detail"] button'); b?.click(); });
await page.waitForTimeout(500);
const wl = await page.evaluate(() => fetch("/api/v1/vessels/watchlist").then((r) => r.json()));
const v0 = wl.vessels.find((v) => v.name === "OIZMENDI") ?? wl.vessels[0];
await page.evaluate(([a, b]) => window.__map.flyTo(a, b, 12), [v0.lat, v0.lng]);
await page.waitForTimeout(1500);
const vpos = await page.evaluate(([a, b]) => window.__map.project(a, b), [v0.lat, v0.lng]);
await page.mouse.move(box.x + vpos.x, box.y + vpos.y);
await page.waitForTimeout(400);
const vtip = await page.locator('[data-testid="route-tooltip"]').innerText().catch(() => "");
check("hovering a real tanker shows SNAPSHOT and its AIS status", /SNAPSHOT/.test(vtip) && vtip.includes(v0.name), `(${vtip.replace(/\s+/g, " ").slice(0, 70)})`);
await mapClick(page, box.x + vpos.x, box.y + vpos.y);
await page.waitForSelector('[data-testid="watch-vessel-panel"]', { timeout: 10000 }).catch(() => undefined);
const wp = (await page.locator('[data-testid="watch-vessel-panel"]').innerText().catch(() => "")).replace(/\s+/g, " ");
check("clicking a real tanker opens its panel: SNAPSHOT with a time, last seen N ago, flag, MMSI", /SNAPSHOT 20\d\d-\d\d-\d\d \d\d:\d\d UTC/.test(wp) && /Last seen .* ago/i.test(wp) && wp.includes(String(v0.mmsi)) && /Flag/i.test(wp), `(${wp.slice(0, 90)})`);
check("that panel never says what the vessel carries", /cargo type not confirmed by AIS/.test(wp) && !/crude carrier|sanction|dark fleet/i.test(wp));
check("that panel says it is a saved position and where it is", /saved position/.test(wp) && /Huelva/.test(wp));
await shot(page, "map_04_real_tanker_panel");
await page.locator('[data-testid="watch-vessel-close"]').click();

// ------------------------------------------------------------------ 4b. both real-tanker groups, each with its SNAPSHOT label and seen-at time
console.log("\n--- 4b. the two real-tanker groups");
const labels = await page.evaluate(() => window.__map.watchLabels());
check("two group labels: Huelva and Malacca, each SNAPSHOT with a seen-at time in UTC", labels.length === 2 && labels.some((l) => /Huelva/.test(l)) && labels.some((l) => /Malacca/.test(l)) && labels.every((l) => /^SNAPSHOT · .* · seen \d\d:\d\d( to \d\d:\d\d)? UTC · \d+ tankers$/.test(l)), `(${labels.join(" | ")})`);
check("the Malacca label shows a time RANGE (its seed was confirmed at 16:13, the rest come from the 16:28 sample), not one time that hides that", /Malacca.* seen 16:13 to 16:28 UTC/.test(labels.join(" | ")));
const wl2 = await page.evaluate(() => fetch("/api/v1/vessels/watchlist").then((r) => r.json()));
for (const [tag, area, wantSource] of [["huelva", /Huelva/, /Vessel Position/], ["malacca", /Malacca/, /Vessels Nearby sample only/]]) {
  const grp = wl2.vessels.filter((v) => area.test(v.area));
  const pick = tag === "malacca" ? grp.find((v) => v.position_confirmed_by === "Vessels Nearby sample only") : grp[0];
  await page.evaluate(([a, b]) => window.__map.flyTo(a, b, 9.5), [pick.lat, pick.lng]);
  await page.waitForTimeout(1800);
  const pp = await page.evaluate(([a, b]) => window.__map.project(a, b), [pick.lat, pick.lng]);
  await page.mouse.move(box.x + pp.x - 3, box.y + pp.y - 3); await page.mouse.move(box.x + pp.x, box.y + pp.y, { steps: 3 }); await page.waitForTimeout(500);
  const tt = (await page.locator('[data-testid="route-tooltip"]').innerText().catch(() => "")).replace(/\s+/g, " ");
  check(`${tag}: hovering the tankers at ${pick.name}'s position shows a real vessel with SNAPSHOT and its area`, /SNAPSHOT/.test(tt) && area.test(tt), `(${tt.slice(0, 80)})`);
  await mapClick(page, box.x + pp.x, box.y + pp.y);
  await page.waitForSelector('[data-testid="watch-vessel-panel"]', { timeout: 10000 }).catch(() => undefined);
  const pt = (await page.locator('[data-testid="watch-vessel-panel"]').innerText().catch(() => "")).replace(/\s+/g, " ");
  check(`${tag}: its panel says SNAPSHOT with a time, the area, how the position was confirmed, and that cargo is unconfirmed`, /SNAPSHOT 20\d\d-\d\d-\d\d \d\d:\d\d UTC/.test(pt) && area.test(pt) && wantSource.test(pt) && /cargo type not confirmed by AIS/.test(pt), `(${pt.slice(0, 60)})`);
  await shot(page, `map_0${tag === "huelva" ? 6 : 7}_${tag}_group`);
  await page.locator('[data-testid="watch-vessel-close"]').click();
}
await page.evaluate(() => window.__map.flyTo(22, 22, 2));
await page.waitForTimeout(1200);

// ------------------------------------------------------------------ 5. layer toggles, reset, zoom, URL state
console.log("\n--- 5. layers, reset view, URL state");
await page.locator('[data-testid="layer-toggle-routes"]').uncheck();
await page.waitForTimeout(400);
check("unchecking routes removes them and records it in the URL", !(await page.evaluate(() => window.__map.layers())).includes("routes") && !params(page).get("layers").includes("routes"), `(layers=${params(page).get("layers")})`);
await page.locator('[data-testid="layer-toggle-routes"]').check();
await page.locator('[data-testid="map-reset-view"]').click();
await page.waitForTimeout(1500);
check("Reset view returns to the default zoom", Math.abs((await page.evaluate(() => window.__map.zoom())) - 2) < 0.05);
await page.locator('[data-testid="map-zoom-in"]').click();
await page.waitForTimeout(600);
check("the + button zooms in", (await page.evaluate(() => window.__map.zoom())) > 2.5);
await page.locator('[data-testid="layers-collapse"]').click();
check("the layers panel collapses", (await page.locator('[data-testid="layer-toggle-routes"]').count()) === 0);
await page.locator('[data-testid="layers-collapse"]').click();

await openMap(page, "view=map&lat=26.5&lon=56.25&zoom=6&layers=routes,chokepoints&selected=chokepoint-hormuz");
check("a shared URL is honoured: zoom, layers and selection", Math.abs((await page.evaluate(() => window.__map.zoom())) - 6) < 0.1 && JSON.stringify(await page.evaluate(() => window.__map.layers())) === JSON.stringify(["routes", "chokepoints"]) && /Hormuz/.test(await page.locator('[data-testid="location-detail"]').innerText().catch(() => "")));
const bad = await newPage(1280, 800);
await openMap(bad, "view=map&lat=999&lon=abc&zoom=-4&layers=bogus,evil&selected=%3Cscript%3E");
check("a bad URL falls back to the defaults, without an error on screen", Math.abs((await bad.evaluate(() => window.__map.zoom())) - 2) < 0.1 && (await bad.evaluate(() => window.__map.layers())).includes("routes") && (await bad.locator('[data-testid="route-panel"]').count()) === 0 && !/error/i.test((await bodyText(bad)).slice(0, 4000)));
check("...and the address is tidied to valid values", !/999|abc|evil|script/.test(url(bad)), `(${url(bad)})`);
await bad.close();

// ------------------------------------------------------------------ 6. what must not be there
console.log("\n--- 6. what must not be there");
await openMap(page, "view=map");
const mapBody = await bodyText(page);
check("no historical events chart on the map view", !/HISTORICAL EVENTS|SUPPLY LOSS VS CONFLICT|24 events/i.test(mapBody));
await openGlobe(page, "view=globe");
const globeBody = await bodyText(page);
check("no historical events chart on the globe view either", !/HISTORICAL EVENTS|SUPPLY LOSS VS CONFLICT|24 events/i.test(globeBody));
check("no area counts or 'tankers within R nm of this chokepoint' claims on either view", !/tankers within \d+ ?nm|vessels in this area|chokepoint coverage:/i.test(mapBody + globeBody));

// ------------------------------------------------------------------ 7. tablet width, both views, same route
console.log("\n--- 7. tablet width (820 x 1180)");
const tab = await newPage(820, 1180);
await openMap(tab, "view=map&selected=suez");
await tab.waitForTimeout(2500);
check("tablet map: no horizontal overflow", (await tab.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)));
check("tablet map: layers panel starts collapsed, route panel open", (await tab.locator('[data-testid="layer-toggle-routes"]').count()) === 0 && /Suez/.test(await tab.locator('[data-testid="route-panel"]').innerText()));
await shot(tab, "map_02_route_selected_tablet");
await tab.goto(`${BASE}/?view=globe&selected=suez`, { waitUntil: "load" });      // with a route selected the globe is in its detail view, so its keyboard list is not there
await tab.waitForSelector('[data-testid="route-panel"]', { timeout: 60000 });
await tab.waitForTimeout(2500);
check("tablet globe: same route open, no horizontal overflow", /Suez/.test(await tab.locator('[data-testid="route-panel"]').innerText()) && (await tab.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)));
await shot(tab, "globe_02_route_selected_tablet");
await tab.close();


// ------------------------------------------------------------------ 8. frame rate with every layer on (software rendering: a lower bound, not a real GPU)
console.log("\n--- 8. frame rate, all layers on, 2,000 simulated vessels moving");
await page.goto("about:blank");      // the first page keeps drawing its own simulated vessels; two pages would share one software renderer and halve each other
const fpsLines = [];
for (const z of [2, 5.5]) {
  const f = await newPage(1440, 900);
  await openMap(f, `view=map&lat=26.57&lon=56.25&zoom=${z}&layers=routes,chokepoints,places,watchlist,simulated,scenario`);
  await f.waitForTimeout(3000);
  const r = await f.evaluate(() => new Promise((res) => { let n = 0, worst = 0, last = performance.now(); const t0 = last; const tick = (now) => { n++; worst = Math.max(worst, now - last); last = now; if (now - t0 < 5000) requestAnimationFrame(tick); else res({ fps: n / ((now - t0) / 1000), worst }); }; requestAnimationFrame(tick); }));
  fpsLines.push(`zoom ${z}: ${r.fps.toFixed(1)} fps, worst frame ${Math.round(r.worst)} ms`);
  check(`2D map, all layers, zoom ${z}: at least 15 fps on software rendering`, r.fps >= 15, `(${fpsLines[fpsLines.length - 1]})`);
  if (z === 5.5) {
    // panning redraws the static base (country outlines) as well, so it is the costly case: drag the map across 3 seconds and count frames
    const fb = await f.locator('[data-testid="map-view"]').boundingBox();
    await f.evaluate(() => { window.__panFrames = { n: 0, worst: 0, last: performance.now(), t0: performance.now(), on: true }; const tick = (now) => { const s = window.__panFrames; if (!s.on) return; s.n++; s.worst = Math.max(s.worst, now - s.last); s.last = now; requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    const panBefore = await f.evaluate(() => window.__map.project(26.57, 56.25));
    await f.mouse.move(fb.x + 700, fb.y + 400); await f.mouse.down();
    for (let k = 1; k <= 30; k++) { await f.mouse.move(fb.x + 700 - k * 12, fb.y + 400 + k * 3); await f.waitForTimeout(100); }
    await f.mouse.up();
    await f.waitForTimeout(600);
    const panAfter = await f.evaluate(() => window.__map.project(26.57, 56.25));
    check("dragging the map actually moves it (Hormuz shifts by about the drag, -360 px across)", Math.abs(panAfter.x - panBefore.x - -360) < 40, `(moved ${Math.round(panAfter.x - panBefore.x)} px)`);
    const pr = await f.evaluate(() => { const s = window.__panFrames; s.on = false; return { fps: s.n / ((performance.now() - s.t0) / 1000), worst: s.worst }; });
    fpsLines.push(`zoom 5.5 while dragging the map: ${pr.fps.toFixed(1)} fps, worst frame ${Math.round(pr.worst)} ms (the static base is redrawn as the camera moves)`);
    check("2D map, all layers, dragging at zoom 5.5: measured (no threshold; the base is redrawn on every camera move)", pr.fps > 0, `(${fpsLines[fpsLines.length - 1]})`);
  }
  await f.close();
}
fs.writeFileSync(path.join(OUT, "map_fps.txt"), ["2D map, all layers on (routes, chokepoints, hubs, real tankers, 2,000 simulated vessels moving, scenario overlay switched on but no scenario active), 1440x900, Chromium with software WebGL (SwiftShader).", "A lower bound: a real GPU is faster.", ...fpsLines, ""].join(String.fromCharCode(10)));

fs.writeFileSync(path.join(OUT, "map_console.txt"), logs.join("\n"));
const errors = logs.filter((l) => /\[(error|pageerror)\]/.test(l));
check("0 console errors across the whole run", errors.length === 0, `(${errors.length})`);
errors.slice(0, 6).forEach((e) => console.log("     ", e.slice(0, 240)));
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
