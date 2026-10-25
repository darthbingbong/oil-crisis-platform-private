// M6: the ticker in one backend state per run. STATE names the screenshot; the backend is started by the caller in the matching mode.
// Prints what the ticker shows, the badge, the tooltip text and the console error count.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = process.env.SHOT_DIR;
const STATE = process.env.STATE ?? "state";
const WAIT = process.env.WAIT_FOR ?? "ready";            // "ready" or "error"
const exe = path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe");
const browser = await chromium.launch({ executablePath: exe, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto("http://localhost:5173/", { waitUntil: "load" });
await page.waitForSelector(`[data-testid="price-ticker"][data-state="${WAIT}"]`, { timeout: 60000 });
await page.waitForTimeout(1500);

const t = (id) => page.locator(`[data-testid="${id}"]`).first();
const has = async (id) => (await page.locator(`[data-testid="${id}"]`).count()) > 0;
const txt = async (id) => ((await has(id)) ? (await t(id).innerText()).replace(/\s+/g, " ") : null);

console.log(`[${STATE}] ticker data-state:`, await page.locator('[data-testid="price-ticker"]').getAttribute("data-state"));
console.log(`[${STATE}] WTI:   `, await txt("quote-wti"));
console.log(`[${STATE}] BRENT: `, await txt("quote-brent"));
console.log(`[${STATE}] as of: `, await txt("price-as-of"));
console.log(`[${STATE}] badge: `, await txt("price-status"));
console.log(`[${STATE}] sparkline present:`, await has("sparkline"), "| points drawn (paths):", await page.locator('[data-testid="sparkline"] path.recharts-line-curve').count());
console.log(`[${STATE}] error banner:`, await txt("price-error"));

await page.locator('[data-testid="price-ticker"]').screenshot({ path: path.join(OUT, `m6_${STATE}_ticker.png`) });
await page.screenshot({ path: path.join(OUT, `m6_${STATE}_page.png`) });
console.log("saved", `m6_${STATE}_ticker`, `m6_${STATE}_page`);

if (await has("price-status")) {
  await t("price-status").hover();
  await page.waitForTimeout(400);
  console.log(`[${STATE}] tooltip: `, await txt("price-status-tooltip"));
  await page.screenshot({ path: path.join(OUT, `m6_${STATE}_tooltip.png`), clip: { x: 600, y: 0, width: 840, height: 270 } });
  console.log("saved", `m6_${STATE}_tooltip`);
}

fs.writeFileSync(path.join(OUT, `m6_${STATE}_console.txt`), logs.join("\n"));
const errors = logs.filter((l) => /\[(error|pageerror)\]/.test(l));
console.log(`[${STATE}] console errors:`, errors.length);
errors.slice(0, 3).forEach((e) => console.log("    ", e.slice(0, 170)));
await browser.close();
