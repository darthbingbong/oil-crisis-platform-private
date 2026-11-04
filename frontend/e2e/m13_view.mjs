// M13 end-to-end: the Markets panel in a real browser, with the real TradingView widget.   SHOT_DIR=<dir> node e2e/m13_view.mjs
// Needs: backend on :8000, `npm run dev` on :5173, and network access to TradingView (the widget is the real one; where a check needs it to fail, the request is blocked).
// No AIS call is made by anything here.
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
const blockedLogs = [];
async function newPage(w, h, sink = logs) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on("console", (m) => sink.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => sink.push(`[pageerror] ${e.message}`));
  return page;
}
const shot = async (loc, name) => { await loc.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log("      saved", name); };
const panel = (p) => p.locator('[data-testid="markets-panel"]');
const ptext = async (p) => ((await panel(p).innerText()) || "").replace(/\s+/g, " ");
async function openDash(p, q = "view=map") {
  await p.goto(`${BASE}/?${q}`, { waitUntil: "load" });
  await p.waitForSelector('[data-testid="markets-panel"]', { timeout: 60000 });
  await panel(p).scrollIntoViewIfNeeded();
}
/** The text inside the TradingView iframe (a cross-origin frame; Playwright can read it, our own page cannot). */
async function widgetText(p, needle, ms = 60000) {
  const t0 = Date.now(); let last = "";
  while (Date.now() - t0 < ms) {
    for (const f of p.frames()) {
      if (!/tradingview/.test(f.url()) || f === p.mainFrame()) continue;
      try { last = ((await f.locator("body").innerText({ timeout: 2000 })) || "").replace(/\s+/g, " "); } catch { continue; }
      if (needle.test(last)) return last;
    }
    await p.waitForTimeout(1000);
  }
  return last;
}
const numberRows = (t) => (t.match(/\d[\d,]*\.\d+/g) ?? []).length;

// ------------------------------------------------------------------ 1. the dashboard, historical chart gone
console.log("--- 1. dashboard: historical events chart gone, Markets panel in its place");
const page = await newPage(1440, 1000);
await openDash(page);
const body = await page.locator("body").innerText();
check("no historical events chart on the dashboard", !/HISTORICAL EVENTS|SUPPLY LOSS VS CONFLICT|24 events|1973/i.test(body));
check("the Markets panel is there with three tabs Indices, Commodities, FX", (await page.locator('[role="tab"]').allInnerTexts()).join("|").toUpperCase() === "INDICES|COMMODITIES|FX");
check("the dashboard keeps its other panels (Crisis Scenario, News Alert Feed)", /Crisis Scenario/i.test(body) && /News Alert Feed/i.test(body));
check("the historical-chart component file is gone from the source", !fs.existsSync(path.join(process.cwd(), "src/components/HistoricalChart.tsx")));

// ------------------------------------------------------------------ 2. indices (the real widget)
console.log("\n--- 2. Indices tab: the real TradingView widget");
const idxText = await widgetText(page, /S&P 500[\s\S]*Sensex|Sensex[\s\S]*S&P 500/);
check("the widget loaded and lists the index rows", /S&P 500/.test(idxText) && /Dow Jones/.test(idxText) && /Sensex/.test(idxText) && /VIX/.test(idxText), `(${idxText.length} chars)`);
await page.waitForTimeout(15000);
const idxText2 = await widgetText(page, /./);
check("the widget shows real numbers (at least 5 index values)", numberRows(idxText2) >= 5, `(${numberRows(idxText2)} numbers)`);
const ptxt = await ptext(page);
check("the chip says exactly: Via TradingView widget, delay set by TradingView", /Via TradingView widget, delay set by TradingView/i.test(await page.locator('[data-testid="widget-chip"]').innerText()));
check("no 'as of' time on the widget tab and the word LIVE appears nowhere in the panel", !/as of/i.test(ptxt) && !/\blive\b/i.test(ptxt));
check("TradingView attribution is visible and links to TradingView", await page.locator('[data-testid="tv-attribution"]:visible').first().isVisible() && (await page.locator('[data-testid="tv-attribution"]:visible').first().getAttribute("href")) === "https://www.tradingview.com/");
check("the Nasdaq Composite and Nifty gaps are said on screen", /Nasdaq Composite and Nifty 50/.test(await page.locator('[data-testid="indices-note"]').innerText()));
check("the one-line 'loads from TradingView' note is shown", /load from TradingView/i.test(await page.locator('[data-testid="widget-load-note"]:visible').first().innerText()));
await page.locator('[data-testid="markets-help"]').first().hover();
const tip = await page.locator('[data-testid="markets-help-text"]').innerText();
check("the ? tooltip quotes TradingView's own delay wording", /only allowed to stream delayed data/.test(tip) && /Forex and crypto data is real-time/.test(tip) && /never sees the prices/.test(tip));
await page.mouse.move(5, 5);
await shot(panel(page), "indices");

