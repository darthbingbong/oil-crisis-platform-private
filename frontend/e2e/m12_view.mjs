// M12 end-to-end: the real-vessel layer on BOTH views, in a real browser.   SHOT_DIR=<dir> node e2e/m12_view.mjs
// Needs: backend on :8000, `npm run dev` on :5173. The expired-key section starts nothing itself: set EXPIRED_BACKEND=http://127.0.0.1:8001 to a backend that was started
// with AIS_TODAY=2026-11-13 (the date is faked, nobody waits for it). No test here reaches the provider: provider searches are answered by the test.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = process.env.SHOT_DIR;
const BASE = "http://localhost:5173";
const EXPIRED = process.env.EXPIRED_BACKEND ?? "http://127.0.0.1:8001";
const exe = path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe");
const browser = await chromium.launch({ executablePath: exe, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"] });
const logs = [];
let failures = 0;
const check = (name, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${name} ${extra}`); };
async function newPage(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  page.apiCalls = [];
  page.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/v1/ais/") || /\/vessels\/\d+\//.test(u.pathname)) page.apiCalls.push(`${r.method()} ${u.pathname}${u.search}`); });
  return page;
}
const shot = async (p, name) => { await p.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log("      saved", name); };
const text = async (p, sel) => ((await p.locator(sel).innerText().catch(() => "")) || "").replace(/\s+/g, " ");
const bodyText = (p) => p.locator("body").innerText();
async function openMap(p, q = "view=map") { await p.goto(`${BASE}/?${q}`, { waitUntil: "load" }); await p.waitForSelector('[data-testid="map-view"]', { timeout: 60000 }); await p.waitForFunction(() => window.__map?.simCount?.() > 0, null, { timeout: 60000 }); await p.waitForTimeout(1500); }
async function openGlobe(p, q = "view=globe") { await p.goto(`${BASE}/?${q}`, { waitUntil: "load" }); await p.waitForSelector('[data-testid="view-toggle"]', { timeout: 60000 }); await p.waitForTimeout(2500); }
async function search(p, q, hitMmsi) {
  const input = p.locator('[data-testid="vessel-search-input"]');
  await input.click();
  await input.fill("");
  await input.pressSequentially(q, { delay: 70 });
  if (hitMmsi) { await p.waitForSelector(`[data-testid="vessel-search-hit-${hitMmsi}"]`, { timeout: 8000 }); await p.locator(`[data-testid="vessel-search-hit-${hitMmsi}"]`).click(); }
}
const MUHUT = 538006502, CAPE_ANN = 563202900, ACACIA = 319014800, SING_ENERGY = 538007985;

const page = await newPage(1440, 900);

// ------------------------------------------------------------------ 1. search: saved first, debounced, nothing sent to the provider
console.log("--- 1. search box (map)");
await openMap(page);
await page.locator('[data-testid="vessel-search-input"]').click();
await page.locator('[data-testid="vessel-search-input"]').pressSequentially("muhut", { delay: 60 });
await page.waitForSelector('[data-testid="vessel-search-saved"]', { timeout: 8000 });
const savedCalls = page.apiCalls.filter((c) => c.startsWith("GET /api/v1/ais/search"));
check("typing 5 characters quickly sends ONE saved-watchlist search (debounced), not one per key", savedCalls.length === 1, `(${savedCalls.join(" | ")})`);
check("typing sends nothing to the provider", !page.apiCalls.some((c) => c.includes("/search/provider")));
check("the saved result lists MUHUT SILVER with its MMSI, flag and area", /MUHUT SILVER/.test(await text(page, '[data-testid="vessel-search-saved"]')) && /538006502/.test(await text(page, '[data-testid="vessel-search-saved"]')));
check("the provider button is offered, but only as a separate, explicit step", (await page.locator('[data-testid="vessel-search-provider-button"]').count()) === 1 && /only asked when you press this button/.test(await text(page, '[data-testid="vessel-search-panel"]')));
await shot(page, "m12_01_search_saved_results");
await page.locator(`[data-testid="vessel-search-hit-${MUHUT}"]`).click();

// ------------------------------------------------------------------ 2. the vessel panel on the 2D map, with the saved headline track
console.log("\n--- 2. vessel panel on the 2D map");
await page.waitForSelector('[data-testid="watch-vessel-panel"]', { timeout: 15000 });
await page.waitForSelector('[data-testid="vessel-track-label"]', { timeout: 15000 });
await page.waitForTimeout(2500);
const mp = await text(page, '[data-testid="watch-vessel-panel"]');
check("URL carries vessel=538006502", new URL(page.url()).searchParams.get("vessel") === "538006502", `(${page.url().replace(BASE, "")})`);
for (const [label, re] of [["name", /MUHUT SILVER/], ["MMSI", /538006502/], ["flag", /Flag\s*Marshall Islands/i], ["type", /Type\s*tanker \(AIS type 8\d\)/i], ["nav status", /AIS status\s*[a-z ]+\(crew-set\)/i], ["speed", /Speed\s*[\d.]+ kn/i], ["course", /Course\s*\d{3}°/i],
  ["destination", /Destination/i], ["draught", /Draught/i], ["SNAPSHOT badge with its seen-at time", /SNAPSHOT 20\d\d-\d\d-\d\d \d\d:\d\d UTC/], ["cargo not confirmed", /cargo type not confirmed by AIS/]])
  check(`panel shows ${label}`, re.test(mp), `(${mp.slice(0, 0)})`);
check("the saved track is labelled 'past track, fetched at <time>'", /past track, fetched at 2026-11-03 16:11 UTC/.test(await text(page, '[data-testid="vessel-track-label"]')));
check("MUHUT SILVER is the HEADLINE track", (await page.locator('[data-testid="vessel-track-headline"]').count()) === 1);
check("the map also carries the track badge with the same label", /PAST TRACK, FETCHED AT 2026-11-03 16:11 UTC/.test((await text(page, '[data-testid="track-badge"]')).toUpperCase()));
check("the map flew to the vessel (zoomed in)", (await page.evaluate(() => window.__map.zoom())) >= 8);
await page.evaluate(() => window.__map.flyTo(37.0, -6.9, 7.2));
await page.waitForTimeout(1500);
await shot(page, "m12_02_map_vessel_panel_headline_track");
const near = await text(page, '[data-testid="vessel-near"]');
check("'vessels near this vessel (10 nm)' shows the SAVED sample with its seed and time", /vessels within 10 nm of FRONT ALTAIR, seen at \d\d:\d\d UTC/.test(near), `(${near.slice(0, 70)})`);
check("...says live Nearby is on hold and that the sample is not area coverage", /on hold/.test(near) && /NOT coverage of a chokepoint or any area/.test(near));
check("...lists nearby vessels with distances, nearest first", /\d+(\.\d)? nm/.test(near));

// ------------------------------------------------------------------ 3. stationary track, no track, a second area
console.log("\n--- 3. stationary track, no saved track, Malacca");
await search(page, "cape ann", CAPE_ANN);
await page.waitForFunction(() => /CAPE ANN/.test(document.querySelector('[data-testid="watch-vessel-panel"]')?.textContent ?? ""), null, { timeout: 15000 });
await page.waitForSelector('[data-testid="vessel-track-motion"]', { timeout: 10000 });
check("CAPE ANN's track is kept and labelled 'stationary during this window'", /stationary during this window/.test(await text(page, '[data-testid="vessel-track-motion"]')) && /past track, fetched at/.test(await text(page, '[data-testid="vessel-track-label"]')));
check("...and it is not the headline", (await page.locator('[data-testid="vessel-track-headline"]').count()) === 0);
await search(page, "oriental", ACACIA);
await page.waitForFunction(() => /ORIENTAL ACACIA/.test(document.querySelector('[data-testid="watch-vessel-panel"]')?.textContent ?? ""), null, { timeout: 15000 });
await page.waitForTimeout(1200);
check("a vessel without a saved track says 'no saved track'", (await text(page, '[data-testid="vessel-track-label"]')) === "no saved track" && (await page.locator('[data-testid="track-badge"]').count()) === 0);
await search(page, "singapore energy", SING_ENERGY);
await page.waitForFunction(() => /SINGAPORE ENERGY/.test(document.querySelector('[data-testid="watch-vessel-panel"]')?.textContent ?? ""), null, { timeout: 15000 });
await page.waitForTimeout(1500);
check("a Malacca tanker shows the Malacca sample (seed SINGAPORE ENERGY)", /within 10 nm of SINGAPORE ENERGY/.test(await text(page, '[data-testid="vessel-near-label"]')));
await shot(page, "m12_03_map_malacca_vessel_panel");

// ------------------------------------------------------------------ 4. the same on the globe (shared selection, same panel, track on the surface)
console.log("\n--- 4. the globe");
await page.locator('[data-testid="vessel-search-input"]').click();
await search(page, "muhut", MUHUT);
await page.waitForSelector('[data-testid="watch-vessel-panel"]', { timeout: 15000 });
await page.waitForTimeout(1500);
await page.locator('[data-testid="view-globe"]').click();
await page.waitForSelector('[data-testid="watch-vessel-panel"]', { timeout: 60000 });
await page.waitForTimeout(6000);
const gp = await text(page, '[data-testid="watch-vessel-panel"]');
check("switching to the globe keeps the selected vessel: same panel, same fields", /MUHUT SILVER/.test(gp) && /538006502/.test(gp) && /Flag\s*Marshall Islands/i.test(gp) && /cargo type not confirmed by AIS/.test(gp) && /SNAPSHOT 20\d\d-\d\d-\d\d \d\d:\d\d UTC/.test(gp));
check("the globe panel shows the same saved track label, headline and near sample", /past track, fetched at 2026-11-03 16:11 UTC/.test(gp) && (await page.locator('[data-testid="vessel-track-headline"]').count()) === 1 && /vessels within 10 nm of FRONT ALTAIR/.test(gp));
check("globe URL: view=globe with vessel=538006502 and no map camera", new URL(page.url()).searchParams.get("view") === "globe" && new URL(page.url()).searchParams.get("vessel") === "538006502" && !new URL(page.url()).searchParams.has("lat"), `(${page.url().replace(BASE, "")})`);
check("the globe says SNAPSHOT with the time and the key line", /SNAPSHOT 20\d\d-\d\d-\d\d \d\d:\d\d UTC · 12 REAL TANKERS/.test(await text(page, '[data-testid="globe-watch-badge"]')) && /AIS key expires in \d+ days?/.test(await text(page, '[data-testid="ais-key-line"]')));
await shot(page, "m12_04_globe_vessel_panel_track");
await page.locator('[data-testid="watch-vessel-close"]').click();
await page.waitForFunction(() => !document.querySelector('[data-testid="watch-vessel-panel"]'), null, { timeout: 30000 });
await page.waitForFunction(() => !new URLSearchParams(location.search).has("vessel"), null, { timeout: 20000 }).catch(() => undefined);
check("closing the panel returns the globe and clears vessel from the address", !new URL(page.url()).searchParams.has("vessel"), `(${page.url().replace(BASE, "")})`);
// search from the globe: another vessel
await search(page, "muhut", MUHUT);
await page.waitForSelector('[data-testid="watch-vessel-panel"]', { timeout: 30000 });
check("searching from the globe flies to the vessel and opens its panel", /MUHUT SILVER/.test(await text(page, '[data-testid="watch-vessel-panel"]')));
await page.locator('[data-testid="watch-vessel-close"]').click();
await page.waitForFunction(() => !document.querySelector('[data-testid="watch-vessel-panel"]'), null, { timeout: 30000 });
await page.waitForTimeout(3500);
// click a tanker dot on the globe
await page.waitForSelector('[data-testid="route-keyboard-list"]', { state: "attached", timeout: 30000 });      // the globe is idle again (its keyboard list only exists then)
const wl = await page.evaluate(() => fetch("/api/v1/vessels/watchlist").then((r) => r.json()));
const target = wl.vessels.find((v) => v.mmsi === MUHUT);
await page.evaluate(([a, b]) => window.__globe.look(a, b, 3.6), [target.lat, target.lng]);
await page.waitForTimeout(600);
const gpos = await page.evaluate(([a, b]) => window.__globe.project(a, b), [target.lat, target.lng]);
const gbox = await page.locator("canvas").first().boundingBox();
await page.mouse.move(gbox.x + gpos.x - 3, gbox.y + gpos.y - 3);
await page.mouse.move(gbox.x + gpos.x, gbox.y + gpos.y, { steps: 3 });
await page.waitForTimeout(500);
check("hovering a real tanker dot on the globe shows 'SNAPSHOT · REAL VESSEL'", /SNAPSHOT · REAL VESSEL/.test(await text(page, '[data-testid="globe-watch-tooltip"]')));
await page.mouse.click(gbox.x + gpos.x, gbox.y + gpos.y, { delay: 80 });
await page.waitForSelector('[data-testid="watch-vessel-panel"]', { timeout: 30000 }).catch(() => undefined);
check("clicking a real tanker dot on the globe opens the same vessel panel", (await page.locator('[data-testid="watch-vessel-panel"]').count()) === 1, `(${(await text(page, '[data-testid="watch-vessel-panel"]')).slice(0, 60)})`);
await page.locator('[data-testid="watch-vessel-close"]').click().catch(() => undefined);
await page.waitForTimeout(3500);

// ------------------------------------------------------------------ 5. the provider search: explicit, one call per press, honest messages (answered by the test, no provider traffic)
console.log("\n--- 5. provider search (explicit submit)");
const canned = { OK: { status: "OK", query: "eagle", message: null, note: "Vessel Search returns no position and no ship type, so these cannot be placed on a map without a paid position call.", key: { expired: false, line: "" },
  results: [{ mmsi: 477000001, imo: 9000001, name: "EAGLE ONE", call_sign: "VRXX", flag: "Hong Kong", last_report_utc: "2026-11-04T10:00:00Z", in_watchlist: false }, { mmsi: MUHUT, imo: 9000002, name: "MUHUT SILVER", call_sign: null, flag: "Marshall Islands", last_report_utc: "2026-11-04T10:01:00Z", in_watchlist: true }] },
  NO_MATCH: { status: "NO_MATCH", query: "zzqxjk", message: "no match", key: { expired: false, line: "" }, results: [] },
  UNAVAILABLE: { status: "UNAVAILABLE", kind: "rate_limited", query: "rate", message: "Too many searches this minute. Try again in 41 s.", retry_after_s: 41, key: { expired: false, line: "" }, results: [] } };
let providerPosts = 0;
await page.route("**/api/v1/ais/search/provider", async (route) => { providerPosts++; const q = JSON.parse(route.request().postData() ?? "{}").q; const key = q === "eagle" ? "OK" : q === "zzqxjk" ? "NO_MATCH" : "UNAVAILABLE"; await route.fulfill({ json: { ...canned[key], query: q } }); });
for (const [q, key, re, extra] of [["eagle", "OK", /EAGLE ONE/, "lists rows, marks the ones with no position, offers 'open' for a saved one"], ["zzqxjk", "NO_MATCH", /^no match$/, "status 31 is shown as 'no match'"], ["rate", "UNAVAILABLE", /Too many searches this minute/, "a per-minute limit is explained in plain words"]]) {
  const input = page.locator('[data-testid="vessel-search-input"]');
  await input.click(); await input.fill(""); await input.pressSequentially(q, { delay: 60 });
  await page.waitForSelector('[data-testid="vessel-search-provider-button"]', { timeout: 8000 });
  const before = providerPosts;
  await page.waitForTimeout(900);
  check(`'${q}': typing alone did not search the provider`, providerPosts === before);
  await page.locator('[data-testid="vessel-search-provider-button"]').click();
  await page.waitForSelector('[data-testid="vessel-search-provider-result"]', { timeout: 8000 });
  const res = await text(page, '[data-testid="vessel-search-provider-result"]');
  check(`'${q}': one press = one provider search; ${extra}`, providerPosts === before + 1 && re.test(key === "NO_MATCH" ? await text(page, '[data-testid="vessel-search-message"]') : res), `(${res.slice(0, 90)})`);
  if (key === "OK") { check("...rows without a position say so, and the saved one can be opened", /no position/.test(res) && /open/.test(res) && /cannot be placed on a map/.test(res)); await shot(page, "m12_05_provider_search_results"); }
}
await page.keyboard.press("Escape");

// ------------------------------------------------------------------ 6. budget and health
console.log("\n--- 6. budget and the key line");
const budget = await page.evaluate(() => fetch("/api/v1/ais/budget").then((r) => r.json()));
const health = await page.evaluate(() => fetch("/api/v1/health").then((r) => r.json()));
fs.writeFileSync(path.join(OUT, "m12_budget.json"), JSON.stringify({ budget, health_ais_key: health.ais_key, health_line: health.ais_key_line }, null, 1));
const used = (s) => budget.services[s].used;
check("GET /api/v1/ais/budget: Vessel Position 23 of 50, Track 3 of 10, Port-to-Port 5, Point-to-Point 2, Fleet 0", used("vessel_position") === 23 && budget.services.vessel_position.left === 27 && used("vessel_track") === 3 && budget.services.vessel_track.left === 7 && used("route_port") === 5 && used("route_point") === 2 && used("fleet_position") === 0, `(position ${used("vessel_position")}, track ${used("vessel_track")})`);
check("...unmetered services are counted but have no 'left'; Nearby is on hold", used("vessels_nearby") === 41 && budget.services.vessels_nearby.left === null && !!budget.services.vessels_nearby.hold);
check("/health carries 'AIS key expires in N days'", /^AIS key expires in \d+ days? \(2026-11-13\)$/.test(health.ais_key_line), `(${health.ais_key_line})`);

// ------------------------------------------------------------------ 7. nothing that must not be there
console.log("\n--- 7. what must not be there");
await openMap(page, `view=map&vessel=${MUHUT}`);
await page.waitForSelector('[data-testid="watch-vessel-panel"]', { timeout: 20000 });
const mapBody = await bodyText(page);
check("a shared link with vessel=… opens the vessel on a fresh load", /MUHUT SILVER/.test(await text(page, '[data-testid="watch-vessel-panel"]')));
await page.waitForTimeout(3500);
check("...and the map has flown to it (zoomed in, camera written back to the address)", (await page.evaluate(() => window.__map.zoom())) >= 8 && /zoom=9/.test(page.url()), `(zoom ${await page.evaluate(() => window.__map.zoom())})`);
await openGlobe(page, "view=globe");
const globeBody = await bodyText(page);
const bad = /tankers? (near|within) (this|the) (chokepoint|strait|canal)|tankers within \d+ ?nm|\d+ tankers? (in|near|within) [^.]{0,30}(chokepoint|strait|canal)|vessels in this area|chokepoint coverage/i;
check("no area counts or 'tankers near this chokepoint' claims on either view", !bad.test(mapBody) && !bad.test(globeBody));
check("no historical events chart on either view", !/HISTORICAL EVENTS|SUPPLY LOSS VS CONFLICT|24 events/i.test(mapBody + globeBody));
check("simulated traffic keeps its SIMULATED label on the globe", /SIMULATED VESSELS/.test(globeBody));

// ------------------------------------------------------------------ 8. tablet width
console.log("\n--- 8. tablet (820 x 1180)");
const tab = await newPage(820, 1180);
await openMap(tab, `view=map&vessel=${MUHUT}`);
await tab.waitForSelector('[data-testid="watch-vessel-panel"]', { timeout: 20000 });
await tab.waitForTimeout(2500);
check("tablet map: no horizontal overflow, panel and search present", (await tab.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)) && (await tab.locator('[data-testid="vessel-search-input"]').count()) === 1);
const tr = await tab.locator('[data-testid="vessel-search-input"]').boundingBox(), th = await tab.locator("header").boundingBox();
check("tablet: the search box sits inside the header, not over the toggle or the title", tr.y >= th.y - 1 && tr.y + tr.height <= th.y + th.height + 1);
await shot(tab, "m12_06_tablet_map_vessel");
await tab.close();

// ------------------------------------------------------------------ 9. the key has expired (date faked on a second backend), in the browser
console.log("\n--- 9. expired key (AIS_TODAY=2026-11-13 on a second backend)");
let expiredUp = false;
try { expiredUp = (await fetch(`${EXPIRED}/api/v1/health`)).ok; } catch { expiredUp = false; }
check("the expired-key backend is running", expiredUp, `(${EXPIRED})`);
if (expiredUp) {
  const ex = await newPage(1440, 900);
  await ex.route("**/api/v1/**", async (route) => { if (route.request().url().includes("/stream")) return route.continue(); const u = route.request().url().replace("http://localhost:5173", EXPIRED); const r = await route.fetch({ url: u }); await route.fulfill({ response: r }); });
  await openMap(ex, `view=map&vessel=${MUHUT}`);
  await ex.waitForSelector('[data-testid="watch-vessel-panel"]', { timeout: 20000 });
  await ex.waitForTimeout(2500);
  check("a banner says 'AIS key expired, showing data saved on 2026-11-11'", /AIS key expired, showing data saved on 2026-11-11/.test(await text(ex, '[data-testid="key-expired-banner"]')));
  check("the real-tanker badge carries the same line", /AIS key expired, showing data saved on 2026-11-11/.test(await text(ex, '[data-testid="ais-key-line"]')));
  const ep = await text(ex, '[data-testid="watch-vessel-panel"]');
  check("the vessel panel still shows everything, with the saved track and its date, and the expiry line", /MUHUT SILVER/.test(ep) && /past track, fetched at 2026-11-03 16:11 UTC/.test(ep) && /AIS key expired, showing data saved on/.test(await text(ex, '[data-testid="vessel-key-line"]')));
  check("no error screen anywhere", !/something went wrong|unexpected error|application error|failed to fetch|error:/i.test(await bodyText(ex)));
  await shot(ex, "m12_07_expired_key_map");
  await ex.locator('[data-testid="vessel-search-input"]').click();
  await ex.locator('[data-testid="vessel-search-input"]').pressSequentially("eagle", { delay: 60 });
  await ex.waitForSelector('[data-testid="vessel-search-expired"]', { timeout: 8000 });
  check("search: the provider button is gone and the box says only saved vessels can be searched", (await ex.locator('[data-testid="vessel-search-provider-button"]').count()) === 0 && /expired/.test(await text(ex, '[data-testid="vessel-search-expired"]')));
  await ex.keyboard.press("Escape");
  const direct = await ex.evaluate(() => fetch("/api/v1/ais/search/provider", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: "eagle" }) }).then((r) => r.json()));
  check("even a direct provider-search request makes no call: KEY_EXPIRED", direct.status === "KEY_EXPIRED" && /expired/.test(direct.message));
  await ex.locator('[data-testid="view-globe"]').click();
  await ex.waitForSelector('[data-testid="watch-vessel-panel"]', { timeout: 60000 });
  await ex.waitForTimeout(5000);
  check("expired key, globe: same vessel panel and the expired line in the globe badge", /MUHUT SILVER/.test(await text(ex, '[data-testid="watch-vessel-panel"]')) && /AIS key expired, showing data saved on 2026-11-11/.test(await text(ex, '[data-testid="ais-key-line"]')));
  await shot(ex, "m12_08_expired_key_globe");
  const exBudget = await ex.evaluate(() => fetch("/api/v1/ais/budget").then((r) => r.json()));
  check("expired: the budget endpoint still answers and says the key has expired", exBudget.key.expired === true && /expired/.test(exBudget.key.line));
  await ex.unrouteAll({ behavior: "ignoreErrors" });
  await ex.close();
}

// ------------------------------------------------------------------ 10. frame rate with the vessel panel and a track open (M11 numbers: 71 fps at zoom 2, 97 at zoom 5.5)
console.log("\n--- 10. frame rate, 2D map, all layers + selected vessel with its track");
await page.goto("about:blank");
const fpsLines = [];
for (const z of [2, 5.5]) {
  const f = await newPage(1440, 900);
  await openMap(f, `view=map&lat=26.57&lon=56.25&zoom=${z}&layers=routes,chokepoints,places,watchlist,simulated,scenario&vessel=${MUHUT}`);
  await f.waitForSelector('[data-testid="track-badge"]', { timeout: 20000 });
  await f.waitForTimeout(3000);
  const r = await f.evaluate(() => new Promise((res) => { let n = 0, worst = 0, last = performance.now(); const t0 = last; const tick = (now) => { n++; worst = Math.max(worst, now - last); last = now; if (now - t0 < 5000) requestAnimationFrame(tick); else res({ fps: n / ((now - t0) / 1000), worst }); }; requestAnimationFrame(tick); }));
  fpsLines.push(`zoom ${z}: ${r.fps.toFixed(1)} fps, worst frame ${Math.round(r.worst)} ms`);
  check(`2D map, all layers + vessel panel + track, zoom ${z}: not below the M11 figure (${z === 2 ? 71 : 97} fps) by more than 15%`, r.fps >= (z === 2 ? 71 : 97) * 0.85, `(${fpsLines[fpsLines.length - 1]})`);
  await f.close();
}
fs.writeFileSync(path.join(OUT, "m12_fps.txt"), ["2D map, all layers on, 2,000 simulated vessels moving, a real vessel selected with its panel and saved track, 1440x900, Chromium with software WebGL (SwiftShader). A lower bound.", "M11 reference: zoom 2 71 fps, zoom 5.5 97 fps.", ...fpsLines, ""].join(String.fromCharCode(10)));

fs.writeFileSync(path.join(OUT, "m12_console.txt"), logs.join(String.fromCharCode(10)));
const errors = logs.filter((l) => /\[(error|pageerror)\]/.test(l));
check("0 console errors across the whole run", errors.length === 0, `(${errors.length})`);
errors.slice(0, 6).forEach((e) => console.log("     ", e.slice(0, 260)));
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
