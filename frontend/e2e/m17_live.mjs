// M17 public-site run in a real browser.   SITE=<frontend> API=<backend> SHOT_DIR=<dir> node e2e/m17_live.mjs
// Local:  a backend with HOSTED_MODE=1 FRONTEND_ORIGIN=http://127.0.0.1:4173 on :8002 and a build made with VITE_API_ORIGIN=http://127.0.0.1:8002 on `vite preview --port 4173`.
// Live:   SITE=https://oil-crisis-platform-final.pages.dev API=https://oil-crisis-api.onrender.com   (BURST=0 by default for the live site)
// At laptop (1440), tablet (820) and phone (390): footer attribution, real tankers as a SNAPSHOT (layers panel, badge, vessel panel with a saved track), no AISStream switch,
// the News Alert Feed never stuck on CONNECTING, route news in the route panel, no overlap of the Layers panel with the zoom buttons / Reset view / legend,
// no horizontal overflow, 0 console errors, and no key-shaped string or .env value in any API response.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = process.env.SHOT_DIR;
const SITE = (process.env.SITE ?? "http://127.0.0.1:4173").replace(/\/$/, "");
const API = (process.env.API ?? "http://127.0.0.1:8002").replace(/\/$/, "");
const BURST = (process.env.BURST ?? (API.includes("127.0.0.1") ? "1" : "0")) === "1";
const HEADLINE_MMSI = 538006502;      // the saved track that really travelled (846 nm)
const exe = path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe");

const t0 = Date.now();
const warm = await fetch(`${API}/api/v1/ping`, { signal: AbortSignal.timeout(180000) }).catch(() => null);
console.log(`first request to the API: ${warm ? warm.status : "no answer"} after ${((Date.now() - t0) / 1000).toFixed(1)} s (a cold start if this is long)`);
for (let i = 0; i < 20; i++) {
  const r = await fetch(`${API}/api/v1/hosted`).catch(() => null);
  if (r && r.status === 200) break;
  await new Promise((res) => setTimeout(res, 5000));
}

const secrets = [];
const envFile = path.resolve("..", "backend", ".env");
if (fs.existsSync(envFile)) for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z][A-Z0-9_]+)=(.*)$/); if (m && m[2].trim().length >= 6) secrets.push(m[2].trim()); }
const KEYISH = [/sk-ant-[A-Za-z0-9_-]{10,}/, /ghp_[A-Za-z0-9]{20,}/, /AKIA[0-9A-Z]{16}/, /[?&](?:api_)?key=[A-Za-z0-9_-]{8,}/i];

