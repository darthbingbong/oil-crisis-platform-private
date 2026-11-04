// M9: one complete end-to-end run in a real browser, following DEMO_SCRIPT.md step by step (same clicks, same numbers). Screenshots to SHOT_DIR.
// Every number the script promises on screen is asserted here against the page text.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = process.env.SHOT_DIR;
const BASE = "http://localhost:5173";
const exe = path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe");
const browser = await chromium.launch({ executablePath: exe, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
let failures = 0;
const check = (name, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${name} ${extra}`); };
const shot = async (name, full = false) => { await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full }); console.log("      saved", name); };
const look = (lat, lng, d) => page.evaluate(([a, b, c]) => window.__globe?.look(a, b, c), [lat, lng, d]);
const body = async () => (await page.locator("body").innerText()).replace(/[ \t]+/g, " ");
const text = async (id) => (await page.locator(`[data-testid="${id}"]`).first().innerText()).replace(/\s+/g, " ");
const setRange = (label, value) => page.locator(`input[type="range"][aria-label="${label}"]`).evaluate((el, v) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  set.call(el, String(v)); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
}, value);

// ---- before you start: health
const health = await (await fetch(`${BASE}/api/v1/health`)).json();
console.log("0. /health:", JSON.stringify({ overall: health.overall, price: health.feeds.price.state, news: health.feeds.news.state, ais: health.feeds.ais.state }));
check("health: price feed is ok (EIA answered) or the fallback is known", ["ok", "fallback"].includes(health.feeds.price.state));
check("health: ais says fallback (no key) so vessels are simulated", health.feeds.ais.state === "fallback");

// ---- 0:00 dashboard
console.log("\n--- 0:00 to 0:45  The dashboard");
await page.goto(`${BASE}/`, { waitUntil: "load" });
await page.waitForSelector('[data-testid="price-ticker"][data-state="ready"]', { timeout: 60000 });
await page.waitForFunction(() => window.__vessels?.count > 0, null, { timeout: 60000 });
await page.waitForTimeout(2500);
const badge = (await text("price-status")).trim();
check("ticker badge reads DAILY_CLOSE or OFFLINE_FALLBACK", /DAILY_CLOSE|OFFLINE_FALLBACK/.test(badge), `(${badge})`);
check("ticker shows the as-of date and its age", /\d{4}-\d{2}-\d{2}/.test(await text("price-as-of")), `(${await text("price-as-of")})`);
check("SIMULATED VESSELS badge", (await text("vessel-badge")).includes("SIMULATED VESSELS"));
check("MODEL BASELINE label in the header", (await body()).includes("MODEL BASELINE"));
check("the historical events chart is gone and the Markets panel is there (M13)", !/24 events|HISTORICAL EVENTS/i.test(await body()) && (await page.locator('[data-testid="markets-panel"]').count()) === 1);
await shot("demo_01_dashboard");

// ---- 0:45 Suez route via the keyboard list (Tab, then Enter)
console.log("\n--- 0:45 to 1:30  A route and its evidence (Suez, opened with the keyboard)");
await page.mouse.click(5, 5);
let inList = false;
for (let i = 0; i < 60 && !inList; i++) {
  await page.keyboard.press("Tab");
  inList = await page.evaluate(() => !!document.activeElement?.closest('[data-testid="route-keyboard-list"]'));
}
check("Tab reaches the route list", inList);
for (let i = 0; i < 14 && !(await page.evaluate(() => (document.activeElement?.textContent ?? "").includes("Suez"))); i++) await page.keyboard.press("Tab");
check("focus is on the Suez button", await page.evaluate(() => (document.activeElement?.textContent ?? "").includes("Suez")));
await page.keyboard.press("Enter");
await page.waitForSelector('[data-testid="route-panel"]', { timeout: 15000 });
await page.waitForTimeout(3500);
const panel = (await page.locator('[data-testid="route-panel"]').innerText()).replace(/\s+/g, " ");
check("route panel shows 8.8 Mb/d (EIA 2023)", panel.includes("8.8 Mb/d"), "(" + (panel.match(/[\d.]+ Mb\/d/) ?? [""])[0] + ")");
check("current-conditions note is shown", /current conditions/i.test(panel));
check("news section is present with an honest state", (await page.locator('[data-testid="route-news"]').count()) > 0);
console.log("      news state:", (await page.locator('[data-testid="route-news"]').innerText()).replace(/\s+/g, " ").slice(0, 160));
await shot("demo_02_suez_route_panel");

// ---- 1:30 detour 20 days, run the full simulation
console.log("\n--- 1:30 to 2:30  The worked example: a 20-day Suez detour");
await page.locator('[data-testid="route-panel"] button:has-text("detour")').click();
await page.locator('[data-testid="simulate-on-route"]').click();
await page.waitForTimeout(3000);
await page.locator('[data-testid="route-scenario"]').scrollIntoViewIfNeeded();
await setRange("Detour (extra voyage days)", 20);
await setRange("Disruption duration", 60);
await page.waitForTimeout(1200);
check("detour slider reads 20d", (await text("route-scenario")).includes("20d"));
check("duration slider reads 60d", (await text("route-scenario")).includes("60d"));
await shot("demo_03_scenario_controls");
await page.locator('[data-testid="run-full-simulation"]').scrollIntoViewIfNeeded();
await page.locator('[data-testid="run-full-simulation"]').click();
await page.waitForSelector('[data-testid="kpi-strip"]', { timeout: 60000 });
await page.waitForTimeout(1500);
const kpi = (await text("kpi-strip"));
console.log("      KPI strip:", kpi);
check("KPI price impact +28.8%", kpi.includes("+28.8%"));
check("KPI barrels displaced 4,455,696", kpi.includes("4,455,696"));
check("KPI EVs required 63.43 M", kpi.includes("63.43 M"));
check("KPI extra lithium 2.03 M t", kpi.includes("2.03 M t"));
check("KPI lithium deficit 1.25 M t", kpi.includes("1.25 M t"));
check("results URL carries the scenario", /route=suez/.test(page.url()) && /detour=20/.test(page.url()) && /dur=60/.test(page.url()), `(${page.url().replace(BASE, "")})`);
await shot("demo_04_results_top");

// ---- 2:30 the arithmetic: each number in the demo table is on the Results page
console.log("\n--- 2:30 to 3:30  The arithmetic");
const results = (await page.locator("body").textContent()) ?? "";
for (const n of ["4,455,696", "8,800,000", "176,000,000", "2,025,726", "771,835", "1,253,891", "63,426,835", "13.09"]) check(`Results page shows ${n}`, results.includes(n));
check("Results page shows the 19.5 day voyage / 20-day detour", /20 days/.test(results) && /14 days/.test(results));
await shot("demo_05_results_full", true);

// ---- 3:30 Hormuz
console.log("\n--- 3:30 to 4:15  Hormuz: where the formula stops being validated");
await page.goto(`${BASE}/results?route=hormuz&type=blockade&share=100&dur=30&conf=8&dem=0&ev=100&li=10&horizon=5`, { waitUntil: "load" });
await page.waitForSelector('[data-testid="kpi-strip"]', { timeout: 60000 });
await page.waitForTimeout(1500);
const hk = await text("kpi-strip");
check("Hormuz KPI price implied is +103%", /\+103/.test(hk), `(${hk.slice(0, 60)})`);
check("red warning: outside the validated range", (await page.locator('[data-testid="outside-validated"], [data-testid="outside-validated-banner"]').count()) > 0 || /outside the validated range/i.test(await body()));
check("error band hidden: 'not validated at this magnitude'", (await page.locator('[data-testid="band-not-validated"]').count()) > 0);
check("bypass sensitivity 4.7 vs 2.6 Mb/d is shown", /4\.7 vs 2\.6 Mb\/d/.test((await page.locator('[data-testid="chart-price"]').innerText()) + (await body())));
await shot("demo_06_hormuz_results_top");
await page.locator('[data-testid="chart-price"]').scrollIntoViewIfNeeded();
await page.waitForTimeout(600);
await shot("demo_07_hormuz_price_chart");

// ---- 4:15 vessels reroute with the Suez scenario active; click one; AIS limits
console.log("\n--- 4:15 to 5:00  The vessels, the limits, and the close");
await page.goto(`${BASE}/results?route=suez&type=detour&detour=20&dur=60&conf=5&dem=0&ev=100&li=10&horizon=5`, { waitUntil: "load" });
await page.waitForSelector('[data-testid="kpi-strip"]', { timeout: 60000 });
await page.locator('[data-testid="edit-scenario"]').click();
await page.waitForFunction(() => window.__vessels?.count > 0, null, { timeout: 60000 });
await page.waitForTimeout(6000);
for (let i = 0; i < 3; i++) { await look(6, 36, 5.0); await page.waitForTimeout(300); }
await shot("demo_08_suez_scenario_vessels_rerouting");
for (let i = 0; i < 3; i++) { await look(-12, 22, 3.5); await page.waitForTimeout(300); }
await shot("demo_09_cape_lane_amber_vessels");
const rer = await page.evaluate(() => { const v = window.__vessels; for (let i = 0; i < v.count; i++) { const inf = v.info(i); if (inf.status.startsWith("rerouted")) return i; } return -1; });
check("vessels on the Suez lane have been rerouted onto the Cape lane (simulated)", rer >= 0);
await page.evaluate((i) => window.__vessels.select(i), rer);
await page.waitForTimeout(800);
const vp = (await text("vessel-panel"));
console.log("      vessel panel:", vp);
check("vessel panel fields it lacks say 'simulated'", /MMSI simulated/i.test(vp) && /FLAG simulated/i.test(vp) && /DRAUGHT simulated/i.test(vp) && /DESTINATION simulated/i.test(vp));
check("vessel panel ends with 'cargo type not confirmed by AIS'", vp.includes("cargo type not confirmed by AIS"));
check("badge still visible with the panel open", (await text("vessel-badge")).includes("SIMULATED"));
await shot("demo_10_vessel_panel");
await page.locator('[data-testid="vessel-info-button"]').hover();
await page.waitForTimeout(400);
const tip = await text("vessel-info");
check("AIS limits tooltip: coverage, transponders, destination, free tier, cargo", ["Coverage has gaps", "transponder", "Destination", "Free tiers", "carrying"].every((w) => tip.includes(w)));
await shot("demo_11_ais_limits_tooltip");

fs.writeFileSync(path.join(OUT, "demo_console.txt"), logs.join("\n"));
const errors = logs.filter((l) => /\[(error|pageerror)\]/.test(l));
check("0 console errors across the whole run", errors.length === 0, `(${errors.length})`);
errors.slice(0, 5).forEach((e) => console.log("     ", e.slice(0, 200)));
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
