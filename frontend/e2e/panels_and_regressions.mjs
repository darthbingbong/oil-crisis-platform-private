// M3 walkthrough part 2: pipelines, n/a, no-importer message, existing flows still work, FPS.
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

async function open(opts = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = [];
  page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  if (opts.blockRoutes) await page.route("**/api/v1/routes", (r) => r.abort());
  await page.goto("http://localhost:5173/", { waitUntil: "load" });
  await page.waitForTimeout(7000);
  return { page, logs };
}

const routes = (await (await fetch("http://localhost:5173/api/v1/routes")).json()).routes;

async function hoverRoute(page, id, faceLatLng) {
  const r = routes.find((x) => x.id === id);
  const b = await page.locator("canvas").first().boundingBox();
  for (let i = 0; i < r.path.length - 1; i++) {
    for (let t = 0.05; t < 1; t += 0.15) {
      const lat = r.path[i][0] + (r.path[i + 1][0] - r.path[i][0]) * t;
      const lng = r.path[i][1] + (r.path[i + 1][1] - r.path[i][1]) * t;
      await page.evaluate(([a, c]) => window.__globe.face(a, c), faceLatLng);
      const q = await page.evaluate(([a, c]) => window.__globe.project(a, c), [lat, lng]);
      if (!q || !q.front) continue;
      const x = b.x + q.x, y = b.y + q.y;
      if (x < b.x + 10 || x > b.x + b.width - 10 || y < b.y + 10 || y > b.y + b.height - 10) continue;
      if ((await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.tagName, [x, y])) !== "CANVAS") continue;
      await page.mouse.move(x - 12, y - 4);
      await page.mouse.move(x, y, { steps: 2 });
      await page.waitForTimeout(250);
      const n = await page.locator('[data-testid="route-tooltip"]').count();
      if (n && (await page.locator('[data-testid="route-tooltip"]').innerText()).includes(r.name)) return { x, y };
    }
  }
  return null;
}

async function openPanel(page, id, faceLatLng, name) {
  const h = await hoverRoute(page, id, faceLatLng);
  if (!h) { console.log(`${id}: could not hover`); return false; }
  await page.mouse.click(h.x, h.y);
  await page.waitForTimeout(3200);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log("saved", name);
  return true;
}

async function backToOverview(page) {
  await page.locator('[data-testid="route-panel"] button', { hasText: "Back to overview" }).click();
  await page.waitForTimeout(1800);
}

// ---------------------------------------------------------------- A. interaction cases
{
  const { page, logs } = await open();
  await page.evaluate(() => window.__globe.face(22, 50));
  await page.waitForTimeout(300);

  // pipeline: East-West
  if (await openPanel(page, "east_west", [22, 50], "5_panel_pipeline_east_west")) {
    const t = await page.locator('[data-testid="route-panel"]').innerText();
    console.log("PIPELINE panel -> nameplate capacity:", /nameplate capacity/i.test(t), "| 'Annual flow' absent:", !/annual flow/i.test(t),
      "| throughput not available:", /not available/i.test(t), "| simulate button absent:", (await page.locator('[data-testid="simulate-on-route"]').count()) === 0,
      "| no-sim note:", (await page.locator('[data-testid="pipeline-no-sim"]').count()) > 0);
    await backToOverview(page);
  }

  // Druzhba: n/a
  await page.evaluate(() => window.__globe.face(52, 30));
  await page.waitForTimeout(300);
  if (await openPanel(page, "druzhba", [52, 30], "6_panel_druzhba_na")) {
    const t = await page.locator('[data-testid="route-panel"]').innerText();
    console.log("DRUZHBA panel -> n/a shown:", (await page.locator('[data-testid="route-na"]').count()) > 0, "| no numbers:", !/Mb\/d/.test(t.split("Source:")[0]),
      "| simulate absent:", (await page.locator('[data-testid="simulate-on-route"]').count()) === 0);
    await backToOverview(page);
  }

  // Bab el-Mandeb: no importer data -> "not available" message instead of an empty chart
  await page.evaluate(() => window.__globe.face(14, 43));
  await page.waitForTimeout(300);
  if (await openPanel(page, "bab_el_mandeb", [14, 43], "7_panel_no_importers_bab_el_mandeb")) {
    console.log("BAB panel -> 'not available' importer message:", (await page.locator('[data-testid="importers-na"]').count()) > 0,
      "| importer chart absent:", (await page.locator('[data-testid="importer-chart"]').count()) === 0,
      "| baseline label:", (await page.locator('[data-testid="route-panel"]').innerText()).match(/ANNUAL FLOW \(\d+\)/i)?.[0]);
    await backToOverview(page);
  }
  fs.writeFileSync(path.join(OUT, "run2_console.txt"), logs.join("\n"));
  console.log("console errors (A):", logs.filter((l) => /\[(error|pageerror)\]/.test(l)).length);
  await page.close();
}

