import { chromium } from "playwright-core";
import os from "node:os"; import path from "node:path";
const OUT = process.env.SHOT_DIR;
const exe = path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe");
const b = await chromium.launch({ executablePath: exe, args: ["--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"] });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
const logs=[]; page.on("console", m => logs.push(`[${m.type()}] ${m.text()}`)); page.on("pageerror", e => logs.push("[pageerror] "+e.message));
await page.goto("http://localhost:5173/"); await page.waitForTimeout(7000);

// existing marker flow: click the Hormuz chokepoint marker (dispatch on the exact button: neighbours overlap it)
await page.evaluate(() => window.__globe.face(26.5, 56)); await page.waitForTimeout(300);
await page.locator('button[aria-label^="Hormuz"]').first().dispatchEvent("click");
await page.waitForTimeout(3200);
await page.screenshot({ path: path.join(OUT, "8_existing_marker_hormuz_detail.png") });
console.log("location view title:", await page.locator('[data-testid="location-detail"] h1').innerText());
console.log("Hormuz location view shows current-conditions note:", (await page.locator('[data-testid="location-detail"] [data-testid="current-conditions"]').count()) > 0);
console.log("EIA links:", await page.locator('[data-testid="location-detail"] [data-testid="current-conditions"] a').evaluateAll(as => as.map(a => a.href)));
await page.keyboard.press("Escape"); await page.waitForTimeout(1800);
console.log("returned to overview (detail hidden):", await page.locator('[data-testid="location-detail"]').count() === 0);

// existing /refineries/at-risk flow: sidebar chokepoint buttons
const btn = page.locator('aside, div').locator('button[aria-pressed]').filter({ hasText: /^Hormuz$/ }).first();
console.log("sidebar chokepoint buttons:", await page.locator('button[aria-pressed]').allInnerTexts());
await btn.scrollIntoViewIfNeeded();
const waitResp = page.waitForResponse(r => r.url().includes("/refineries/at-risk/"), { timeout: 8000 }).catch(() => null);
await btn.click({ timeout: 5000 }).catch(e => console.log("click failed:", e.message.split("\n")[0]));
const r = await waitResp;
console.log("GET /refineries/at-risk/:", r ? `${r.status()} ${r.url().split("/api")[1]}` : "NO REQUEST");
await page.waitForTimeout(1000);
console.log("capacity-at-risk text:", (await page.locator("text=Capacity at risk").count()) > 0, "| body has 6,190,000:", (await page.content()).includes("6,190,000"));
await page.screenshot({ path: path.join(OUT, "9_existing_chokepoint_panel.png") });
console.log("console errors:", logs.filter(l => /\[(error|pageerror)\]/.test(l)).length);
await b.close();
