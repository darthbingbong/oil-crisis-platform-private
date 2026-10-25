// M7: AIS mode in the real frontend, fed by MOCK frames (Playwright intercepts the websocket). These are invented positions near Hormuz, NOT real ships.
import { chromium } from "playwright-core"; import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const OUT = process.env.SHOT_DIR;
const exe = path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe");
const browser = await chromium.launch({ executablePath: exe, args: ["--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--enable-webgl"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = []; page.on("console", m => logs.push(`[${m.type()}] ${m.text()}`)); page.on("pageerror", e => logs.push(`[pageerror] ${e.message}`));
const MOCK = [
  { type: "vessel", mmsi: "538000101", name: "MOCK TANKER ALPHA", flag: "Marshall Islands", lat: 26.1, lon: 55.2, speed_kn: 12.3, course_deg: 128, heading_deg: 130, destination: "FUJAIRAH", draught_m: 14.2, updated_at: "2026-10-25T08:00:00Z", source: "AIS" },
  { type: "vessel", mmsi: "636000102", name: "MOCK TANKER BRAVO", flag: "Liberia", lat: 25.4, lon: 57.0, speed_kn: 0.1, course_deg: null, heading_deg: null, destination: null, draught_m: null, updated_at: "2026-10-25T07:58:00Z", source: "AIS" },
  { type: "vessel", mmsi: "477000103", name: "MOCK TANKER CHARLIE", flag: "Hong Kong", lat: 26.6, lon: 56.4, speed_kn: 9.8, course_deg: 300, heading_deg: 298, destination: "SINGAPORE", draught_m: 11.0, updated_at: "2026-10-25T08:01:00Z", source: "AIS" },
];
await page.routeWebSocket("**/ws/vessels", (ws) => {
  ws.send(JSON.stringify({ type: "status", provider: "AISStream.io", state: "streaming", detail: "MOCK frames from the test harness", verified_against_live_feed: false, disclaimer: "UNVERIFIED against the live feed: MOCK FRAMES in this screenshot.", vessel_count: 3 }));
  ws.send(JSON.stringify({ type: "snapshot", vessels: MOCK.map(({ type, ...v }) => ({ ...v })) }));
});
await page.goto("http://localhost:5173/"); await page.waitForFunction(() => window.__vessels?.count > 0, null, { timeout: 60000 });
await page.locator('[data-testid="vessel-mode-ais"]').click();
await page.waitForFunction(() => window.__vessels?.kind === "ais" && window.__vessels.count === 3, null, { timeout: 15000 });
console.log("AIS mode drawing:", await page.evaluate(() => ({ kind: window.__vessels.kind, count: window.__vessels.count })));
console.log("badge:", (await page.locator('[data-testid="vessel-badge"]').innerText()));
for (let i = 0; i < 3; i++) { await page.evaluate(() => window.__globe.look(26, 56, 3.3)); await page.waitForTimeout(300); }
const b = await page.locator("canvas").first().boundingBox();
const q = await page.evaluate(() => window.__vessels.project(0));
await page.mouse.click(b.x + q.x, b.y + q.y); await page.waitForTimeout(700);
await page.mouse.move(b.x + 690, b.y + 470); await page.waitForTimeout(500);
console.log("panel:", (await page.locator('[data-testid="vessel-panel"]').innerText()).replace(/\s+/g, " "));
const clip = { x: b.x, y: b.y, width: b.width, height: b.height };
await page.screenshot({ path: path.join(OUT, "m7_5_ais_mode_mock_frames.png"), clip });
// a vessel with missing fields
await page.evaluate(() => window.__vessels.select(1)); await page.waitForTimeout(700);
console.log("panel (sparse vessel):", (await page.locator('[data-testid="vessel-panel"]').innerText()).replace(/\s+/g, " "));
fs.writeFileSync(path.join(OUT, "m7_ais_mock_console.txt"), logs.join("\n"));
const errors = logs.filter(l => /\[(error|pageerror)\]/.test(l)); console.log("console errors:", errors.length); errors.slice(0,3).forEach(e => console.log("  ", e.slice(0,200)));
await browser.close();
