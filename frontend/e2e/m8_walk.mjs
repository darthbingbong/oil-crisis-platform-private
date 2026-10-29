// M8: walk the whole app like a first-time user at one viewport width. Saves screenshots and prints objective checks
// (horizontal overflow, clipped text, controls without a keyboard focus ring, console errors).
//   W=1440 H=900 TAG=laptop SHOT_DIR=../docs/m8_screenshots node e2e/m8_walk.mjs
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = process.env.SHOT_DIR;
const W = Number(process.env.W ?? 1440), H = Number(process.env.H ?? 900), TAG = process.env.TAG ?? "laptop";
const BASE = "http://localhost:5173";
const exe = path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe");
const browser = await chromium.launch({ executablePath: exe, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
const shot = async (name, full = false) => { await page.screenshot({ path: path.join(OUT, `${TAG}_${name}.png`), fullPage: full }); console.log("saved", `${TAG}_${name}`); };
const look = (lat, lng, d) => page.evaluate(([a, b, c]) => window.__globe?.look(a, b, c), [lat, lng, d]);
const project = (lat, lng) => page.evaluate(([a, b]) => window.__globe?.project(a, b), [lat, lng]);

/** Objective checks on the current page. */
async function audit(label) {
  const r = await page.evaluate(() => {
    const out = { hScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, clipped: [], tiny: [], noName: [] };
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || !el.getBoundingClientRect().width) continue;
      const txt = (el.childElementCount === 0 ? el.textContent ?? "" : "").trim();
      if (txt && el.scrollWidth > el.clientWidth + 2 && cs.overflowX !== "visible" && cs.textOverflow !== "ellipsis") out.clipped.push(`${el.tagName}.${(el.className || "").toString().slice(0, 30)}: "${txt.slice(0, 40)}"`);
      if (txt && parseFloat(cs.fontSize) < 10) out.tiny.push(`${parseFloat(cs.fontSize)}px "${txt.slice(0, 30)}"`);
    }
    for (const el of document.querySelectorAll("button, a[href], input, select, [role=button]")) {
      const name = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("title") || el.getAttribute("placeholder") || "").trim();
      if (!name && el.getBoundingClientRect().width) out.noName.push(`${el.tagName}.${(el.className || "").toString().slice(0, 30)}`);
    }
    return out;
  });
  console.log(`[${TAG}] AUDIT ${label}: horizontal overflow ${r.hScroll}px | clipped text ${r.clipped.length} ${JSON.stringify(r.clipped.slice(0, 4))} | text <10px ${r.tiny.length} ${JSON.stringify(r.tiny.slice(0, 3))} | unnamed controls ${r.noName.length} ${JSON.stringify(r.noName.slice(0, 3))}`);
}

// ---- 1. dashboard
await page.goto(`${BASE}/`, { waitUntil: "load" });
await page.waitForSelector('[data-testid="price-ticker"]', { timeout: 60000 });
await page.waitForFunction(() => window.__vessels?.count > 0, null, { timeout: 60000 });
await page.waitForTimeout(3000);
await shot("01_dashboard");
await audit("dashboard");
await shot("01b_dashboard_full", true);