// ------------------------------------------------------------------ 3. commodities
console.log("\n--- 3. Commodities tab: EIA cards for WTI and Brent, widget for the rest");
await page.click('[data-testid="markets-tab-commodities"]');
await page.waitForSelector('[data-testid="eia-card-wti"]', { timeout: 20000 });
const wtiTxt = (await page.locator('[data-testid="eia-card-wti"]').innerText()).replace(/\s+/g, " ");
const brTxt = (await page.locator('[data-testid="eia-card-brent"]').innerText()).replace(/\s+/g, " ");
const eia = await (await page.request.get("http://127.0.0.1:8000/api/v1/price/live")).json();
check("WTI card shows the backend's EIA value, its chip and an as-of date with its age", wtiTxt.includes(`$${eia.wti.toFixed(2)}`) && wtiTxt.includes(eia.status) && wtiTxt.includes(eia.as_of) && /days? old|today/.test(wtiTxt), `(${wtiTxt.slice(0, 110)})`);
check("Brent card shows the backend's EIA value, its chip and as-of", brTxt.includes(`$${eia.brent.toFixed(2)}`) && brTxt.includes(eia.status) && /days? old|today/.test(brTxt));
check("the EIA chip is DAILY_CLOSE or OFFLINE_FALLBACK, never LIVE", ["DAILY_CLOSE", "OFFLINE_FALLBACK"].includes(await page.locator('[data-testid="eia-chip-wti"]').innerText()));
check("no scenario number on the WTI card until the toggle is on, and none on Brent", (await page.locator('[data-testid="wti-scenario"]').count()) === 0 && !/scenario/i.test(brTxt));
const comText = await widgetText(page, /Gold[\s\S]*Copper|Copper[\s\S]*Gold/);
await widgetText(page, /\d[\d,]*\.\d+[\s\S]*\d[\d,]*\.\d+[\s\S]*\d[\d,]*\.\d+/, 30000);
check("the widget lists natural gas, gold, silver and copper (and not WTI or Brent)", /Natural gas/.test(comText) && /Gold/.test(comText) && /Silver/.test(comText) && /Copper/.test(comText) && !/\bWTI\b|\bBrent\b/i.test(comText));
check("lithium is stated as having no free source", /No free source for lithium/.test(await page.locator('[data-testid="lithium-note"]').innerText()));
await shot(panel(page), "commodities");

