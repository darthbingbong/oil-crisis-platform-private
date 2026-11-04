// M14 end-to-end: the 30-day outlook on the Results page, laptop and phone widths.   SHOT_DIR=<dir> node e2e/m14_view.mjs
// Needs: backend on :8000 and `npm run dev` on :5173. No AIS call and no TradingView request is made by anything here.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = process.env.SHOT_DIR;
const BASE = "http://localhost:5173";
const API = "http://127.0.0.1:8000/api/v1";
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
const SUEZ = "route=suez&type=detour&detour=20&dur=60&conf=5&dem=0&ev=100&li=10&horizon=5";
const HORMUZ = "route=hormuz&type=blockade&share=100&dur=30&conf=8&dem=0&ev=100&li=10&horizon=5";
const SHORT = "route=suez&type=detour&detour=20&dur=10&conf=5&dem=0&ev=100&li=10&horizon=5";
const BODY = {
  suez: { route_id: "suez", disruption_type: "detour", detour_days: 20, duration_days: 60, conflict_intensity: 5, demand_change_pct: 0, ev_substitution_rate_pct: 100, lithium_availability_pct: 10, horizon_years: 5 },
  hormuz: { route_id: "hormuz", disruption_type: "blockade", blocked_share_pct: 100, duration_days: 30, conflict_intensity: 8, demand_change_pct: 0, ev_substitution_rate_pct: 100, lithium_availability_pct: 10, horizon_years: 5 },
};
const api = async (b) => (await page0.request.post(`${API}/simulate/report`, { data: b })).json();
const page0 = await newPage(1440, 900);

async function results(p, q) {
  await p.goto(`${BASE}/results?${q}`, { waitUntil: "load" });
  await p.waitForSelector('[data-testid="section-price"]', { timeout: 60000 });
  await p.waitForSelector('[data-testid="chart-price"] svg', { timeout: 20000 });
  await p.waitForTimeout(1200);
}
const txt = async (p, sel) => ((await p.locator(sel).first().innerText()) || "").replace(/\s+/g, " ");
const BANNED = /half-life|half life|decay|\b180\b|\b90.day|90 days|one year|1.year|\bpeak\b/i;

