// Real-browser walkthrough of the M3 route layer. Saves screenshots to SHOT_DIR.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = process.env.SHOT_DIR;
const exe = path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe");
const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log("saved", name);
};
const project = (lat, lng) => page.evaluate(([a, b]) => window.__globe?.project(a, b), [lat, lng]);
const face = (lat, lng) => page.evaluate(([a, b]) => window.__globe?.face(a, b), [lat, lng]);
const tooltip = async () => ((await page.locator('[data-testid="route-tooltip"]').count()) > 0 ? await page.locator('[data-testid="route-tooltip"]').innerText() : null);

const routes = (await (await fetch("http://localhost:5173/api/v1/routes")).json()).routes;
const box = () => page.locator("canvas").first().boundingBox();

/** Hover a route: try points along its line (re-facing each time because the globe auto-rotates)
 * until the route tooltip for THIS route shows. Leaves the mouse there and returns the pixel. */
async function hoverRoute(id, faceLatLng) {
  const r = routes.find((x) => x.id === id);
  const b = await box();
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
      const tip = await tooltip();
      if (tip && tip.includes(r.name)) return { x, y, tip };
    }
  }
  return null;
}

await page.goto("http://localhost:5173/", { waitUntil: "load" });
await page.waitForTimeout(7000);
const FACE = [22, 50];

// 1. All routes drawn
await face(...FACE);
await page.waitForTimeout(400);
await shot("1_routes_drawn_gulf");

// 2. Hover tooltips: a lane (Hormuz) and a pipeline (East-West)
const hz = await hoverRoute("hormuz", FACE);
console.log("HORMUZ hover:", hz ? JSON.stringify(hz) : "FAILED");
if (hz) await shot("2_hover_tooltip_hormuz");
await page.mouse.move(5, 5);
await page.waitForTimeout(800);
const ew = await hoverRoute("east_west", FACE);
console.log("EAST_WEST hover:", ew ? JSON.stringify(ew) : "FAILED");
if (ew) await shot("2b_hover_tooltip_pipeline");
await page.mouse.move(5, 5);
await page.waitForTimeout(800);

// 3. Click Hormuz -> fly-to (mid-flight) -> panel
const hz2 = await hoverRoute("hormuz", FACE);
if (!hz2) throw new Error("could not re-hover hormuz");
await page.mouse.click(hz2.x, hz2.y);
await page.waitForTimeout(500);
await shot("3a_flyto_midflight");
await page.waitForTimeout(2400);
await shot("3b_clicked_route_panel_hormuz");
const panelText = await page.locator('[data-testid="route-panel"]').innerText();
fs.writeFileSync(path.join(OUT, "hormuz_panel_text.txt"), panelText);
console.log("panel shows current-conditions note:", (await page.locator('[data-testid="route-panel"] [data-testid="current-conditions"]').count()) > 0);
console.log("EIA links in panel:", await page.locator('[data-testid="route-panel"] [data-testid="current-conditions"] a').evaluateAll((as) => as.map((a) => a.href)));

// 4. Simulate on this route -> controls pre-filled, globe route turns crimson
await page.locator('[data-testid="simulate-on-route"]').click();
await page.waitForTimeout(3000);
await shot("4_simulate_prefilled_controls");
console.log("route select:", await page.locator('[data-testid="route-select"]').inputValue().catch(() => "n/a"));
console.log("blockade pressed:", await page.locator('[data-testid="type-blockade"]').getAttribute("aria-pressed"));
console.log("outside-validated warning shown:", (await page.locator('[data-testid="outside-validated"]').count()) > 0);
console.log("lithium help present:", (await page.locator('[data-testid="lithium-availability-help"]').count()) > 0);
console.log("route preview:", await page.locator('[data-testid="route-preview"]').innerText().catch(() => "n/a"));
console.log("price readout:", await page.locator('[data-testid="predicted-price-change"]').innerText());
await page.locator('[data-testid="route-scenario"]').scrollIntoViewIfNeeded();
await page.waitForTimeout(600);
await shot("4b_route_scenario_block");

fs.writeFileSync(path.join(OUT, "run_console.txt"), logs.join("\n"));
console.log("console errors:", logs.filter((l) => /\[(error|pageerror)\]/.test(l)).length);
await browser.close();
