// Follow-ups after M15: (1) the AIS toggle wording, (2) the header baseline is the sourced EIA close and agrees with every other place a price appears.
//   SHOT_DIR=<dir> node e2e/m15_fixes.mjs      Needs the backend on :8000 (no AISStream key) and `npm run dev` on :5173. No AIS call is made.
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
async function newPage(w = 1440, h = 900) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  p.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
  p.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  return p;
}
const price = await (await fetch("http://127.0.0.1:8000/api/v1/price/live")).json();
const vstatus = await (await fetch("http://127.0.0.1:8000/api/v1/vessels/status")).json();
console.log(`API: WTI ${price.wti} (${price.status}, ${price.as_of}); AISStream adapter state: ${vstatus.state}`);

console.log("\n--- 1. the AIS toggle (globe)");
let p = await newPage();
await p.goto(`${BASE}/?view=globe`, { waitUntil: "load" });
await p.waitForSelector('[data-testid="vessel-controls"]', { timeout: 60000 });
await p.waitForSelector('[data-testid="vessel-feed-explain"]', { timeout: 15000 });
const ex = (await p.locator('[data-testid="vessel-feed-explain"]').innerText()).replace(/\s+/g, " ");
check("the live-feed button says AISStream live (not the vague 'AIS feed')", /AISStream live/i.test(await p.locator('[data-testid="vessel-mode-ais"]').innerText()));
check("it is disabled, so there is no error to trigger", await p.locator('[data-testid="vessel-mode-ais"]').isDisabled());
check("the explanation: AISStream feed not configured; the real tankers are the SNAPSHOT layer (ShipFinder), not this feed", /not configured/.test(ex) && /AISStream/.test(ex) && /SNAPSHOT/.test(ex) && /ShipFinder/.test(ex), `(${ex})`);
check("the old wording 'AIS feed unavailable' is gone", !/AIS feed unavailable/.test(await p.locator("body").innerText()));
check("the badge still says SIMULATED VESSELS (and the globe's snapshot badge is separate)", /SIMULATED VESSELS/.test(await p.locator('[data-testid="vessel-badge"]').innerText()) && (await p.locator('[data-testid="globe-watch-badge"]').count()) === 1);
await p.screenshot({ path: path.join(OUT, "fix1_ais_toggle_globe.png") });
await p.close();

console.log("\n--- 2. the header baseline");
p = await newPage();
await p.goto(`${BASE}/?view=map`, { waitUntil: "load" });
await p.waitForSelector('[data-testid="baseline-price"]', { timeout: 60000 });
await p.waitForTimeout(1500);
const hb = (await p.locator('[data-testid="baseline-price"]').innerText()).replace(/\s+/g, " ");
const tip = await p.locator('[data-testid="baseline-price"]').getAttribute("title");
const tick = (await p.locator('[data-testid="quote-wti"]').innerText()).replace(/\s+/g, " ");
check(`header shows WTI BASELINE $${price.wti.toFixed(2)}, the EIA close (not the old $118 simulation)`, hb.includes("WTI BASELINE") && hb.includes(`$${price.wti.toFixed(2)}`) && !/MODEL BASELINE/.test(await p.locator("body").innerText()), `(${hb})`);
check(`header shows the source date inline: EIA ${price.as_of}`, hb.includes(`EIA ${price.as_of}`));
check("hover text: source (EIA Open Data v2, RWTC), date, age, status, and what it is used for", /EIA Open Data API v2/.test(tip) && /RWTC/.test(tip) && tip.includes(price.as_of) && tip.includes(price.status) && /WTI scenario card/.test(tip) && /never a live quote/.test(tip));
check("the same number as the ticker's WTI quote", tick.includes(price.wti.toFixed(2)));
await p.locator('[data-testid="markets-panel"]').scrollIntoViewIfNeeded();
await p.locator('[data-testid="markets-tab-commodities"]').click();
await p.waitForSelector('[data-testid="eia-card-wti"]');
check("the same number on the Markets WTI card", (await p.locator('[data-testid="eia-value-wti"]').innerText()).includes(price.wti.toFixed(2)));
await p.locator('[data-testid="wti-scenario-toggle"]').click();
await p.waitForSelector('[data-testid="wti-scenario"]');
const move = Math.round((5 / 0.15) * 100) / 100;
check("the WTI scenario number is built from that same close (default 5% supply loss)", (await p.locator('[data-testid="wti-scenario-value"]').innerText()) === `$${(price.wti * (1 + move / 100)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
await p.evaluate(() => window.scrollTo(0, 0));
await p.screenshot({ path: path.join(OUT, "fix2_header_baseline.png"), clip: { x: 0, y: 0, width: 1440, height: 110 } });
await p.close();

p = await newPage();
await p.route("**/api/v1/price/live", async (route) => { const r = await route.fetch(); const j = await r.json(); await route.fulfill({ json: { ...j, status: "OFFLINE_FALLBACK", as_of: "2026-08-18", age_days: 78, wti: 86.48 } }); });
await p.goto(`${BASE}/?view=map`, { waitUntil: "load" });
await p.waitForSelector('[data-testid="baseline-price"]', { timeout: 60000 });
await p.waitForTimeout(1200);
const fb = (await p.locator('[data-testid="baseline-price"]').innerText()).replace(/\s+/g, " ");
check("EIA fallback: the header says so (saved fallback, dated)", /saved fallback/.test(fb) && fb.includes("2026-08-18") && fb.includes("$86.48"), `(${fb})`);
await p.screenshot({ path: path.join(OUT, "fix2_header_baseline_fallback.png"), clip: { x: 0, y: 0, width: 1440, height: 110 } });
await p.close();

console.log("\n--- 3. the Results page and /simulate carry percentages only (no price baseline)");
p = await newPage();
await p.goto(`${BASE}/results?route=suez&type=detour&detour=20&dur=60&conf=5&dem=0&ev=100&li=10&horizon=5`, { waitUntil: "load" });
await p.waitForSelector('[data-testid="kpi-strip"]', { timeout: 60000 });
const kpiTxt = await p.locator('[data-testid="kpi-strip"]').innerText();
const sim = await (await fetch("http://127.0.0.1:8000/api/v1/simulate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ supply_loss_pct: 5, conflict_intensity: 6, detour_days: 3, demand_change_pct: 0 }) })).json();
check("Results KPI price is a percentage (+28.8%) and the price section has no dollar baseline", /\+28\.8%/.test(kpiTxt) && !/\$\s?\d/.test(await p.locator('[data-testid="section-price"]').innerText()));
check("/simulate returns a percentage only (33.33) and no price field", sim.predicted_price_change_pct === 33.33 && !Object.keys(sim).some((k) => /usd|baseline|crude_price/.test(k)), `(${Object.keys(sim).join(",")})`);
await p.close();

fs.writeFileSync(path.join(OUT, "fixes_console.txt"), logs.join(String.fromCharCode(10)));
const errors = logs.filter((l) => /\[(error|pageerror)\]/.test(l));
check("0 console errors", errors.length === 0, `(${errors.length})`);
errors.slice(0, 5).forEach((e) => console.log("   ", e.slice(0, 200)));
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
