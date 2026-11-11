// M16 hosted-mode run in a real browser.   SHOT_DIR=<dir> node e2e/m16_hosted.mjs
// Needs: a backend started with HOSTED_MODE=1 FRONTEND_ORIGIN=http://127.0.0.1:4173 on :8002, and a production build made with
// VITE_API_ORIGIN=http://127.0.0.1:8002 served by `npx vite preview --port 4173 --host 127.0.0.1` (a DIFFERENT origin from the API, so CORS is really exercised).
// Checks at laptop (1440), tablet (820) and phone (390): the footer, SIMULATED-only vessels, no ShipFinder / AISStream / NewsAPI / Alpha Vantage traffic,
// no horizontal overflow, nothing under 11 px in the footer, 0 console errors; then the rate limit's friendly answer. The bundle is scanned separately (m16_bundle_scan.mjs).
import { chromium } from "playwright-core";
import os from "node:os";
import path from "node:path";

const OUT = process.env.SHOT_DIR;
const SITE = "http://127.0.0.1:4173";
const API = "http://127.0.0.1:8002";
const exe = path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe");
// a run ends with a deliberate request burst; if the last one was under a minute ago the API still refuses this address, so wait until it answers
for (let i = 0; i < 20; i++) {
  const r = await fetch(`${API}/api/v1/hosted`).catch(() => null);
  if (r && r.status === 200) break;
  await new Promise((res) => setTimeout(res, 5000));
}
const browser = await chromium.launch({ executablePath: exe, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"] });
const logs = [];
const requests = [];
let failures = 0, passes = 0;
const check = (name, ok, extra = "") => { if (ok) passes++; else failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${name} ${extra}`); };

async function newPage(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on("console", (m) => { if (m.type() === "error") logs.push(`[error ${w}] ${m.text()}`); });
  page.on("pageerror", (e) => logs.push(`[pageerror ${w}] ${e.message}`));
  page.on("requestfailed", (r) => logs.push(`[requestfailed ${w}] ${r.url()} ${r.failure()?.errorText}`));
  page.on("request", (r) => requests.push(r.url()));
  return page;
}
const text = async (p, sel) => ((await p.locator(sel).innerText().catch(() => "")) || "").replace(/\s+/g, " ");
const shot = async (p, name) => { if (OUT) await p.screenshot({ path: path.join(OUT, `${name}.png`) }); };

for (const [w, h, tag] of [[1440, 900, "laptop"], [820, 1180, "tablet"], [390, 844, "phone"]]) {
  console.log(`\n--- ${tag} ${w}x${h}`);
  const p = await newPage(w, h);
  await p.goto(`${SITE}/?view=map`, { waitUntil: "load" });
  await p.waitForSelector('[data-testid="map-view"]', { timeout: 60000 });
  await p.waitForSelector('[data-testid="footer-disclaimer"]', { timeout: 30000 });
  await p.waitForTimeout(2500);

  check(`${tag}: footer disclaimer is the exact sentence`, (await text(p, '[data-testid="footer-disclaimer"]')) === "Educational project. Figures are model estimates, not forecasts or financial advice.");
  const srcs = await text(p, '[data-testid="footer-sources"]');
  for (const s of ["EIA", "GDELT", "TradingView", "Global Energy Monitor", "Anthropic"]) check(`${tag}: footer names ${s}`, srcs.includes(s), `(${srcs})`);
  for (const s of ["ShipFinder", "AISStream", "NewsAPI", "Alpha Vantage"]) check(`${tag}: footer does not name the disabled source ${s}`, !srcs.includes(s) && !(await text(p, '[data-testid="site-footer"]')).includes(s));
  check(`${tag}: footer says vessels are simulated and voyage lengths are estimates`, /Vessels on this site are SIMULATED/.test(await text(p, '[data-testid="footer-vessels"]')) && /estimates/.test(await text(p, '[data-testid="footer-distances"]')));
  check(`${tag}: footer links to the public repository`, (await p.locator('[data-testid="site-footer"] a').first().getAttribute("href")) === "https://github.com/darthbingbong/oil-crisis-platform-final");

  await p.locator('[data-testid="footer-details"] summary').click();
  await p.waitForTimeout(300);
  const det = await text(p, '[data-testid="footer-details"]');
  check(`${tag}: GEM exact citation and the licence-unconfirmed note`, /Global Energy Ownership Tracker, Global Energy Monitor, October 2026 release/.test(det) && /not confirmed for this tracker/.test(det));
  check(`${tag}: GDELT citation, EIA, TradingView note, Anthropic note`, /GDELT Project/.test(det) && /Energy Information Administration/.test(det) && /browser contacts TradingView directly/.test(det) && /Claude/.test(det));
  check(`${tag}: privacy note says no cookies and no analytics`, /no cookies/.test(await text(p, '[data-testid="footer-privacy"]')) && /no analytics/.test(await text(p, '[data-testid="footer-privacy"]')));
  await shot(p, `m16_${tag}_footer_open`);
  await p.locator('[data-testid="footer-details"] summary').click();

  const small = await p.evaluate(() => [...document.querySelectorAll('[data-testid="site-footer"] *')].filter((e) => e.childElementCount === 0 && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 11).length);
  check(`${tag}: nothing in the footer is under 11 px`, small === 0, `(${small})`);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${tag}: no horizontal page scroll`, overflow <= 0, `(${overflow})`);

  const wl = await p.evaluate((api) => fetch(`${api}/api/v1/vessels/watchlist`).then((r) => r.json()), API);
  check(`${tag}: the watchlist endpoint is empty in hosted mode (no saved real tankers, no provider data)`, wl.status === "NONE" && wl.vessels.length === 0);
  const body = await text(p, "body");
  check(`${tag}: no REAL TANKERS badge and no SNAPSHOT vessel on screen`, !/REAL TANKERS/.test(body));
  check(`${tag}: the page says SIMULATED`, /SIMULATED/.test(body));
  await shot(p, `m16_${tag}_map`);

  if (tag === "laptop") {
    await p.goto(`${SITE}/?view=globe`, { waitUntil: "load" });
    await p.waitForSelector('[data-testid="view-toggle"]', { timeout: 60000 });
    await p.waitForTimeout(3000);
    check("laptop globe: no real-tanker badge", !/REAL TANKERS/.test(await text(p, "body")));
    await shot(p, "m16_laptop_globe");
    const price = await text(p, '[data-testid="price-ticker"]').catch(() => "");
    await p.goto(`${SITE}/?view=map`, { waitUntil: "load" });
    await p.waitForSelector('[data-testid="map-view"]', { timeout: 60000 });
    await p.waitForTimeout(1500);
    const pj = await p.evaluate((api) => fetch(`${api}/api/v1/price/live`).then((r) => r.json()), API);
    check("laptop: the price is served from the cache (EIA daily close after the scheduled refresh, or the dated CSV before it)", ["DAILY_CLOSE", "OFFLINE_FALLBACK"].includes(pj.status) && (pj.status === "DAILY_CLOSE" || pj.fallback_reason === "cache_only" || pj.fallback_reason === "no_key"), `(${pj.status} ${pj.as_of} ${pj.fallback_reason})`);
    void price;
  }
  await p.close();
}

// Results page and the 404 page: footer present, voyage length labelled an estimate, no provider name
console.log("\n--- results and not-found");
{
  const p = await newPage(1440, 900);
  await p.goto(`${SITE}/results?route=suez&type=detour&detour=20&dur=60&conf=5&dem=0&ev=100&li=10&horizon=5`, { waitUntil: "load" });
  await p.waitForSelector('[data-testid="site-footer"]', { timeout: 60000 });
  await p.waitForTimeout(3500);
  const body = await text(p, "body");
  check("results: the report rendered with a footer", /Suez/.test(body) && (await p.locator('[data-testid="footer-disclaimer"]').count()) === 1);
  check("results: the voyage length is not attributed to ShipFinder (estimated set)", !/ShipFinder/.test(body), `(${(body.match(/.{0,100}ShipFinder.{0,100}/) ?? [""])[0]})`);
  await shot(p, "m16_results");
  await p.goto(`${SITE}/no-such-page`, { waitUntil: "load" });
  await p.waitForSelector('[data-testid="not-found"]');
  check("404 page: friendly text, link back, footer", /does not exist/.test(await text(p, '[data-testid="not-found"]')) && (await p.locator('[data-testid="site-footer"]').count()) === 1);
  await p.close();
}

// Network: which hosts did the browser talk to?
console.log("\n--- network");
const hosts = new Set(requests.map((u) => { try { return new URL(u).host; } catch { return u.slice(0, 20); } }));
const banned = [...hosts].filter((h) => /shipfinder|elaneglobal|newsapi|alphavantage|aisstream|anthropic|eia\.gov|gdeltproject/i.test(h));
check("the browser never contacted a disabled source or an upstream data provider directly", banned.length === 0, `(${[...hosts].join(", ")})`);
const apiReqs = requests.filter((u) => u.startsWith(API));
check("the browser's API calls all went to the one configured API origin", apiReqs.length > 10, `(${apiReqs.length} calls)`);

// Rate limit: a burst answers 429 with a plain sentence, and the page keeps working afterwards
console.log("\n--- rate limit");
{
  const p = await newPage(1440, 900);
  await p.goto(`${SITE}/no-such-page`, { waitUntil: "load" });
  const r = await p.evaluate(async (api) => {
    const out = [];
    for (let i = 0; i < 140; i++) {
      const res = await fetch(`${api}/api/v1/routes`);
      out.push([res.status, res.headers.get("retry-after"), res.status === 429 ? await res.json() : null]);
      if (res.status === 429) break;
    }
    return out;
  }, API);
  const last = r[r.length - 1];
  check("a burst of requests ends in 429 with Retry-After and a friendly sentence", last[0] === 429 && !!last[1] && /Too many requests/.test(last[2].message) && last[2].error === "rate_limited", `(after ${r.length} calls)`);
  check("the 429 carries the CORS header (the browser can read the sentence)", last[2] !== null);
  await p.close();
}

const errs = logs.filter((l) => !/status of 429|Too Many Requests|ERR_FAILED/.test(l));
const burst429 = logs.filter((l) => /429/.test(l)).length;
check("0 console errors across all viewports (the deliberate 429 burst is not counted)", errs.length === 0, errs.length ? "\n  " + errs.slice(0, 8).join("\n  ") : `(ignored ${burst429} from the burst)`);
console.log(`\n${passes} passed, ${failures} failed`);
await browser.close();
process.exit(failures ? 1 : 0);