for (const [name, q, key, width, height] of [["suez", SUEZ, "suez", 1440, 1000], ["hormuz", HORMUZ, "hormuz", 1440, 1000], ["suez", SUEZ, "suez", 390, 1800], ["hormuz", HORMUZ, "hormuz", 390, 1800]]) {
  const tag = `${name} ${width}px`;
  console.log(`\n--- ${tag}`);
  const p = await newPage(width, height);
  await results(p, q);
  const j = await api(BODY[key]);
  const priceSection = await txt(p, '[data-testid="section-price"]');
  const chart = p.locator('[data-testid="chart-price"]');
  await chart.locator(".recharts-xAxis-tick-labels text").first().waitFor({ state: "attached", timeout: 15000 });
  const ticks = (await chart.locator(".recharts-xAxis-tick-labels text").allTextContents()).map(Number);
  check(`${tag}: price chart x axis runs 0 to 30 only (ticks ${ticks.join(",")})`, Math.min(...ticks) === 0 && Math.max(...ticks) === 30);
  check(`${tag}: price section has no half-life, decay, 90 / 180-day, one-year or 'peak' wording`, !BANNED.test(priceSection), BANNED.test(priceSection) ? `(${priceSection.match(BANNED)})` : "");
  check(`${tag}: price section says 30 days is the only horizon and the line is an illustrative path`, /only horizon/.test(priceSection) && /illustrative path/.test(priceSection));
  const kpi = await txt(p, '[data-testid="kpi-price"]');
  const want = `${j.kpis.price_impact_pct >= 0 ? "+" : ""}${j.kpis.price_impact_pct.toFixed(1)}%`;
  check(`${tag}: headline KPI is the API's plain formula value ${want} and is labelled 30-day`, kpi.includes(want) && /30-day price impact/i.test(kpi), `(${kpi})`);
  const badge = await txt(p, '[data-testid="kpi-validation-badge"]');
  const chartBadge = await txt(p, '[data-testid="price-validation-badge"]');
  check(`${tag}: validation badge is the API's: ${j.kpis.validation_badge}`, badge.toUpperCase() === j.kpis.validation_badge.toUpperCase() && chartBadge.toUpperCase() === j.kpis.validation_badge.toUpperCase(), `(${badge})`);
  if (j.kpis.outside_validated_range) {
    check(`${tag}: outside the range: OUTSIDE VALIDATED RANGE, band not drawn, warning next to the number`, badge.toUpperCase() === "OUTSIDE VALIDATED RANGE" && (await p.locator('[data-testid="band-not-validated"]').count()) === 1 && (await p.locator('[data-testid="kpi-outside-warning"]').count()) === 1 && /not validated at this magnitude/.test(kpi));
  } else {
    check(`${tag}: inside the range: the plus or minus 13.09 pp is shown with the number and in the legend`, /± 13\.09 pp/.test(kpi) && /13\.09 pp measured error of the 30-day figure/.test(await txt(p, '[data-testid="section-price"]')));
    check(`${tag}: inside the range: no 'not validated' text`, (await p.locator('[data-testid="band-not-validated"]').count()) === 0);
  }
  check(`${tag}: no horizontal page scroll`, await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await p.locator('[data-testid="section-price"]').screenshot({ path: path.join(OUT, `results_price_${name}_${width}.png`) });
  console.log("      saved", `results_price_${name}_${width}`);
  if (width === 1440) await p.screenshot({ path: path.join(OUT, `results_top_${name}_${width}.png`) });
  await p.close();
}

console.log("\n--- a 10-day disruption: the 30-day figure must not depend on the duration");
const p10 = await newPage(1440, 1000);
await results(p10, SHORT);
const j10 = await api({ ...BODY.suez, duration_days: 10 });
const j60 = await api(BODY.suez);
check("10-day and 60-day disruptions give the same 30-day KPI and the same trajectory", j10.kpis.price_impact_pct === j60.kpis.price_impact_pct && JSON.stringify(j10.sections.price.chart.trajectory) === JSON.stringify(j60.sections.price.chart.trajectory));
check("the 10-day page shows the same headline as the 60-day API value", (await txt(p10, '[data-testid="kpi-price"]')).includes(`+${j60.kpis.price_impact_pct.toFixed(1)}%`));
await p10.close();

console.log("\n--- the dashboard's scenario panel names the horizon");
const dash = await newPage(1440, 1000);
await dash.goto(`${BASE}/?view=map`, { waitUntil: "load" });
await dash.waitForSelector('[data-testid="predicted-price-change"]', { timeout: 60000 });
check("scenario panel label says 'over 30 days'", /over 30 days/i.test(await dash.locator("body").innerText()));
await dash.close();

console.log("\n--- API fields");
check("API: no half_life_days anywhere in the price section; horizon_days is 30", !JSON.stringify(j60.sections.price).includes("half_life") && j60.sections.price.numbers.horizon_days === 30 && j60.sections.price.chart.horizon_days === 30);
check("API: the price trajectory has 31 points (days 0 to 30)", j60.sections.price.chart.trajectory.length === 31);
check("API: old keys kept: kpis.price_impact_pct, numbers.peak_pct, chart.trajectory with pct/low/high/beyond_validated", "price_impact_pct" in j60.kpis && "peak_pct" in j60.sections.price.numbers && ["pct", "low", "high", "beyond_validated"].every((k) => k in j60.sections.price.chart.trajectory[0]));

fs.writeFileSync(path.join(OUT, "m14_console.txt"), logs.join(String.fromCharCode(10)));
const errors = logs.filter((l) => /\[(error|pageerror)\]/.test(l));
check("0 console errors across the whole run", errors.length === 0, `(${errors.length})`);
errors.slice(0, 6).forEach((e) => console.log("     ", e.slice(0, 260)));
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
