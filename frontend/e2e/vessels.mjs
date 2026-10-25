// M7: simulated vessels in a real browser. Saves screenshots to SHOT_DIR and prints what it saw.
//   A. default view: badge, vessel count, fps context
//   B. zoomed in at Hormuz: simulated vessels, then click one -> panel
//   C. Suez detour scenario: vessels on Suez reroute along the Cape lane (amber), badge still visible
//   D. AIS mode with no key on the server: falls back to simulated, says so
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = process.env.SHOT_DIR;
const exe = path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe");
const browser = await chromium.launch({ executablePath: exe, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

const globeBox = async () => page.locator("canvas").first().boundingBox();
const shot = async (name, clip) => { await page.screenshot({ path: path.join(OUT, `${name}.png`), ...(clip ? { clip } : {}) }); console.log("saved", name); };
const look = (lat, lng, d) => page.evaluate(([a, b, c]) => window.__globe?.look(a, b, c), [lat, lng, d]);
const face = (lat, lng) => page.evaluate(([a, b]) => window.__globe?.face(a, b), [lat, lng]);
const project = (lat, lng) => page.evaluate(([a, b]) => window.__globe?.project(a, b), [lat, lng]);
const txt = async (id) => ((await page.locator(`[data-testid="${id}"]`).count()) ? (await page.locator(`[data-testid="${id}"]`).first().innerText()).replace(/\s+/g, " ") : null);
const globeClip = async () => { const b = await globeBox(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };

await page.goto("http://localhost:5173/", { waitUntil: "load" });
await page.waitForFunction(() => window.__vessels?.count > 0, null, { timeout: 60000 });
await page.waitForTimeout(2500);

// ---- A
console.log("A. vessel layer: kind", await page.evaluate(() => window.__vessels.kind), "| instances", await page.evaluate(() => window.__vessels.count));
console.log("A. badge:", await txt("vessel-badge"));
console.log("A. WebGL draw calls / triangles:", JSON.stringify(await page.evaluate(() => window.__globe.stats())));
await face(26.5, 56);
await page.waitForTimeout(500);
await shot("m7_0_default_view_badge", await globeClip());

// ---- B
await page.locator('[data-testid="vessel-info-button"]').hover();
await page.waitForTimeout(300);
await shot("m7_0b_info_tooltip", await globeClip());
console.log("B. info tooltip text:", await txt("vessel-info"));
await page.mouse.move(700, 600);
await look(26.2, 55.5, 3.3);
await page.waitForTimeout(400);
await look(26.2, 55.5, 3.3);
await page.waitForTimeout(150);
await shot("m7_1_sim_vessels_hormuz", await globeClip());
console.log("B. badge while zoomed:", await txt("vessel-badge"));

const b = await globeBox();
let picked = null;
for (let attempt = 0; attempt < 6 && !picked; attempt++) {
  await look(26.2, 55.5, 3.3);
  const near = await page.evaluate(() => window.__vessels.near(26.2, 55.5, 12));
  const ok = near.find((v) => v.x > 80 && v.x < b.width - 340 && v.y > 90 && v.y < b.height - 40);   // clear of the controls and the panel
  if (!ok) continue;
  await page.mouse.click(b.x + ok.x, b.y + ok.y);
  await page.waitForTimeout(600);
  if (await page.locator('[data-testid="vessel-panel"]').count()) picked = ok;
}
console.log("B. picked a vessel by a real mouse click:", picked ? JSON.stringify(picked) : "FAILED");
if (picked) {
  await page.mouse.move(b.x + 690, b.y + 470);   // off the Hormuz marker so its hover halo does not hide the selection ring
  await page.waitForTimeout(700);
  console.log("B. vessel panel:", await txt("vessel-panel"));
  console.log("B. cargo note present:", (await txt("vessel-cargo-note")) === "cargo type not confirmed by AIS");
  await shot("m7_2_vessel_selected_panel", await globeClip());
  await page.locator('[data-testid="vessel-panel-close"]').click();
}

// ---- C: Suez detour (needs the default zoom so the route click works)
await look(25, 40, 5.5);
await page.waitForTimeout(500);
const routes = (await (await fetch("http://localhost:5173/api/v1/routes")).json()).routes;
const suez = routes.find((r) => r.id === "suez");
let clicked = false;
for (let i = 0; i < suez.path.length - 1 && !clicked; i++) {
  for (let t = 0.1; t < 1 && !clicked; t += 0.2) {
    const lat = suez.path[i][0] + (suez.path[i + 1][0] - suez.path[i][0]) * t, lng = suez.path[i][1] + (suez.path[i + 1][1] - suez.path[i][1]) * t;
    await look(25, 40, 5.5);
    const q = await project(lat, lng);
    if (!q || !q.front) continue;
    const bb = await globeBox();
    // Alt-click always goes to the route, even where vessels sit on it
    await page.keyboard.down("Alt");
    await page.mouse.click(bb.x + q.x, bb.y + q.y);
    await page.keyboard.up("Alt");
    await page.waitForTimeout(3200);
    if (await page.locator('[data-testid="route-panel"]').count()) clicked = true;
  }
}
console.log("C. Alt-click opened the Suez route panel (routes still clickable under vessels):", clicked);
if (clicked) {
  await page.locator('[data-testid="route-panel"] button:has-text("detour")').click();
  await page.locator('[data-testid="simulate-on-route"]').click();
  await page.waitForTimeout(2500);
  await page.waitForTimeout(5000);   // let the 2.5 s glide finish
  await look(6, 36, 5.0);
  await page.waitForTimeout(300);
  await look(6, 36, 5.0);
  await shot("m7_3_reroute_suez_to_cape", await globeClip());
  await look(-12, 22, 3.5);
  await page.waitForTimeout(300);
  await look(-12, 22, 3.5);
  await shot("m7_3c_reroute_cape_closeup", await globeClip());
  const rer = await page.evaluate(() => { const v = window.__vessels; let n = 0, sample = null; for (let i = 0; i < v.count; i++) { const inf = v.info(i); if (inf.status.startsWith("rerouted")) { n++; sample ??= { i, ...inf }; } } return { n, sample }; });
  console.log("C. rerouted (internal check, not shown in the UI):", rer.n > 0 ? "yes" : "NO", "| sample status:", rer.sample?.status);
  console.log("C. badge during scenario:", await txt("vessel-badge"));
  await page.evaluate((i) => window.__vessels.select(i), rer.sample.i);
  await page.waitForTimeout(700);
  console.log("C. panel of a rerouted vessel:", await txt("vessel-panel"));
  await shot("m7_3b_reroute_vessel_panel", await globeClip());
}

// ---- D: AIS mode with no key
await page.goto("http://localhost:5173/", { waitUntil: "load" });
await page.waitForFunction(() => window.__vessels?.count > 0, null, { timeout: 60000 });
await page.locator('[data-testid="vessel-mode-ais"]').click();
await page.waitForFunction(() => document.querySelector('[data-testid="vessel-note"]')?.textContent?.includes("unavailable"), null, { timeout: 15000 });
console.log("D. AIS mode, no key:", await txt("vessel-note"), "| badge:", await txt("vessel-badge"));
await shot("m7_4_ais_mode_no_key", await globeClip());

fs.writeFileSync(path.join(OUT, "m7_console.txt"), logs.join("\n"));
const errors = logs.filter((l) => /\[(error|pageerror)\]/.test(l));
console.log("console errors:", errors.length);
errors.slice(0, 5).forEach((e) => console.log("   ", e.slice(0, 200)));
await browser.close();