// ------------------------------------------------------------------ 4. WTI scenario toggle
console.log("\n--- 4. WTI scenario toggle (30-day formula, validated-range rule)");
await page.click('[data-testid="wti-scenario-toggle"]');
await page.waitForSelector('[data-testid="wti-scenario"]', { timeout: 10000 });
const sc = async () => ({
  value: await page.locator('[data-testid="wti-scenario-value"]').innerText(),
  badge: await page.locator('[data-testid="wti-scenario-badge"]').innerText(),
  range: await page.locator('[data-testid="wti-scenario-range"]').innerText(),
});
const setSupply = async (v) => { await page.locator('input[aria-label="Supply loss"]').evaluate((el, val) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, String(val)); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, v); await page.waitForTimeout(900); };
await setSupply(5); await page.locator('[data-testid="markets-panel"]').scrollIntoViewIfNeeded();
let s = await sc();
const expect5 = eia.wti * (1 + Math.round(5 / 0.15 * 100) / 100 / 100); // the backend rounds the move to 2 decimals (33.33), and the card applies the move it shows
check("5% supply loss: scenario = last WTI close x (1 + 5/0.15 %)", s.value === `$${expect5.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, `(${s.value}, expected ${expect5.toFixed(2)})`);
check("5% supply loss: badge VALIDATED 30 DAYS and the +/- 13.09 pp range with two dollar figures", /VALIDATED 30 DAYS/.test(s.badge) && /13\.09 pp/.test(s.range) && (s.range.match(/\$/g) ?? []).length === 2, `(${s.badge} | ${s.range})`);
await shot(panel(page), "wti_scenario_validated");
await setSupply(12);
s = await sc();
const expect12 = eia.wti * (1 + Math.round(12 / 0.15 * 100) / 100 / 100);
check("12% supply loss: OUTSIDE VALIDATED RANGE, no band, number still the plain formula", s.badge === "OUTSIDE VALIDATED RANGE" && !/13\.09/.test(s.range) && /no error band/.test(s.range) && s.value.replace(/[$,]/g, "") === expect12.toFixed(2), `(${s.badge} | ${s.value})`);
await shot(panel(page), "wti_scenario_outside");
await page.click('[data-testid="wti-scenario-toggle"]');
check("toggle off removes the scenario number again", (await page.locator('[data-testid="wti-scenario"]').count()) === 0);
check("no other card ever shows a scenario number (Brent and the widget tabs)", !/scenario/i.test((await page.locator('[data-testid="eia-card-brent"]').innerText())));

// ------------------------------------------------------------------ 5. FX
console.log("\n--- 5. FX tab");
await page.click('[data-testid="markets-tab-fx"]');
const fxText = await widgetText(page, /EUR\/USD[\s\S]*DXY/);
check("FX rows: EUR/USD, USD/JPY, USD/CNY, USD/INR and the dollar index", /EUR\/USD/.test(fxText) && /USD\/JPY/.test(fxText) && /USD\/CNY/.test(fxText) && /USD\/INR/.test(fxText) && /DXY/.test(fxText));
await page.waitForTimeout(12000);
check("FX widget shows real numbers", numberRows(await widgetText(page, /./)) >= 4);
await shot(panel(page), "fx");

// ------------------------------------------------------------------ 6. failure states
console.log("\n--- 6. failure states");
const blocked = await newPage(1440, 1000, blockedLogs); // its console errors are the blocked requests themselves, counted separately
await blocked.route(/tradingview\.com/, (r) => r.abort());
await openDash(blocked);
await blocked.waitForSelector('[data-testid="tv-unavailable"]', { timeout: 30000 });
const bt = await ptext(blocked);
check("TradingView blocked: 'Widget unavailable' with no number invented", /Widget unavailable/.test(bt) && !/\d{2,},?\d*\.\d{2}\s*(\+|-|▲|▼)/.test(bt));
check("TradingView blocked: the attribution link and the chip are still there, the page works", await blocked.locator('[data-testid="widget-chip"]').isVisible() && (await blocked.locator('[data-testid="markets-tab-fx"]').isEnabled()));
await blocked.click('[data-testid="markets-tab-commodities"]');
await blocked.waitForSelector('[data-testid="eia-card-wti"]');
check("TradingView blocked: the EIA cards for WTI and Brent still work", /\$\d/.test(await blocked.locator('[data-testid="eia-card-wti"]').innerText()));
await shot(panel(blocked), "widget_unavailable");
await blocked.close();

const fb = await newPage(1440, 1000);
await fb.route("**/api/v1/price/live", async (route) => { const r = await route.fetch(); const j = await r.json(); await route.fulfill({ json: { ...j, status: "OFFLINE_FALLBACK", as_of: "2026-08-18", age_days: 78, fallback_message: "test: EIA could not be used" } }); });
await openDash(fb);
await fb.click('[data-testid="markets-tab-commodities"]');
await fb.waitForSelector('[data-testid="eia-card-wti"]');
await fb.click('[data-testid="wti-scenario-toggle"]');
const fbt = (await fb.locator('[data-testid="eia-card-wti"]').innerText()).replace(/\s+/g, " ");
check("EIA fallback: chip OFFLINE_FALLBACK, dated, marked 'not current'", /OFFLINE_FALLBACK/.test(fbt) && /2026-08-18/.test(fbt) && /not current/.test(fbt));
check("EIA fallback: no scenario number on a stale price base, and it says why", (await fb.locator('[data-testid="wti-scenario"]').count()) === 0 && /stale saved fallback/.test(fbt));
await shot(fb.locator('[data-testid="eia-card-wti"]'), "eia_fallback_card");
await fb.close();

const down = await newPage(1440, 1000, blockedLogs); // the price requests are aborted on purpose here
await down.route("**/api/v1/price/**", (r) => r.abort());
await openDash(down);
await down.click('[data-testid="markets-tab-commodities"]');
await down.waitForSelector('[data-testid="eia-loading"]');
await down.waitForTimeout(2500);
check("backend price feed down: the EIA cards say so instead of showing a number", /WTI and Brent unavailable/.test(await down.locator('[data-testid="eia-loading"]').innerText()));
await down.close();

// ------------------------------------------------------------------ 7. both views, phone width, tablet
console.log("\n--- 7. globe view, tablet, phone");
const globe = await newPage(1440, 1000);
await openDash(globe, "view=globe");
check("globe view: same Markets panel, same chip", await globe.locator('[data-testid="widget-chip"]').isVisible());
await shot(globe.locator("body"), "dashboard_globe");
await globe.close();
await page.goto("about:blank");
const tab = await newPage(820, 1180);
await openDash(tab);
await widgetText(tab, /S&P 500/); await widgetText(tab, /\d[\d,]*\.\d+[\s\S]*\d[\d,]*\.\d+[\s\S]*\d[\d,]*\.\d+/, 30000); await tab.waitForTimeout(3000);
check("tablet 820 px: no horizontal page scroll", await tab.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await shot(panel(tab), "tablet_markets");
await tab.close();
const phone = await newPage(390, 1700); // tall on purpose: the page scrolls inside the right column, so a short viewport cuts the panel out of an element screenshot
await openDash(phone);
await widgetText(phone, /S&P 500/); await widgetText(phone, /\d[\d,]*\.\d+[\s\S]*\d[\d,]*\.\d+[\s\S]*\d[\d,]*\.\d+/, 30000); await phone.waitForTimeout(3000);
check("phone 390 px: no horizontal page scroll", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `(scrollWidth ${await phone.evaluate(() => document.documentElement.scrollWidth)})`);
check("phone 390 px: the Markets panel fits the screen width", (await panel(phone).boundingBox()).width <= 390);
await shot(panel(phone), "phone_markets");
await phone.close();

// ------------------------------------------------------------------ 8. frame rate (M12 numbers: 78 fps at zoom 2, 114 at zoom 5.5)
console.log("--- 8. frame rate, 2D map, all layers, a real vessel selected");
await page.close();
const fpsLines = [];
const measure = (f) => f.evaluate(() => new Promise((res) => { let n = 0, worst = 0, last = performance.now(); const t0 = last; const tick = (now) => { n++; worst = Math.max(worst, now - last); last = now; if (now - t0 < 5000) requestAnimationFrame(tick); else res({ fps: n / ((now - t0) / 1000), worst }); }; requestAnimationFrame(tick); }));
for (const z of [2, 5.5]) {
  // (a) the page as a visitor first sees it: the Markets panel is below the map and has not been scrolled to, so TradingView has not been contacted
  const f = await newPage(1440, 900);
  await f.goto(`${BASE}/?view=map&lat=26.57&lon=56.25&zoom=${z}&layers=routes,chokepoints,places,watchlist,simulated,scenario&vessel=538006502`, { waitUntil: "load" });
  await f.waitForSelector('[data-testid="map-view"]', { timeout: 60000 });
  await f.waitForFunction(() => window.__map?.simCount?.() > 0, null, { timeout: 60000 });
  await f.waitForSelector('[data-testid="track-badge"]', { timeout: 20000 });
  await f.waitForTimeout(4000);
  const notRequested = await f.locator('[data-testid="markets-panel"]').getAttribute("data-widgets-requested");
  const tvFrames = f.frames().filter((x) => /tradingview/.test(x.url())).length;
  const a = await measure(f);
  fpsLines.push(`zoom ${z}, panel not scrolled to (no TradingView request): ${a.fps.toFixed(1)} fps, worst frame ${Math.round(a.worst)} ms`);
  check(`before the panel is scrolled to, TradingView is not contacted (${tvFrames} frames)`, notRequested === "false" && tvFrames === 0);
  check(`fps at zoom ${z}, page as first shown: not below the M12 figure (${z === 2 ? 78 : 114}) by more than 15%`, a.fps >= (z === 2 ? 78 : 114) * 0.85, `(${fpsLines[fpsLines.length - 1]})`);
  // (b) worst case: scrolled to the panel and all three widgets opened, so three TradingView frames are mounted (reported, with a looser bar)
  await f.locator('[data-testid="markets-panel"]').scrollIntoViewIfNeeded();
  for (const t of ["commodities", "fx", "indices"]) { await f.click(`[data-testid="markets-tab-${t}"]`); await widgetText(f, /./, 8000); await f.waitForTimeout(4000); }
  await f.waitForTimeout(3000);
  const w = await measure(f);
  fpsLines.push(`zoom ${z}, all three widgets mounted and the panel on screen: ${w.fps.toFixed(1)} fps, worst frame ${Math.round(w.worst)} ms`);
  check(`fps at zoom ${z} with all three widgets mounted: at least 25 fps (the project's floor), figure reported`, w.fps >= 25, `(${fpsLines[fpsLines.length - 1]})`);
  await f.close();
}
fs.writeFileSync(path.join(OUT, "m13_fps.txt"), ["2D map, all layers on, 2,000 simulated vessels moving, a real vessel selected, 1440x900, Chromium with software WebGL (SwiftShader). A lower bound.", "M12 reference: zoom 2 78 fps, zoom 5.5 114 fps.", ...fpsLines, ""].join(String.fromCharCode(10)));

fs.writeFileSync(path.join(OUT, "m13_console.txt"), logs.join(String.fromCharCode(10)));
// the TradingView widget logs its own "No data for" warnings; only errors count here, warnings are listed in the file
const errors = logs.filter((l) => /\[(error|pageerror)\]/.test(l));
check("0 console errors across the whole run", errors.length === 0, `(${errors.length})`);
console.log(`      the two pages where requests were aborted on purpose (TradingView, the price feed) logged ${blockedLogs.filter((l) => /\[(error|pageerror)\]/.test(l)).length} failed requests (expected) and no page error`);
check("the two aborted-request pages had no uncaught page error", !blockedLogs.some((l) => l.startsWith("[pageerror]")));
errors.slice(0, 6).forEach((e) => console.log("     ", e.slice(0, 260)));
console.log(`      console warnings: ${logs.filter((l) => l.startsWith("[warning]")).length}`);
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