// ---- 2. route hover + click (Hormuz)
await page.mouse.click(5, 5);
await look(25, 52, 5.5);
await page.waitForTimeout(500);
const routes = (await (await fetch(`${BASE}/api/v1/routes`)).json()).routes;
const hz = routes.find((r) => r.id === "hormuz");
await page.evaluate(() => window.scrollTo(0, 0));          // the Tab presses above may have scrolled the page on a narrow viewport
await page.waitForTimeout(300);
const box = await page.locator("canvas").first().boundingBox();
let at = null;
for (let i = 0; i < hz.path.length - 1 && !at; i++) {
  await look(25, 52, 5.5);
  const lat = (hz.path[i][0] + hz.path[i + 1][0]) / 2, lng = (hz.path[i][1] + hz.path[i + 1][1]) / 2;
  const q = await project(lat, lng);
  if (!q || !q.front) continue;
  const x = box.x + q.x, y = box.y + q.y;
  await page.keyboard.down("Alt");     // always the route, even where vessels sit on it
  await page.mouse.move(x - 8, y - 3); await page.mouse.move(x, y, { steps: 3 });
  await page.waitForTimeout(450);
  if (await page.locator('[data-testid="route-tooltip"]').count()) { at = { x, y }; await shot("02_route_hover"); }
  await page.keyboard.up("Alt");
}
console.log(`[${TAG}] route hover tooltip:`, at ? "shown" : "NOT FOUND");
if (at) {
  await page.keyboard.down("Alt"); await page.mouse.click(at.x, at.y); await page.keyboard.up("Alt");
  await page.waitForTimeout(3500);
  await shot("03_route_panel");
  await audit("route panel");
  const panel = page.locator('[data-testid="route-panel"]');
  console.log(`[${TAG}] route panel shown:`, (await panel.count()) > 0, "| news section:", (await page.locator('[data-testid="route-news"]').count()) > 0);
  await panel.evaluate((el) => el.scrollTo?.(0, el.scrollHeight)).catch(() => {});
  await page.waitForTimeout(500);
  await shot("04_route_panel_news_scrolled");
  await page.locator('[data-testid="simulate-on-route"]').scrollIntoViewIfNeeded();
  await page.locator('[data-testid="simulate-on-route"]').click();
  await page.waitForTimeout(3000);
  await page.locator('[data-testid="route-scenario"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await shot("05_scenario_block");
  await audit("scenario block");
  // ---- 3. Results
  await page.locator('[data-testid="run-full-simulation"]').scrollIntoViewIfNeeded();
  await page.locator('[data-testid="run-full-simulation"]').click();
  await page.waitForSelector('[data-testid="kpi-strip"], [data-testid="results-rejected"]', { timeout: 60000 });
  await page.waitForTimeout(1500);
  await shot("06_results_top");
  await shot("06b_results_full", true);
  await audit("results");
}

// ---- 4. Results for a known scenario (Suez 20-day detour), then back
await page.goto(`${BASE}/results?route=suez&type=detour&detour=20&dur=60&conf=5&dem=0&ev=100&li=10&horizon=5`, { waitUntil: "load" });
await page.waitForSelector('[data-testid="kpi-strip"]', { timeout: 60000 });
await page.waitForTimeout(1200);
await shot("07_results_suez_full", true);
await audit("results suez");

// ---- 5. vessels (zoomed)
await page.goto(`${BASE}/`, { waitUntil: "load" });
await page.waitForFunction(() => window.__vessels?.count > 0, null, { timeout: 60000 });
for (let i = 0; i < 3; i++) { await look(26.2, 55.5, 3.3); await page.waitForTimeout(300); }
await shot("08_vessels_hormuz");

// ---- keyboard: tab through the page and record what receives focus
const focus = [];
await page.evaluate(() => window.scrollTo(0, 0));
await page.mouse.click(5, 5);
for (let i = 0; i < 45; i++) {
  await page.keyboard.press("Tab");
  const f = await page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e); return { tag: e.tagName, name: (e.getAttribute("aria-label") || e.textContent || e.getAttribute("data-testid") || "").trim().slice(0, 36), outline: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0, shadow: cs.boxShadow !== "none" }; });
  if (f) focus.push(f);
}
console.log(`[${TAG}] KEYBOARD: ${focus.length} tab stops in 45 presses; visible focus indicator (outline or shadow) on ${focus.filter((f) => f.outline || f.shadow).length}`);
console.log(`[${TAG}] KEYBOARD without visible indicator:`, JSON.stringify(focus.filter((f) => !f.outline && !f.shadow).map((f) => `${f.tag}:${f.name}`).slice(0, 12)));
console.log(`[${TAG}] KEYBOARD stops:`, JSON.stringify(focus.slice(0, 40).map((f) => f.name || f.tag)));


fs.writeFileSync(path.join(OUT, `${TAG}_console.txt`), logs.join("\n"));
const errors = logs.filter((l) => /\[(error|pageerror)\]/.test(l));
console.log(`[${TAG}] console errors:`, errors.length);
errors.slice(0, 5).forEach((e) => console.log("   ", e.slice(0, 220)));
await browser.close();
