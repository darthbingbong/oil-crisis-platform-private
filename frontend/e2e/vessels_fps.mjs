import { chromium } from "playwright-core"; import os from "node:os"; import path from "node:path";
const exe = path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe");
const browser = await chromium.launch({ executablePath: exe, args: ["--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--enable-webgl"] });
async function fps(page, secs = 8) {
  return page.evaluate((s) => new Promise((resolve) => { let frames = 0; const t0 = performance.now(); const times = []; let last = t0;
    function tick(t) { frames++; times.push(t - last); last = t; if (t - t0 < s * 1000) requestAnimationFrame(tick); else { times.sort((a,b)=>a-b); resolve({ fps: +(frames / ((t - t0) / 1000)).toFixed(1), worstFrameMs: +Math.max(...times).toFixed(0), medianFrameMs: +times[Math.floor(times.length/2)].toFixed(1) }); } }
    requestAnimationFrame(tick); }), secs);
}
async function run(label, { blockRoutes = false, query = "" }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  if (blockRoutes) await page.route("**/api/v1/routes", (r) => r.abort());
  await page.goto("http://localhost:5173/" + query, { waitUntil: "load" });
  await page.waitForFunction(() => window.__globe, null, { timeout: 60000 });
  await page.waitForTimeout(6000);
  const f = await fps(page); await page.waitForFunction(() => window.__globe, null, { timeout: 10000 }); const st = await page.evaluate(() => window.__globe.stats());
  const v = await page.evaluate(() => window.__vessels?.count ?? 0);
  console.log(label.padEnd(34), JSON.stringify(f), "| draw calls", st.calls, "| triangles", st.triangles, "| vessel instances", v);
  await page.close();
}
for (let round = 1; round <= 3; round++) {
  console.log("--- round", round);
  await run("no routes (no vessels)", { blockRoutes: true });
  await run("routes only (?vessels=0)", { query: "?vessels=0" });
  await run("routes + 2,000 vessels", {});
}
await browser.close();
