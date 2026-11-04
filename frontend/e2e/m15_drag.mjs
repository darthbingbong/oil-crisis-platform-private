// Drag speed of the 2D map: frames per second DURING a drag, and (with PROFILE=1) where the time goes.   node e2e/m15_drag.mjs
// Same setup as the earlier measurements: all layers on, 1440x900, Chromium with software WebGL (SwiftShader); a lower bound.
import { chromium } from "playwright-core";
import os from "node:os";
import path from "node:path";

const exe = path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe");
const browser = await chromium.launch({ executablePath: exe, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const zoom = Number(process.env.ZOOM ?? 2);
await page.addInitScript(() => {
  window.__draws = new Map();
  for (const name of ["drawArraysInstanced", "drawElementsInstanced", "drawArrays", "drawElements"]) {
    const orig = WebGL2RenderingContext.prototype[name]; if (!orig) continue;
    WebGL2RenderingContext.prototype[name] = function (...a) { const id = this.canvas?.id || "?"; window.__draws.set(id, (window.__draws.get(id) ?? 0) + 1); return orig.apply(this, a); };
  }
});
await page.goto(`http://localhost:5173/?view=map&lat=26.57&lon=56.25&zoom=${zoom}&layers=${process.env.LAYERS ?? "routes,chokepoints,places,watchlist,simulated,scenario"}`, { waitUntil: "load" });
await page.waitForSelector('[data-testid="map-view"]', { timeout: 60000 });
await page.waitForFunction(() => window.__map?.simCount?.() > 0, null, { timeout: 60000 });
await page.waitForTimeout(4000);

if (process.env.HIDE_BASE) await page.evaluate(() => { const c = document.querySelectorAll("canvas"); console.log("canvases", c.length); c[0].parentElement.style.display = "none"; });
await page.evaluate(() => {
  window.__frames = []; let last = performance.now();
  const tick = (now) => { window.__frames.push(now - last); last = now; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
const cdp = process.env.PROFILE ? await page.context().newCDPSession(page) : null;
if (cdp) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 500 }); await cdp.send("Profiler.start"); }
await page.evaluate(() => { window.__frames.length = 0; window.__draws.clear(); });
const before = await page.evaluate(() => window.__map.project(26.57, 56.25));
const t0 = Date.now();
await page.mouse.move(720, 450);
await page.mouse.down();
for (let i = 1; i <= 36; i++) { await page.mouse.move(720 - i * 10, 450 + i * 3); await page.waitForTimeout(8); if (i === 24 && process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, `drag_mid_zoom_${zoom}.png`) }); }
await page.mouse.up();
const secs = (Date.now() - t0) / 1000;
const frames = await page.evaluate(() => window.__frames.slice());
const after = await page.evaluate(() => window.__map.project(26.57, 56.25));
const moved = Math.hypot(after.x - before.x, after.y - before.y);
const fps = frames.length / secs;
const worst = Math.max(...frames);
console.log(`zoom ${zoom}: drag of 360 px moved the map ${Math.round(moved)} px; ${frames.length} frames in ${secs.toFixed(2)} s = ${fps.toFixed(1)} fps during the drag, worst frame ${Math.round(worst)} ms`);
if (cdp) {
  const { profile } = await cdp.send("Profiler.stop");
  const self = new Map(); const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const dt = profile.timeDeltas; let total = 0;
  profile.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || "(anon)"} ${(n.callFrame.url || "").split("/").slice(-2).join("/")}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) ?? 0) + dt[i]); total += dt[i]; });
  console.log("top self time (ms) during the drag run:");
  [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).forEach(([k, v]) => console.log(`  ${(v / 1000).toFixed(0).padStart(6)}  ${k}`));
  console.log(`  total sampled ${(total / 1000).toFixed(0)} ms`);
}
console.log("draw calls per canvas during the drag:", JSON.stringify(Object.fromEntries(await page.evaluate(() => [...window.__draws]))));
console.log(`errors: ${errors.length}`);
const baseDraws = await page.evaluate(() => window.__draws.get("deck-base") ?? 0);
if (process.env.SHOT_DIR) { await page.waitForTimeout(3000); await page.screenshot({ path: path.join(process.env.SHOT_DIR, `drag_after_zoom_${zoom}.png`) }); }
await browser.close();
let bad = 0;
const check = (n, ok) => { if (!ok) bad++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); };
check(`the map really moved (${Math.round(moved)} px for a 360 px drag)`, moved > 300 && moved < 420);
check(`drag speed at zoom ${zoom}: at least 15 fps (it was 6.5 before M15) - measured ${fps.toFixed(1)}`, fps >= 15);
check(`the country outlines are not redrawn during the drag (${baseDraws} draw calls, all after release)`, baseDraws <= 12);
check("0 console errors", errors.length === 0);
process.exit(bad ? 1 : 0);