// ---------------------------------------------------------------- B. existing flows must still work
{
  const { page, logs } = await open();
  await page.evaluate(() => window.__globe.face(26.5, 56));
  await page.waitForTimeout(300);
  // existing marker click (Hormuz chokepoint marker) -> full-bleed LocationDetail, with the current-conditions note
  const markerBtn = page.locator('button[aria-label^="Hormuz"]').first();
  console.log("Hormuz marker button present:", (await markerBtn.count()) > 0);
  await markerBtn.click({ force: true });
  await page.waitForTimeout(3200);
  await page.screenshot({ path: path.join(OUT, "8_existing_marker_hormuz_detail.png") });
  console.log("existing LocationDetail visible:", await page.locator('[data-testid="location-detail"]').evaluate((e) => getComputedStyle(e).opacity));
  console.log("Hormuz location view shows current-conditions note:", (await page.locator('[data-testid="location-detail"] [data-testid="current-conditions"]').count()) > 0);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1800);

  // existing /refineries/at-risk flow via the sidebar ChokepointPanel
  const chokeBtn = page.getByRole("button", { name: /^Hormuz/i }).first();
  console.log("ChokepointPanel Hormuz button count:", await chokeBtn.count());
  const atRisk = page.waitForResponse((r) => r.url().includes("/refineries/at-risk/"), { timeout: 8000 }).catch(() => null);
  await chokeBtn.scrollIntoViewIfNeeded().catch(() => {});
  await chokeBtn.click().catch((e) => console.log("chokepoint click:", e.message.slice(0, 80)));
  const resp = await atRisk;
  console.log("GET /refineries/at-risk called:", resp ? `${resp.status()} ${resp.url().split("/api")[1]}` : "NO REQUEST");
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, "9_existing_chokepoint_panel.png") });
  fs.writeFileSync(path.join(OUT, "run2b_console.txt"), logs.join("\n"));
  console.log("console errors (B):", logs.filter((l) => /\[(error|pageerror)\]/.test(l)).length);
  await page.close();
}

// ---------------------------------------------------------------- C. extrapolation warning next to the big number
{
  const { page } = await open();
  await page.locator('input[aria-label="Supply loss"]').evaluate((el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(el, "15"); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(1500);
  await page.locator('[data-testid="predicted-price-change"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  console.log("manual 15% supply loss -> warning shown:", (await page.locator('[data-testid="outside-validated"]').count()) > 0,
    "| price:", await page.locator('[data-testid="predicted-price-change"]').innerText());
  await page.screenshot({ path: path.join(OUT, "10_outside_validated_warning.png") });
  await page.close();
}

// ---------------------------------------------------------------- D. frame rate
async function fps(page, secs = 6) {
  return page.evaluate((s) => new Promise((resolve) => {
    let frames = 0; const t0 = performance.now(); const times = [];
    let last = t0;
    function tick(t) { frames++; times.push(t - last); last = t; if (t - t0 < s * 1000) requestAnimationFrame(tick); else resolve({ fps: +(frames / ((t - t0) / 1000)).toFixed(1), worstFrameMs: +Math.max(...times).toFixed(0), medianFrameMs: +times.sort((a, b) => a - b)[Math.floor(times.length / 2)].toFixed(1) }); }
    requestAnimationFrame(tick);
  }), secs);
}
{
  const base = await open({ blockRoutes: true });
  const baseFps = await fps(base.page);
  const baseStats = await base.page.evaluate(() => window.__globe?.stats());
  await base.page.close();
  const withR = await open();
  const routeFps = await fps(withR.page);
  const routeStats = await withR.page.evaluate(() => window.__globe?.stats());
  console.log("FPS baseline (no routes drawn):", JSON.stringify(baseFps), "render:", JSON.stringify(baseStats));
  console.log("FPS with all 14 routes drawn:  ", JSON.stringify(routeFps), "render:", JSON.stringify(routeStats));
  await withR.page.close();
}
await browser.close();