const browser = await chromium.launch({ executablePath: exe, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"] });
const logs = [], requests = [], bodies = [];
let failures = 0, passes = 0;
const check = (name, ok, extra = "") => { if (ok) passes++; else failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${name} ${extra}`); };

async function newPage(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on("console", (m) => { if (m.type() === "error") logs.push(`[error ${w}] ${m.text()}`); });
  page.on("pageerror", (e) => logs.push(`[pageerror ${w}] ${e.message}`));
  page.on("requestfailed", (r) => logs.push(`[requestfailed ${w}] ${r.url()} ${r.failure()?.errorText}`));
  page.on("request", (r) => requests.push(r.url()));
  page.on("response", async (r) => {
    if (!r.url().startsWith(API) || r.url().includes("/news/stream")) return;
    try { bodies.push([r.url(), await r.text()]); } catch { /* redirects and streams have no body */ }
  });
  return page;
}
const text = async (p, sel) => ((await p.locator(sel).first().innerText().catch(() => "")) || "").replace(/\s+/g, " ");
const shot = async (p, name) => { if (OUT) await p.screenshot({ path: path.join(OUT, `${name}.png`) }); };
const rect = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);
const hit = (a, b) => a && b && a.w > 0 && b.w > 0 && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

const SENTENCE = "Real tanker positions: ShipFinder snapshot (2026-11-11, non-commercial use). Chokepoint traffic is simulated.";

for (const [w, h, tag] of [[1440, 900, "laptop"], [820, 1180, "tablet"], [390, 844, "phone"]]) {
  console.log(`\n--- ${tag} ${w}x${h}`);
  const p = await newPage(w, h);
  await p.goto(`${SITE}/?view=map`, { waitUntil: "load" });
  await p.waitForSelector('[data-testid="map-view"]', { timeout: 90000 });
  await p.waitForSelector('[data-testid="footer-disclaimer"]', { timeout: 60000 });
  await p.waitForSelector('[data-testid="footer-vessels"]', { timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(3000);

  // footer
  check(`${tag}: footer disclaimer is the exact sentence`, (await text(p, '[data-testid="footer-disclaimer"]')) === "Educational project. Figures are model estimates, not forecasts or financial advice.");
  const foot = await text(p, '[data-testid="site-footer"]');
  check(`${tag}: footer says "${SENTENCE}"`, (await text(p, '[data-testid="footer-vessels"]')) === SENTENCE, `(${await text(p, '[data-testid="footer-vessels"]')})`);
  check(`${tag}: footer no longer says vessels are all simulated or voyage lengths are estimates`, !/Vessels on this site are SIMULATED/.test(foot) && !/Voyage lengths are estimates/.test(foot));
  const srcs = await text(p, '[data-testid="footer-sources"]');
  for (const s of ["EIA", "GDELT", "TradingView", "Global Energy Monitor", "ShipFinder"]) check(`${tag}: footer names ${s}`, srcs.includes(s), `(${srcs})`);
  for (const s of ["AISStream", "NewsAPI", "Alpha Vantage"]) check(`${tag}: footer does not name the disabled source ${s}`, !foot.includes(s));
  check(`${tag}: footer links to the public repository`, (await p.locator('[data-testid="site-footer"] a').first().getAttribute("href")) === "https://github.com/darthbingbong/oil-crisis-platform-final");
  await p.locator('[data-testid="footer-details"] summary').click();
  await p.waitForTimeout(300);
  const det = await text(p, '[data-testid="footer-details"]');
  check(`${tag}: ShipFinder attribution, GEM citation with the licence-unconfirmed note, GDELT, TradingView, privacy`, det.includes(SENTENCE) && /Global Energy Ownership Tracker, Global Energy Monitor, October 2026 release/.test(det) && /not confirmed for this tracker/.test(det) && /GDELT Project/.test(det) && /browser contacts TradingView directly/.test(det) && /no cookies/.test(det));
  await shot(p, `m17_${tag}_footer_open`);
  await p.locator('[data-testid="footer-details"] summary').click();
  const small = await p.evaluate(() => [...document.querySelectorAll('[data-testid="site-footer"] *')].filter((e) => e.childElementCount === 0 && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 11).length);
  check(`${tag}: nothing in the footer is under 11 px`, small === 0, `(${small})`);
  check(`${tag}: no horizontal page scroll`, (await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);

  // data: snapshot, not live, no provider call
  const wl = await p.evaluate((api) => fetch(`${api}/api/v1/vessels/watchlist`).then((r) => r.json()), API);
  check(`${tag}: watchlist endpoint is a SNAPSHOT of 12 tankers captured 2026-11-11, 2 samples`, wl.status === "SNAPSHOT" && wl.vessels.length === 12 && wl.captured_at_utc.startsWith("2026-11-11") && wl.samples.length === 2, `(${wl.status} ${wl.vessels.length})`);
  check(`${tag}: every tanker is state SNAPSHOT, with a seen-at time and the cargo caveat`, wl.vessels.every((v) => v.state === "SNAPSHOT" && v.last_seen_utc && v.cargo_note === "cargo type not confirmed by AIS"));
  check(`${tag}: the key line is the saved-data sentence`, /saved on 2026-11-11/.test(wl.key_line), `(${wl.key_line})`);

  // layers panel
  if (!(await p.locator('[data-testid="layer-count-watchlist"]').count())) await p.locator('[data-testid="layers-collapse"]').click();
  await p.waitForSelector('[data-testid="layer-count-watchlist"]', { timeout: 10000 });
  check(`${tag}: Layers panel reads "Real tankers (watchlist): 12, SNAPSHOT"`, (await text(p, '[data-testid="layer-count-watchlist"]')) === "12" && /^SNAPSHOT /.test(await text(p, '[data-testid="layer-chip-watchlist"]')) && /Real tankers \(watchlist\)/.test(await text(p, '[data-testid="layers-panel"]')), `(${await text(p, '[data-testid="layer-chip-watchlist"]')})`);
  check(`${tag}: simulated traffic layer is still labelled SIMULATED`, (await text(p, '[data-testid="layer-chip-simulated"]')) === "SIMULATED");
  check(`${tag}: SNAPSHOT badge on the map`, /SNAPSHOT .*12 REAL TANKERS/.test(await text(p, '[data-testid="watch-badge"]')), `(${await text(p, '[data-testid="watch-badge"]')})`);
  check(`${tag}: no AISStream switch`, (await p.locator('[data-testid="vessel-mode-ais"]').count()) === 0 && !/AISStream live/i.test(await text(p, "body")));

  // overlap, panel open
  const panel = await rect(p, '[data-testid="layers-panel"]');
  for (const [name, sel] of [["Reset view", '[data-testid="map-reset-view"]'], ["zoom in", '[data-testid="map-zoom-in"]'], ["zoom out", '[data-testid="map-zoom-out"]'], ["legend", '[data-testid="route-legend"]']]) {
    const o = await rect(p, sel);
    check(`${tag}: Layers panel (open) does not overlap ${name}`, o !== null && !hit(panel, o), `(panel ${panel && Math.round(panel.t)}-${panel && Math.round(panel.b)}, ${name} ${o && Math.round(o.t)}-${o && Math.round(o.b)})`);
  }
  check(`${tag}: the panel stays inside the map`, panel.b <= h && panel.r <= w);
  const badgeBox = await rect(p, '[data-testid="watch-badge"]');
  for (const [name, sel] of [["Reset view", '[data-testid="map-reset-view"]'], ["zoom in", '[data-testid="map-zoom-in"]'], ["zoom out", '[data-testid="map-zoom-out"]'], ["legend", '[data-testid="route-legend"]'], ["Layers panel", '[data-testid="layers-panel"]']]) {
    const o = await rect(p, sel);
    check(`${tag}: the SNAPSHOT badge does not overlap ${name}`, o !== null && badgeBox !== null && !hit(badgeBox, o), `(badge ${badgeBox && Math.round(badgeBox.t)}-${badgeBox && Math.round(badgeBox.b)}, ${name} ${o && Math.round(o.t)}-${o && Math.round(o.b)})`);
  }
  await shot(p, `m17_${tag}_map`);

  // news feed
  await p.waitForSelector('[data-testid="headlines-feed"]', { timeout: 30000 });
  await p.waitForFunction(() => { const b = document.querySelector('[data-testid="headlines-badge"]'); return b && !/LOADING/.test(b.textContent); }, null, { timeout: 60000 }).catch(() => {});
  const badge = await text(p, '[data-testid="headlines-badge"]');
  const items = await p.locator('[data-testid="headline-item"]').count();
  check(`${tag}: News Alert Feed is not CONNECTING and not stuck loading`, !/CONNECTING|LOADING/.test(badge) && !/CONNECTING/.test(await text(p, "body")), `(${badge}, ${items} headlines)`);
  if (OUT) await p.locator('[data-testid="headlines-feed"]').screenshot({ path: path.join(OUT, `m17_${tag}_news_feed.png`) }).catch(() => {});
  check(`${tag}: the feed shows headlines with the GDELT source, or a plain message`, items > 0 ? /GDELT/.test(await text(p, '[data-testid="headlines-feed"]')) : (await p.locator('[data-testid="headlines-empty"], [data-testid="headlines-error"]').count()) === 1);
  await p.close();
}

// laptop: vessel panel with a saved track, route panel with route news, globe
console.log("\n--- laptop: vessel panel, route news, globe");
{
  const p = await newPage(1440, 900);
  await p.goto(`${SITE}/?view=map&vessel=${HEADLINE_MMSI}`, { waitUntil: "load" });
  await p.waitForSelector('[data-testid="watch-vessel-panel"]', { timeout: 90000 });
  await p.waitForSelector('[data-testid="vessel-track-label"]', { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(2500);
  const vp = await text(p, '[data-testid="watch-vessel-panel"]');
  check("vessel panel: state SNAPSHOT, seen-at time, cargo caveat, saved track", /SNAPSHOT/.test(await text(p, '[data-testid="watch-vessel-state"]')) && /last seen/i.test(vp) && /cargo type not confirmed by AIS/.test(vp) && /past track|SAVED|track/i.test(await text(p, '[data-testid="vessel-track-info"]')), `(${(await text(p, '[data-testid="vessel-track-label"]')).slice(0, 90)})`);
  const near = await text(p, '[data-testid="vessel-near-label"]');
  check("vessel panel: the nearby sample is labelled with its seed and time (not chokepoint traffic)", /within 10 nm of .* seen at \d\d:\d\d UTC/.test(near) || /not in either saved/.test(await text(p, '[data-testid="vessel-near"]')), `(${near})`);
  await shot(p, "m17_laptop_vessel_panel");

  await p.goto(`${SITE}/?view=map&selected=suez`, { waitUntil: "load" });
  await p.waitForSelector('[data-testid="route-news"]', { timeout: 90000 });
  await p.waitForFunction(() => !document.querySelector('[data-testid="news-loading"]'), null, { timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const n = await p.locator('[data-testid="news-item"]').count();
  const rn = await text(p, '[data-testid="route-news"]');
  check("route panel: GDELT route news loads (headlines, or a plain no-headlines message) with the attribution", (n > 0 || (await p.locator('[data-testid="news-message"]').count()) > 0) && /GDELT/.test(rn), `(${n} items; ${rn.slice(0, 120)})`);
  await shot(p, "m17_laptop_route_news");

  await p.goto(`${SITE}/?view=globe`, { waitUntil: "load" });
  await p.waitForSelector('[data-testid="vessel-controls"]', { timeout: 90000 });
  await p.waitForTimeout(3000);
  check("globe: only the SIMULATED VESSELS badge with its info button, no source switch", /SIMULATED VESSELS/.test(await text(p, '[data-testid="vessel-badge"]')) && (await p.locator('[data-testid="vessel-info-button"]').count()) === 1 && (await p.locator('[data-testid="vessel-mode-simulated"], [data-testid="vessel-mode-ais"]').count()) === 0);
  await p.locator('[data-testid="vessel-info-button"]').hover();
  check("globe: the info tooltip opens", (await p.locator('[data-testid="vessel-info"]').count()) === 1);
  await shot(p, "m17_laptop_globe");
  await p.close();
}

// Results page: the ShipFinder-planned voyage length is back
console.log("\n--- results and not-found");
{
  const p = await newPage(1440, 900);
  await p.goto(`${SITE}/results?route=suez&type=detour&detour=20&dur=60&conf=5&dem=0&ev=100&li=10&horizon=5`, { waitUntil: "load" });
  await p.waitForSelector('[data-testid="site-footer"]', { timeout: 90000 });
  await p.waitForTimeout(4000);
  const body = await text(p, "body");
  check("results: Suez 20-day detour gives +28.8% and the planned-distance default detour of 14 days (ShipFinder set)", /28\.8/.test(body) && /derived default is 14(\.0)? days/.test(body) && /ShipFinder/.test(body), `(${(body.match(/.{0,40}28\.8.{0,20}/) ?? [""])[0]})`);
  await shot(p, "m17_results");
  await p.goto(`${SITE}/no-such-page`, { waitUntil: "load" });
  await p.waitForSelector('[data-testid="not-found"]');
  check("404 page: friendly text, link back, footer", /does not exist/.test(await text(p, '[data-testid="not-found"]')) && (await p.locator('[data-testid="site-footer"]').count()) === 1);
  await p.close();
}

// Markets and ticker
console.log("\n--- markets and ticker");
{
  const p = await newPage(1440, 900);
  await p.goto(`${SITE}/`, { waitUntil: "load" });
  await p.waitForSelector('[data-testid="price-ticker"]', { timeout: 90000 }).catch(() => {});
  await p.waitForTimeout(3000);
  check("ticker shows WTI and Brent with a status", /WTI/.test(await text(p, '[data-testid="price-ticker"]')) && /Brent/i.test(await text(p, '[data-testid="price-ticker"]')), `(${(await text(p, '[data-testid="price-ticker"]')).slice(0, 120)})`);
  const mk = p.locator('[data-testid="markets-panel"]');
  check("markets panel is present", (await mk.count()) >= 1);
  if (await mk.count()) await mk.first().scrollIntoViewIfNeeded();
  await p.waitForTimeout(2500);
  await shot(p, "m17_markets");
  await p.close();
}

// network + bodies
console.log("\n--- network and secrets");
const hosts = new Set(requests.map((u) => { try { return new URL(u).host; } catch { return u.slice(0, 20); } }));
const banned = [...hosts].filter((h) => /shipfinder|elaneglobal|newsapi|alphavantage|aisstream|anthropic|eia\.gov|gdeltproject/i.test(h));
check("the browser never contacted a data provider directly (only the API, the frontend host and TradingView)", banned.length === 0, `(${[...hosts].join(", ")})`);
check("API calls all went to the one configured API origin", requests.filter((u) => u.startsWith(API)).length > 10);
const leaked = bodies.filter(([, t]) => secrets.some((s) => t.includes(s)) || KEYISH.some((re) => re.test(t)));
check(`no .env value or key-shaped string in any of ${bodies.length} API responses`, leaked.length === 0, leaked.length ? `(${leaked.map((l) => l[0]).join(", ")})` : "");

if (BURST) {
  console.log("\n--- rate limit");
  const p = await newPage(1440, 900);
  await p.goto(`${SITE}/no-such-page`, { waitUntil: "load" });
  const r = await p.evaluate(async (api) => { const out = []; for (let i = 0; i < 140; i++) { const res = await fetch(`${api}/api/v1/routes`); out.push([res.status, res.headers.get("retry-after"), res.status === 429 ? await res.json() : null]); if (res.status === 429) break; } return out; }, API);
  const last = r[r.length - 1];
  check("a burst ends in 429 with Retry-After and a friendly sentence", last[0] === 429 && !!last[1] && /Too many requests/.test(last[2].message), `(after ${r.length} calls)`);
  await p.close();
}

const errs = logs.filter((l) => !/status of 429|Too Many Requests|ERR_FAILED/.test(l));
check("0 console errors across all viewports", errs.length === 0, errs.length ? "\n  " + errs.slice(0, 8).join("\n  ") : "");
console.log(`\n${passes} passed, ${failures} failed`);
await browser.close();
process.exit(failures ? 1 : 0);
