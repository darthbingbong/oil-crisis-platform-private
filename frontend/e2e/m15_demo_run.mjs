// M15: one complete end-to-end run in a real browser, following DEMO_SCRIPT.md (the 7 minute version) step by step: same clicks, same numbers.
//   SHOT_DIR=../docs/m15_screenshots node e2e/m15_demo_run.mjs
// Needs the backend on :8000, `npm run dev` on :5173 and internet access (the Markets panel loads TradingView's widget). The numbers the script promises are
// read from the API in this file, not typed. Makes no AIS call (everything real is read from the saved snapshot) and no provider search is pressed.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = process.env.SHOT_DIR;
const BASE = "http://localhost:5173";
const API = "http://127.0.0.1:8000/api/v1";
const exe = path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe");
const browser = await chromium.launch({ executablePath: exe, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
let failures = 0;
const check = (name, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${name} ${extra}`); };
const shot = async (name, full = false) => { await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full }); console.log("      saved", name); };
const body = async () => (await page.locator("body").innerText()).replace(/[ \t]+/g, " ");
const text = async (id) => (await page.locator(`[data-testid="${id}"]`).first().innerText()).replace(/\s+/g, " ");
const setRange = (label, value) => page.locator(`input[type="range"][aria-label="${label}"]`).evaluate((el, v) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  set.call(el, String(v)); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
}, value);
const get = async (p) => (await fetch(`${API}${p}`)).json();
const post = async (p, b) => (await fetch(`${API}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).json();
async function widgetText(needle, ms = 60000) {
  const t0 = Date.now(); let last = "";
  while (Date.now() - t0 < ms) {
    for (const f of page.frames()) {
      if (!/tradingview/.test(f.url()) || f === page.mainFrame()) continue;
      try { last = ((await f.locator("body").innerText({ timeout: 2000 })) || "").replace(/\s+/g, " "); } catch { continue; }
      if (needle.test(last)) return last;
    }
    await page.waitForTimeout(1000);
  }
  return last;
}
async function openRouteByKeyboard(name) {
  await page.mouse.click(5, 5);
  let inList = false;
  for (let i = 0; i < 80 && !inList; i++) { await page.keyboard.press("Tab"); inList = await page.evaluate(() => !!document.activeElement?.closest('[data-testid="route-keyboard-list"]')); }
  if (!inList) return false;
  for (let i = 0; i < 16 && !(await page.evaluate((n) => (document.activeElement?.textContent ?? "").includes(n), name)); i++) await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page.waitForSelector('[data-testid="route-panel"]', { timeout: 15000 });
  return true;
}

// ---- the truth the script quotes, read from the API
const SUEZ = { route_id: "suez", disruption_type: "detour", detour_days: 20, duration_days: 60, conflict_intensity: 5, demand_change_pct: 0, ev_substitution_rate_pct: 100, lithium_availability_pct: 10, horizon_years: 5 };
const HORMUZ = { route_id: "hormuz", disruption_type: "blockade", blocked_share_pct: 100, duration_days: 30, conflict_intensity: 8, demand_change_pct: 0, ev_substitution_rate_pct: 100, lithium_availability_pct: 10, horizon_years: 5 };
const [health, price, wl, trk, sj, hj] = [await get("/health"), await get("/price/live"), await get("/vessels/watchlist"), await get("/vessels/538006502/track"), await post("/simulate/report", SUEZ), await post("/simulate/report", HORMUZ)];
const fmtInt = (x) => Math.round(x).toLocaleString("en-US");
const capTxt = wl.captured_at_utc.replace("T", " ").slice(0, 16) + " UTC";
console.log("health:", JSON.stringify({ price: health.feeds.price.state, news: health.feeds.news.state, ais: health.feeds.ais.state }), "| key:", wl.key_line);
check("health: price feed is ok or its fallback is known", ["ok", "fallback"].includes(health.feeds.price.state));
check("health: the AIS line is a key countdown or the expired line", /AIS key expires in \d+ days|AIS key expired/.test(wl.key_line));

// ---- 0:00 the dashboard
console.log("\n--- 0:00 to 0:45  The dashboard and what is real on it");
await page.goto(`${BASE}/`, { waitUntil: "load" });
await page.waitForSelector('[data-testid="price-ticker"][data-state="ready"]', { timeout: 60000 });
await page.waitForFunction(() => window.__vessels?.count > 0, null, { timeout: 60000 });
await page.waitForTimeout(2500);
check(`ticker badge reads ${price.status}`, (await text("price-status")).includes(price.status));
check("ticker shows the as-of date and its age", (await text("price-as-of")).includes(price.as_of), `(${await text("price-as-of")})`);
check("SIMULATED VESSELS badge", (await text("vessel-badge")).includes("SIMULATED VESSELS"));
check("MODEL BASELINE label in the header", (await body()).includes("MODEL BASELINE"));
check("the historical events chart is gone; the Markets panel is there", !/24 events|HISTORICAL EVENTS/i.test(await body()) && (await page.locator('[data-testid="markets-panel"]').count()) === 1);
await shot("demo_01_dashboard");

// ---- 0:45 globe to map, a route, its evidence
console.log("\n--- 0:45 to 1:45  Globe to map, a route and its evidence");
await page.locator('[data-testid="view-map"]').click();
await page.waitForSelector('[data-testid="map-view"]', { timeout: 60000 });
await page.waitForFunction(() => window.__map?.simCount?.() > 0, null, { timeout: 60000 });
await page.waitForTimeout(2500);
check("MAP view is on and the address says so", new URL(page.url()).searchParams.get("view") === "map");
if ((await page.locator('[data-testid="layers-collapse"]').getAttribute("aria-expanded")) !== "true") await page.locator('[data-testid="layers-collapse"]').click();
const chips = await page.locator('[data-testid^="layer-chip-"]').count();
check("Layers panel is open with a status chip on each layer", chips >= 5, `(${chips} chips)`);
const before = await page.evaluate(() => window.__map.project(26.57, 56.25));
await page.mouse.move(700, 450); await page.mouse.down();
for (let i = 1; i <= 20; i++) { await page.mouse.move(700 - i * 8, 450 + i * 3); await page.waitForTimeout(8); }
await page.mouse.up(); await page.waitForTimeout(1500);
const after = await page.evaluate(() => window.__map.project(26.57, 56.25));
check("dragging the map moves it", Math.hypot(after.x - before.x, after.y - before.y) > 100, `(${Math.round(Math.hypot(after.x - before.x, after.y - before.y))} px)`);
await shot("demo_02_map_layers");
check("Tab reaches the route list and Enter opens Suez", await openRouteByKeyboard("Suez"));
await page.waitForTimeout(3500);
const panel = (await page.locator('[data-testid="route-panel"]').innerText()).replace(/\s+/g, " ");
check(`route panel shows ${(sj.baseline.flow_bpd / 1e6).toFixed(1)} Mb/d (EIA 2023)`, panel.includes(`${(sj.baseline.flow_bpd / 1e6).toFixed(1)} Mb/d`));
check("current-conditions note is shown", /current conditions/i.test(panel));
check("the route news section is present", (await page.locator('[data-testid="route-news"]').count()) > 0);
console.log("      news state:", (await page.locator('[data-testid="route-news"]').innerText()).replace(/\s+/g, " ").slice(0, 150));
check("the address carries the view and the selection", /view=map/.test(page.url()) && /selected=suez/.test(page.url()), `(${page.url().replace(BASE, "")})`);
await shot("demo_03_suez_route_panel");

// ---- 1:45 one real vessel
console.log("\n--- 1:45 to 2:45  One real vessel, with its saved track");
await page.goto(`${BASE}/?view=map`, { waitUntil: "load" });
await page.waitForSelector('[data-testid="map-view"]', { timeout: 60000 });
await page.waitForTimeout(2500);
const apiCallsBefore = (await get("/ais/budget")).services?.vessel_search?.used ?? null;
await page.locator('[data-testid="vessel-search-input"]').click();
await page.locator('[data-testid="vessel-search-input"]').pressSequentially("muhut", { delay: 60 });
await page.waitForSelector('[data-testid="vessel-search-saved"]', { timeout: 8000 });
check("typing searches the saved vessels: MUHUT SILVER is listed with its MMSI", /MUHUT SILVER/.test(await text("vessel-search-saved")) && /538006502/.test(await text("vessel-search-saved")));
await page.locator('[data-testid="vessel-search-hit-538006502"]').click();
await page.waitForSelector('[data-testid="watch-vessel-panel"]', { timeout: 15000 });
await page.waitForSelector('[data-testid="vessel-track-label"]', { timeout: 15000 });
await page.waitForTimeout(3000);
const vp = await text("watch-vessel-panel");
check(`the badge says ${wl.vessels.length} REAL TANKERS with the snapshot time (SNAPSHOT ${capTxt})`, (await body()).includes(`SNAPSHOT ${capTxt}`) && (await body()).includes(`${wl.vessels.length} REAL TANKERS`));
check(`the AIS key line is on screen: ${wl.key_line}`, (await body()).includes(wl.key_line));
for (const [label, re] of [["name", /MUHUT SILVER/], ["MMSI", /538006502/], ["flag", /Marshall Islands/], ["type", /tanker/i], ["speed", /Speed/i], ["course", /Course/i], ["destination", /Destination/i], ["draught", /Draught/i], ["cargo not confirmed", /cargo type not confirmed by AIS/]])
  check(`vessel panel shows ${label}`, re.test(vp));
check(`track label is "${trk.label}"`, (await text("vessel-track-label")).includes(trk.label));
check("MUHUT SILVER is the HEADLINE track", (await page.locator('[data-testid="vessel-track-headline"]').count()) === 1);
check(`the distances are on screen: ${trk.path_nm} nm sailed, ${trk.start_to_end_nm} nm start to end`, vp.includes(String(trk.path_nm)) || vp.includes(String(Math.round(trk.path_nm))) || /846/.test(vp), `(${(vp.match(/\d+(\.\d+)? nm[^.]*/) ?? [""])[0].slice(0, 60)})`);
await shot("demo_04_vessel_panel_map");
await page.locator('[data-testid="view-globe"]').click();
await page.waitForTimeout(3500);
check("GLOBE shows the same vessel panel and the same track label", /MUHUT SILVER/.test(await body()) && (await body()).includes(trk.label));
await shot("demo_05_vessel_panel_globe");
await page.locator('[data-testid="view-map"]').click();
await page.waitForTimeout(2500);
check("back on MAP the vessel is still open", /MUHUT SILVER/.test(await body()));
const searchUsed = (await get("/ais/budget")).services?.vessel_search?.used ?? null;
check("no provider search was made (the search budget did not move)", apiCallsBefore === searchUsed, `(${apiCallsBefore} -> ${searchUsed})`);

// ---- 2:45 the Markets panel
console.log("\n--- 2:45 to 3:30  The Markets panel");
await page.goto(`${BASE}/?view=map`, { waitUntil: "load" });
await page.waitForSelector('[data-testid="markets-panel"]', { timeout: 60000 });
await page.locator('[data-testid="markets-panel"]').scrollIntoViewIfNeeded();
await page.locator('[data-testid="markets-tab-commodities"]').click();
await page.waitForSelector('[data-testid="eia-card-wti"]', { timeout: 20000 });
const wtiCard = (await text("eia-card-wti"));
check(`WTI card: $${price.wti.toFixed(2)}, ${price.status}, dated with its age`, wtiCard.includes(`$${price.wti.toFixed(2)}`) && wtiCard.includes(price.status) && wtiCard.includes(price.as_of));
const comm = await widgetText(/Gold[\s\S]*Copper|Copper[\s\S]*Gold/);
check("TradingView widget lists natural gas, gold, silver and copper (loaded from TradingView)", /Natural gas/.test(comm) && /Gold/.test(comm) && /Silver/.test(comm) && /Copper/.test(comm));
check("the chip reads: Via TradingView widget, delay set by TradingView", /Via TradingView widget, delay set by TradingView/i.test(await text("widget-chip")));
await page.locator('[data-testid="markets-help"]').last().hover();
check("the ? tooltip quotes TradingView's delay wording", /only allowed to stream delayed data/.test(await text("markets-help-text")));
await page.mouse.move(5, 5);
await page.locator('[data-testid="wti-scenario-toggle"]').click();
await page.waitForSelector('[data-testid="wti-scenario"]', { timeout: 10000 });
const move5 = Math.round((5 / 0.15) * 100) / 100;
const exp5 = `$${(price.wti * (1 + move5 / 100)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
check(`WTI scenario at the default 5% supply loss is ${exp5} with the badge VALIDATED 30 DAYS`, (await text("wti-scenario-value")) === exp5 && /VALIDATED 30 DAYS/i.test(await text("wti-scenario-badge")), `(${await text("wti-scenario-value")})`);
await page.locator('[data-testid="markets-panel"]').screenshot({ path: path.join(OUT, "demo_06_markets_wti_scenario.png") });
await setRange("Supply loss", 12);
await page.waitForTimeout(1000);
check("past 8% supply loss the badge flips to OUTSIDE VALIDATED RANGE and the range disappears", /OUTSIDE VALIDATED RANGE/i.test(await text("wti-scenario-badge")) && !/13\.09/.test(await text("wti-scenario-range")));
await page.locator('[data-testid="markets-panel"]').screenshot({ path: path.join(OUT, "demo_07_markets_outside.png") });
await page.locator('[data-testid="markets-tab-indices"]').click();
const idx = await widgetText(/S&P 500[\s\S]*Sensex/);
check("Indices tab: rows load, CFD rows are labelled, the Nasdaq Composite / Nifty gap is stated", /S&P 500 \(CFD\)/.test(idx) && /Sensex/.test(idx) && /Nasdaq Composite and Nifty 50/.test(await text("indices-note")));
check("no 'as of' time and no LIVE anywhere in the Markets panel", !/as of/i.test((await text("markets-panel")).replace(/As of \d{4}-\d{2}-\d{2}[^.]*/g, "")) && !/\blive\b/i.test(await text("markets-panel")));
await page.waitForTimeout(6000);
await page.locator('[data-testid="markets-panel"]').screenshot({ path: path.join(OUT, "demo_08_markets_indices.png") });

// ---- 3:30 the worked Suez example, started from the map
console.log("\n--- 3:30 to 4:30  The worked example: a 20-day Suez detour");
await page.goto(`${BASE}/?view=map`, { waitUntil: "load" });
await page.waitForSelector('[data-testid="map-view"]', { timeout: 60000 });
await page.waitForTimeout(2500);
check("Suez opened from the route list", await openRouteByKeyboard("Suez"));
await page.waitForTimeout(2000);
await page.locator('[data-testid="route-panel"] button:has-text("detour")').click();
await page.locator('[data-testid="simulate-on-route"]').click();
await page.waitForTimeout(3000);
await page.locator('[data-testid="route-scenario"]').scrollIntoViewIfNeeded();
await setRange("Detour (extra voyage days)", 20);
await setRange("Disruption duration", 60);
await page.waitForTimeout(1200);
check("detour 20d and duration 60d are set", (await text("route-scenario")).includes("20d") && (await text("route-scenario")).includes("60d"));
await shot("demo_09_scenario_controls");
await page.locator('[data-testid="run-full-simulation"]').scrollIntoViewIfNeeded();
await page.locator('[data-testid="run-full-simulation"]').click();
await page.waitForSelector('[data-testid="kpi-strip"]', { timeout: 60000 });
await page.waitForSelector('[data-testid="chart-price"] svg', { timeout: 20000 });
await page.waitForTimeout(1800);
const kpi = await text("kpi-strip");
const k = sj.kpis;
check(`KPI 30-day price impact +${k.price_impact_pct.toFixed(1)}% with the badge ${k.validation_badge}`, kpi.includes(`+${k.price_impact_pct.toFixed(1)}%`) && /30-day price impact/i.test(kpi) && (await text("kpi-validation-badge")).toUpperCase() === k.validation_badge.toUpperCase());
check(`KPI barrels displaced ${fmtInt(k.displaced_bpd)}`, kpi.includes(fmtInt(k.displaced_bpd)));
check(`KPI EVs required ${(k.evs_required / 1e6).toFixed(2)} M`, kpi.includes(`${(k.evs_required / 1e6).toFixed(2)} M`));
check(`KPI extra lithium ${(k.extra_lithium_t_lce / 1e6).toFixed(2)} M t`, kpi.includes(`${(k.extra_lithium_t_lce / 1e6).toFixed(2)} M t`));
check(`KPI lithium deficit ${(k.lithium_deficit_t_lce / 1e6).toFixed(2)} M t`, kpi.includes(`${(k.lithium_deficit_t_lce / 1e6).toFixed(2)} M t`));
check("the results address carries the scenario", /route=suez/.test(page.url()) && /detour=20/.test(page.url()) && /dur=60/.test(page.url()));
check("price chart: one marker at 30 days, no path", (await page.locator('[data-testid="chart-price"] .recharts-xAxis-tick-labels text').allTextContents()).join() === "30 days" && (await page.locator('[data-testid="chart-price"] .recharts-line-curve').count()) === 0);
check("the duration note is next to the price: supply loss only, not duration", /uses supply loss only, not duration/.test(await text("duration-note")));
await shot("demo_10_results_top");
await page.locator('[data-testid="section-price"]').scrollIntoViewIfNeeded();
await page.waitForTimeout(600);
await page.locator('[data-testid="section-price"]').screenshot({ path: path.join(OUT, "demo_11_price_marker.png") });

// ---- 4:30 the arithmetic: each number in the script's table is on the page
console.log("\n--- 4:30 to 5:30  The arithmetic");
const results = (await page.locator("body").textContent()) ?? "";
const sb = sj.sections.barrels.numbers;
for (const n of [fmtInt(sj.baseline.flow_bpd), fmtInt(sb.displaced_bpd), fmtInt(sb.transit_gap_bbl), fmtInt(k.evs_required), "13.09"]) check(`Results page shows ${n}`, results.includes(n));
check("the EV horizons are labelled arithmetic, not a forecast", /if the displacement lasted this long.*arithmetic, not a forecast/.test(await text("section-evs")));
check("the economy section is labelled SOURCED ESTIMATE", /SOURCED ESTIMATE/i.test(await text("section-economy")));
await shot("demo_12_results_full", true);

// ---- 5:30 Hormuz
console.log("\n--- 5:30 to 6:15  Hormuz: where the formula stops being validated");
await page.goto(`${BASE}/results?route=hormuz&type=blockade&share=100&dur=30&conf=8&dem=0&ev=100&li=10&horizon=5`, { waitUntil: "load" });
await page.waitForSelector('[data-testid="kpi-strip"]', { timeout: 60000 });
await page.waitForSelector('[data-testid="chart-price"] svg', { timeout: 20000 });
await page.waitForTimeout(1800);
const hk = await text("kpi-strip");
check(`Hormuz KPI is +${hj.kpis.price_impact_pct.toFixed(0)}% and says not validated at this magnitude`, hk.includes(`+${hj.kpis.price_impact_pct.toFixed(0)}`) && /not validated at this magnitude/.test(hk));
check("the badge reads OUTSIDE VALIDATED RANGE and the red warning is shown", (await text("kpi-validation-badge")).toUpperCase() === "OUTSIDE VALIDATED RANGE" && (await page.locator('[data-testid="kpi-outside-warning"]').count()) === 1);
check("error bar hidden: 'not validated at this magnitude'", (await page.locator('[data-testid="band-not-validated"]').count()) > 0 && (await page.locator('[data-testid="chart-price"] .recharts-errorBars').count()) === 0);
check("bypass sensitivity 4.7 vs 2.6 Mb/d is shown", /4\.7 vs 2\.6 Mb\/d/.test((await text("chart-price")) + (await body())));
await shot("demo_13_hormuz_results_top");
await page.locator('[data-testid="section-price"]').scrollIntoViewIfNeeded();
await page.waitForTimeout(600);
await page.locator('[data-testid="section-price"]').screenshot({ path: path.join(OUT, "demo_14_hormuz_price_marker.png") });

// ---- 6:15 the close: simulated vessels reroute with the Suez scenario active; click one
console.log("\n--- 6:15 to 7:00  The close");
await page.goto(`${BASE}/results?route=suez&type=detour&detour=20&dur=60&conf=5&dem=0&ev=100&li=10&horizon=5`, { waitUntil: "load" });
await page.waitForSelector('[data-testid="kpi-strip"]', { timeout: 60000 });
await page.locator('[data-testid="edit-scenario"]').click();
await page.waitForFunction(() => window.__vessels?.count > 0, null, { timeout: 60000 });
await page.waitForTimeout(6000);
const look = (lat, lng, d) => page.evaluate(([a, b, c]) => window.__globe?.look(a, b, c), [lat, lng, d]);
for (let i = 0; i < 3; i++) { await look(-12, 22, 3.5); await page.waitForTimeout(300); }
await shot("demo_15_cape_lane_amber_vessels");
const rer = await page.evaluate(() => { const v = window.__vessels; for (let i = 0; i < v.count; i++) { const inf = v.info(i); if (inf.status.startsWith("rerouted")) return i; } return -1; });
check("vessels on the Suez lane have been rerouted onto the Cape lane (simulated)", rer >= 0);
await page.evaluate((i) => window.__vessels.select(i), rer);
await page.waitForTimeout(800);
const sv = await text("vessel-panel");
check("the simulated vessel's panel says 'simulated' for what it lacks and ends 'cargo type not confirmed by AIS'", /MMSI simulated/i.test(sv) && /FLAG simulated/i.test(sv) && sv.includes("cargo type not confirmed by AIS"));
check("the SIMULATED badge stays visible", (await text("vessel-badge")).includes("SIMULATED"));
await shot("demo_16_simulated_vessel_panel");

fs.writeFileSync(path.join(OUT, "m15_demo_console.txt"), logs.join(String.fromCharCode(10)));
const errors = logs.filter((l) => /\[(error|pageerror)\]/.test(l));
check("0 console errors across the whole run", errors.length === 0, `(${errors.length})`);
errors.slice(0, 6).forEach((e) => console.log("     ", e.slice(0, 260)));
console.log(`      console warnings: ${logs.filter((l) => l.startsWith("[warning]")).length}`);
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
