// M8.4: Results page load time = navigation start to KPI strip visible, fresh browser context per run, 5 runs. Point BASE at a vite dev server or a vite preview of a production build.
// Results page load time: navigation start -> KPI strip visible (and DOMContentLoaded / load), fresh browser context per run, same backend.
import { chromium } from "playwright-core"; import os from "node:os"; import path from "node:path";
const exe = path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe");
const b = await chromium.launch({ executablePath: exe, args: ["--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--enable-webgl"] });
const Q = "route=suez&type=detour&detour=20&dur=60&conf=5&dem=0&ev=100&li=10&horizon=5";
async function once(base) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
  const t0 = Date.now(); await p.goto(`${base}/results?${Q}`, { waitUntil: "domcontentloaded" }); const dcl = Date.now() - t0;
  await p.waitForSelector('[data-testid="kpi-strip"]', { timeout: 60000 }); const kpi = Date.now() - t0;
  await p.waitForLoadState("load"); const load = Date.now() - t0;
  const reportMs = await p.evaluate(() => performance.getEntriesByType("resource").filter(r => r.name.includes("/simulate/report")).map(r => Math.round(r.duration))[0] ?? null);
  await ctx.close(); return { dcl, kpi, load, reportMs };
}
const med = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
for (const [label, base] of [["M5 (before ticker/vessels)", "http://localhost:4174"], ["now (HEAD)", "http://localhost:4173"], ["M5 again", "http://localhost:4174"], ["now again", "http://localhost:4173"]]) {
  const runs = []; for (let i = 0; i < 5; i++) runs.push(await once(base));
  console.log(label.padEnd(28), "KPI strip visible (ms):", JSON.stringify(runs.map(r => r.kpi)), "median", med(runs.map(r => r.kpi)), "| report API (ms):", JSON.stringify(runs.map(r => r.reportMs)), "| load event median", med(runs.map(r => r.load)));
}
await b.close();

