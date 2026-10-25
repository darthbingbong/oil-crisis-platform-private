// M4: the route panel's news section in its normal, stale, empty and unavailable states, driven by the real backend.
// The failure states come from the backend's DEV-ONLY switch (POST /api/v1/dev/news-feed), not from mocking the browser.
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

const dev = async (mode, expire_cache = false) => {
  const r = await fetch(`${BASE}/api/v1/dev/news-feed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, expire_cache }) });
  console.log(`dev switch -> ${mode}${expire_cache ? " + expire cache" : ""}:`, JSON.stringify(await r.json()));
};
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
      const tip = await page.locator('[data-testid="route-tooltip"]').count();
      if (tip && (await page.locator('[data-testid="route-tooltip"]').innerText()).includes(r.name)) {
        await page.mouse.click(x, y);
        await page.waitForTimeout(3200);
        return true;
      }
    }
  }
  return false;
}

async function showNews(name) {
  // fail fast, with a picture, if the click did not open the ROUTE panel (e.g. it opened a marker's location view instead)
  if (!(await page.locator('[data-testid="route-panel"]').count())) {
    await page.screenshot({ path: path.join(OUT, `${name}_DEBUG_no_route_panel.png`) });
    const loc = await page.locator('[data-testid="location-detail"]').count();
    throw new Error(`${name}: no route panel after click (location-detail present: ${loc > 0})`);
  }
  // wait until the news section has left its loading state, then scroll the panel so the section fills the view
  // the real GDELT feed can take 10 to 20 s per request and the client may retry, so allow generously
  await page.waitForSelector('[data-testid="route-news"]:not(:has([data-testid="news-loading"]))', { timeout: 150000 });
  await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="route-panel"]');
    const news = document.querySelector('[data-testid="route-news"]');
    panel.scrollTop = news.offsetTop - 90;
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const items = await page.locator('[data-testid="news-item"]').count();
  const msg = (await page.locator('[data-testid="news-message"]').count()) ? await page.locator('[data-testid="news-message"]').innerText() : null;
  const stale = (await page.locator('[data-testid="news-stale-badge"]').count()) > 0;
  const updated = (await page.locator('[data-testid="news-updated"]').count()) ? await page.locator('[data-testid="news-updated"]').innerText() : null;
  const tags = await page.locator('[data-testid="news-item"] span.section-label').allInnerTexts();
  console.log(`${name}: items=${items} stale-badge=${stale} updated=${JSON.stringify(updated)} tags=${JSON.stringify(tags)}\n   message=${JSON.stringify(msg)}`);
}

async function back() {
  await page.locator('[data-testid="route-panel"] button', { hasText: "Back to overview" }).click();
  await page.waitForTimeout(1800);
}

await dev("off");

// Preflight: the stale demo needs a REAL cached Hormuz result first. GDELT sometimes answers 429, so retry until the
// backend reports ok/empty (which also fills its cache), instead of letting the later steps silently show "unavailable".
{
  let status = "unavailable";
  for (let attempt = 1; attempt <= 4 && status === "unavailable"; attempt++) {
    const r = await fetch(`${BASE}/api/v1/routes/hormuz/news`, { signal: AbortSignal.timeout(180000) });
    const j = await r.json();
    status = j.feed_status;
    console.log(`preflight ${attempt}: feed_status=${status} count=${j.count} last_updated=${j.last_updated} message=${JSON.stringify(j.message)}`);
    if (status === "unavailable") await new Promise((res) => setTimeout(res, 30000));
  }
  if (status === "unavailable") throw new Error("GDELT never answered; cannot demonstrate a stale result without a real cached one");
}

await page.goto(`${BASE}/`, { waitUntil: "load" });
await page.waitForTimeout(7000);

const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : ["normal", "stale", "unavailable", "empty"];

// 1. normal
if (ONLY.includes("normal")) {
  if (!(await openRoute("hormuz", [22, 50]))) throw new Error("could not open the Hormuz panel");
  await showNews("11_news_normal");
  await back();
}

// 2. stale: feed fails and the cached result is past its ttl
if (ONLY.includes("stale")) {
  await dev("fail", true);
  if (!(await openRoute("hormuz", [22, 50]))) throw new Error("could not reopen Hormuz");
  await showNews("12_news_stale");
  await back();
}

// 3. unavailable: feed fails and this route was never cached. Cape of Good Hope: a long lane with no markers on top of it.
if (ONLY.includes("unavailable")) {
  await dev("fail", false);
  if (!(await openRoute("cape_good_hope", [-25, 22]))) throw new Error("could not open the Cape of Good Hope panel");
  await showNews("13_news_unavailable_nothing_cached");
  await back();
}

// 4. empty: the feed is fine but returns nothing
if (ONLY.includes("empty")) {
  await dev("empty", true);
  if (!(await openRoute("hormuz", [22, 50]))) throw new Error("could not open Hormuz for the empty state");
  await showNews("14_news_empty");
  await back();
}

await dev("off");
fs.writeFileSync(path.join(OUT, "news_console.txt"), logs.join("\n"));
console.log("console errors:", logs.filter((l) => /\[(error|pageerror)\]/.test(l)).length);
await browser.close();
