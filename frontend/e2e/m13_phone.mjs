// The viewport is 390 px wide and tall (1700 px) so the whole panel is on screen: the page scrolls inside the right-hand column, so an element below the
// viewport is cut out of an element screenshot (that was the "missing Sensex and VIX rows" in the first phone screenshot, not the widget).
// Phone-width (390 px) check of the Markets panel: is every row visible, and is the CFD label visible on every CFD row?   SHOT_DIR=<dir> node e2e/m13_phone.mjs
import { chromium } from "playwright-core";
import os from "node:os";
import path from "node:path";

const OUT = process.env.SHOT_DIR;
const exe = path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe");
const browser = await chromium.launch({ executablePath: exe, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"] });
const logs = [];
let failures = 0;
const check = (name, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${name} ${extra}`); };
const page = await browser.newPage({ viewport: { width: 390, height: 1700 } });
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto("http://localhost:5173/?view=map", { waitUntil: "load" });
await page.waitForSelector('[data-testid="markets-panel"]', { timeout: 60000 });
await page.locator('[data-testid="markets-panel"]').scrollIntoViewIfNeeded();

async function frameText(match, needle, ms = 60000) {
  const t0 = Date.now(); let last = "";
  while (Date.now() - t0 < ms) {
    for (const f of page.frames()) {
      if (!/tradingview/.test(f.url()) || f === page.mainFrame()) continue;
      try { last = ((await f.locator("body").innerText({ timeout: 2000 })) || "").replace(/\s+/g, " "); } catch { continue; }
      if (needle.test(last)) return { text: last, frame: f };
    }
    await page.waitForTimeout(1000);
  }
  return { text: last, frame: null };
}

for (const [tab, want] of [["indices", ["S&P 500 (CFD)", "Dow Jones (CFD)", "Nasdaq 100 (CFD)", "FTSE 100 (CFD)", "DAX", "Nikkei 225 (CFD)", "Hang Seng (CFD)", "Sensex", "VIX (CFD)"]], ["commodities", ["Natural gas (CFD)", "Gold", "Silver", "Copper (CFD, USD/lb)"]], ["fx", ["EUR/USD", "USD/JPY", "USD/CNY", "USD/INR", "Dollar index (DXY, CFD)"]]]) {
  await page.click(`[data-testid="markets-tab-${tab}"]`);
  const { text, frame } = await frameText(null, new RegExp(want[want.length - 1].replace(/[()$,/.]/g, ".")), 45000);
  await page.waitForTimeout(6000);
  const info = await frame.evaluate((names) => {
    const all = [...document.querySelectorAll("*")].filter((e) => e.children.length === 0);
    const boxes = names.map((n) => { const e = all.find((x) => x.textContent.trim() === n); const r = e?.getBoundingClientRect(); return { n, top: r ? Math.round(r.top) : null, bottom: r ? Math.round(r.bottom) : null }; });
    return { innerH: window.innerHeight, boxes };
  }, want);
  const box = await page.locator('[data-testid="tv-widget"]:visible iframe').first().boundingBox();
  const lastBox = info.boxes[info.boxes.length - 1];
  console.log(`      ${tab}: iframe ${Math.round(box.width)} x ${Math.round(box.height)} px; last row "${lastBox.n}" spans y ${lastBox.top} to ${lastBox.bottom} inside a ${info.innerH} px frame`);
  check(`${tab}: every row sits inside the widget frame (the last one ends at ${lastBox.bottom} of ${info.innerH} px)`, info.boxes.every((b) => b.top !== null && b.top >= 0 && b.bottom <= info.innerH));
  for (const name of want) check(`${tab}: row "${name}" is on screen`, text.includes(name.replace(/\s+/g, " ")), "");
  const cfd = want.filter((n) => /CFD/.test(n));
  if (cfd.length) check(`${tab}: every CFD row shows the CFD label at 390 px (${cfd.length} rows)`, cfd.every((n) => text.includes(n)));
  await page.locator('[data-testid="markets-panel"]').scrollIntoViewIfNeeded();
  // a full-page screenshot of the page at phone width, then the panel on its own at full height
  await page.locator('[data-testid="markets-panel"]').screenshot({ path: path.join(OUT, `phone_markets_${tab}.png`) });
  console.log("      saved", `phone_markets_${tab}`);
  const note = await page.locator('[data-testid="cfd-note"]').innerText();
  check(`${tab}: the CFD note is visible on screen at 390 px`, /CFD.*broker quotes.*not the official level/.test(note) && await page.locator('[data-testid="cfd-note"]').isVisible());
}
check("no horizontal page scroll at 390 px", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
const errors = logs.filter((l) => /\[(error|pageerror)\]/.test(l));
check("0 console errors", errors.length === 0, `(${errors.length})`);
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
