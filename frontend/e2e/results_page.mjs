// M5: the Results page in a real browser. Screenshots to SHOT_DIR; every check prints a line; console errors must be 0.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = process.env.SHOT_DIR;
const BASE = "http://localhost:5173";
const exe = path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe");
const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"],
});
const logs = [];
async function openPage(width = 1280, height = 900) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  return page;
}
const shot = async (page, name, full = true) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
  console.log("saved", name);
};
const text = (page, id) => page.locator(`[data-testid="${id}"]`).first().innerText();
async function loadResults(page, query) {
  await page.goto(`${BASE}/results?${query}`, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="kpi-strip"], [data-testid="results-invalid"], [data-testid="results-rejected"], [data-testid="results-offline"]', { timeout: 60000 });
  await page.waitForTimeout(800);
}

const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : ["suez", "hormuz", "noimporters", "pipeline", "invalid", "refresh", "tablet"];
const SUEZ = "route=suez&type=detour&detour=20&dur=60&conf=5&dem=0&ev=100&li=10&horizon=5";

if (ONLY.includes("suez")) {
  const page = await openPage();
  await loadResults(page, SUEZ);
  await shot(page, "m5_01_suez_20day_detour");
  console.log("SUEZ header route:", await text(page, "results-route"));
  console.log("SUEZ baseline chip:", await text(page, "chip-baseline"));
  console.log("SUEZ detour line:", await text(page, "detour-days"));
  for (const k of ["kpi-price", "kpi-displaced", "kpi-evs", "kpi-lithium", "kpi-deficit"]) console.log(`SUEZ ${k}:`, (await text(page, k)).replace(/\n/g, " | "));
  console.log("SUEZ sections present:", await page.locator('section[data-testid^="section-"]').count());
  console.log("SUEZ outside-validated banner:", (await page.locator('[data-testid="kpi-outside-warning"]').count()) > 0);
  await page.close();
}

if (ONLY.includes("hormuz")) {
  const page = await openPage();
  await loadResults(page, "route=hormuz&type=blockade&share=100&dur=30&conf=5&dem=0&ev=100&li=10&horizon=5");
  await shot(page, "m5_02_hormuz_full_blockade");
  console.log("HORMUZ kpi-price:", (await text(page, "kpi-price")).replace(/\n/g, " | "));
  console.log("HORMUZ outside banner:", (await page.locator('[data-testid="kpi-outside-warning"]').count()) > 0);
  console.log("HORMUZ band-not-validated label:", (await page.locator('[data-testid="band-not-validated"]').count()) > 0);
  console.log("HORMUZ bypass sensitivity table:", (await text(page, "bypass-sensitivity")).replace(/\n/g, " | ").slice(0, 200));
  // the price chart on its own, for a close look at the dashed part / reference line
  await page.locator('[data-testid="section-price"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.locator('[data-testid="section-price"]').screenshot({ path: path.join(OUT, "m5_02b_hormuz_price_section.png") });
  console.log("saved m5_02b_hormuz_price_section");
  const dashed = await page.locator('[data-testid="chart-price"] path[stroke-dasharray="7 5"]').count();
  console.log("HORMUZ dashed beyond-validated line segments in the chart:", dashed);
  await page.close();
}

if (ONLY.includes("noimporters")) {
  const page = await openPage();
  await loadResults(page, "route=danish_straits&type=detour&detour=5&dur=30");
  await page.locator('[data-testid="section-importers"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="section-importers"]').screenshot({ path: path.join(OUT, "m5_03_no_importer_data.png") });
  console.log("saved m5_03_no_importer_data");
  console.log("NO-IMPORTERS message shown:", (await page.locator('[data-testid="importers-not-available"]').count()) > 0, "| chart absent:", (await page.locator('[data-testid="chart-importers"]').count()) === 0);
  await page.close();
}

if (ONLY.includes("pipeline")) {
  const page = await openPage();
  await loadResults(page, "route=east_west&type=blockade&share=100");
  await shot(page, "m5_04_pipeline_rejected", false);
  console.log("PIPELINE rejected card:", (await page.locator('[data-testid="results-rejected"]').count()) > 0, "|", (await text(page, "results-rejected")).replace(/\n/g, " ").slice(0, 260));
  console.log("PIPELINE back/edit buttons still present:", (await page.locator('[data-testid="back-to-map"]').count()) > 0);
  await page.close();
}

if (ONLY.includes("invalid")) {
  const page = await openPage();
  await loadResults(page, "route=suez&type=sideways&share=abc&dur=-4");
  await shot(page, "m5_05a_invalid_params", false);
  console.log("INVALID card:", (await page.locator('[data-testid="results-invalid"]').count()) > 0, "|", (await text(page, "results-invalid")).replace(/\n/g, " ").slice(0, 400));
  await loadResults(page, "");
  await shot(page, "m5_05b_missing_route", false);
  console.log("MISSING route card:", (await text(page, "results-invalid")).replace(/\n/g, " ").slice(0, 160));
  await loadResults(page, "route=nowhere&type=blockade");
  console.log("UNKNOWN route card:", (await text(page, "results-rejected")).replace(/\n/g, " ").slice(0, 200));
  await shot(page, "m5_05c_unknown_route", false);
  await page.close();
}

if (ONLY.includes("refresh")) {
  const page = await openPage();
  await loadResults(page, SUEZ);
  const before = { price: await text(page, "kpi-price"), displaced: await text(page, "kpi-displaced"), route: await text(page, "results-route"), detour: await text(page, "detour-days") };
  const url1 = page.url();
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector('[data-testid="kpi-strip"]', { timeout: 60000 });
  await page.waitForTimeout(800);
  const after = { price: await text(page, "kpi-price"), displaced: await text(page, "kpi-displaced"), route: await text(page, "results-route"), detour: await text(page, "detour-days") };
  await shot(page, "m5_06_after_refresh", false);
  console.log("REFRESH url unchanged:", page.url() === url1, "| same content:", JSON.stringify(before) === JSON.stringify(after));
  // changing the lithium availability updates the URL and the numbers, and survives a reload too
  const slider = page.locator('[data-testid="lithium-control"] input[type="range"]');
  await slider.evaluate((el) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, "60"); el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.waitForFunction(() => location.search.includes("li=60"), null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  console.log("LITHIUM slider -> URL has li=60:", page.url().includes("li=60"), "| deficit now:", (await text(page, "kpi-deficit")).replace(/\n/g, " | "));
  await page.close();
}

if (ONLY.includes("tablet")) {
  const page = await openPage(820, 1100);
  await loadResults(page, "route=hormuz&type=blockade&share=100&dur=30");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log("TABLET (820px) horizontal overflow px:", overflow);
  await shot(page, "m5_07_tablet_820");
  await page.close();
}

fs.writeFileSync(path.join(OUT, "m5_console.txt"), logs.join("\n"));
const errors = logs.filter((l) => /\[(error|pageerror)\]/.test(l));
console.log("console errors:", errors.length);
errors.slice(0, 5).forEach((e) => console.log("  ", e.slice(0, 200)));
await browser.close();
