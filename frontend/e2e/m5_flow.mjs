// M5: the full flow map -> route panel -> Simulate on this route -> Run full simulation -> /results -> Edit scenario -> controls restored,
// plus the Cape of Good Hope panel (alternate lane: a note instead of a Simulate button).
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
const shot = async (name, full = false) => { await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full }); console.log("saved", name); };
const routes = (await (await fetch(`${BASE}/api/v1/routes`)).json()).routes;
const project = (lat, lng) => page.evaluate(([a, b]) => window.__globe?.project(a, b), [lat, lng]);
const face = (lat, lng) => page.evaluate(([a, b]) => window.__globe.face(a, b), [lat, lng]);

async function openRoute(id, faceLatLng) {
  const r = routes.find((x) => x.id === id);
  const b = await page.locator("canvas").first().boundingBox();
  for (let i = 0; i < r.path.length - 1; i++) {
    for (let t = 0.05; t < 1; t += 0.15) {
      const lat = r.path[i][0] + (r.path[i + 1][0] - r.path[i][0]) * t;
      const lng = r.path[i][1] + (r.path[i + 1][1] - r.path[i][1]) * t;
      await face(...faceLatLng);
      const q = await project(lat, lng);
      if (!q || !q.front) continue;
      const x = b.x + q.x, y = b.y + q.y;
      if (x < b.x + 10 || x > b.x + b.width - 10 || y < b.y + 10 || y > b.y + b.height - 10) continue;
      if ((await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.tagName, [x, y])) !== "CANVAS") continue;
      await page.mouse.move(x - 12, y - 4);
      await page.mouse.move(x, y, { steps: 2 });
      await page.waitForTimeout(250);
      if ((await page.locator('[data-testid="route-tooltip"]').count()) && (await page.locator('[data-testid="route-tooltip"]').innerText()).includes(r.name)) {
        await page.mouse.click(x, y);
        await page.waitForTimeout(3200);
        return true;
      }
    }
  }
  return false;
}
const back = async () => { await page.locator('[data-testid="route-panel"] button', { hasText: "Back to overview" }).click(); await page.waitForTimeout(1800); };

await page.goto(`${BASE}/`, { waitUntil: "load" });
await page.waitForTimeout(7000);

// 1. Cape of Good Hope: no Simulate button, a one-line note instead; still clickable for its stats
if (!(await openRoute("cape_good_hope", [-25, 22]))) throw new Error("could not open the Cape panel");
await page.locator('[data-testid="alternate-lane-note"]').scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await shot("m5_08_cape_panel_note");
console.log("CAPE simulate button present:", (await page.locator('[data-testid="simulate-on-route"]').count()) > 0, "| note:", (await page.locator('[data-testid="alternate-lane-note"]').innerText()));
console.log("CAPE panel still shows stats:", /annual flow/i.test(await page.locator('[data-testid="route-panel"]').innerText()));
await back();

// 2. Hormuz -> Simulate on this route -> Run full simulation
if (!(await openRoute("hormuz", [22, 50]))) throw new Error("could not open the Hormuz panel");
await page.locator('[data-testid="simulate-on-route"]').click();
await page.waitForTimeout(3000);
await page.locator('[data-testid="route-scenario"]').scrollIntoViewIfNeeded();
await page.waitForFunction(() => !document.querySelector('[data-testid="run-full-simulation"]')?.disabled, null, { timeout: 30000 });
await shot("m5_09_dashboard_run_full_simulation_button");
await page.locator('[data-testid="run-full-simulation"]').click();
await page.waitForSelector('[data-testid="kpi-strip"]', { timeout: 60000 });
console.log("RESULTS url:", page.url().replace(BASE, ""));
console.log("RESULTS route:", await page.locator('[data-testid="results-route"]').innerText(), "| price KPI:", (await page.locator('[data-testid="kpi-price"]').innerText()).replace(/\n/g, " | "));

// 3. Edit scenario -> back on the map with the controls restored and a tidy address
await page.locator('[data-testid="edit-scenario"]').click();
await page.waitForSelector('[data-testid="route-select"]', { timeout: 20000 });
await page.waitForTimeout(1500);
console.log("EDIT dashboard url:", page.url().replace(BASE, "") || "/", "| route select:", await page.locator('[data-testid="route-select"]').inputValue(),
  "| blockade pressed:", await page.locator('[data-testid="type-blockade"]').getAttribute("aria-pressed"));
await page.locator('[data-testid="route-scenario"]').scrollIntoViewIfNeeded();
await shot("m5_10_edit_scenario_restored");

// 4. a detour scenario with the user's own detour days survives the round trip
await page.goto(`${BASE}/results?route=suez&type=detour&detour=20&dur=60&conf=7&dem=5&ev=80&li=30&horizon=3`, { waitUntil: "load" });
await page.waitForSelector('[data-testid="kpi-strip"]', { timeout: 60000 });
await page.locator('[data-testid="edit-scenario"]').click();
await page.waitForSelector('[data-testid="route-select"]', { timeout: 20000 });
await page.waitForTimeout(1500);
const sliderVal = async (label) => page.locator(`input[aria-label="${label}"]`).inputValue();
console.log("EDIT (suez detour) route:", await page.locator('[data-testid="route-select"]').inputValue(), "| detour pressed:", await page.locator('[data-testid="type-detour"]').getAttribute("aria-pressed"),
  "| detour days:", await sliderVal("Detour (extra voyage days)"), "| duration:", await sliderVal("Disruption duration"), "| lithium:", await sliderVal("Lithium availability"),
  "| conflict:", await sliderVal("Conflict intensity"), "| demand:", await sliderVal("Demand change"));
await page.locator('[data-testid="run-full-simulation"]').scrollIntoViewIfNeeded();
await page.waitForFunction(() => !document.querySelector('[data-testid="run-full-simulation"]')?.disabled, null, { timeout: 30000 });
await page.locator('[data-testid="run-full-simulation"]').click();
await page.waitForSelector('[data-testid="kpi-strip"]', { timeout: 60000 });
console.log("ROUND TRIP url:", page.url().replace(BASE, ""));

fs.writeFileSync(path.join(OUT, "m5_flow_console.txt"), logs.join("\n"));
const errors = logs.filter((l) => /\[(error|pageerror)\]/.test(l));
console.log("console errors:", errors.length);
errors.slice(0, 4).forEach((e) => console.log("  ", e.slice(0, 180)));
await browser.close();
