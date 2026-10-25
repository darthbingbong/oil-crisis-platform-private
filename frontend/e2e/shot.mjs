// Usage: node shot.mjs <name> [steps-json-file]
// Opens the dashboard in real Chromium (software WebGL), runs optional steps, saves screenshots + console log.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = process.env.SHOT_DIR;
const exe = path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe");
const name = process.argv[2] ?? "page";
const steps = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], "utf8")) : [];

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
page.on("requestfailed", (r) => logs.push(`[requestfailed] ${r.url()}`));

await page.goto("http://localhost:5173/", { waitUntil: "load" });
await page.waitForTimeout(6000); // let the globe textures load

let i = 0;
for (const s of steps) {
  if (s.move) await page.mouse.move(s.move[0], s.move[1], { steps: 8 });
  if (s.click) await page.mouse.click(s.click[0], s.click[1]);
  if (s.clickText) await page.getByText(s.clickText, { exact: false }).first().click();
  if (s.eval) { const r = await page.evaluate(s.eval); console.log("eval:", JSON.stringify(r)); }
  if (s.wait) await page.waitForTimeout(s.wait);
  if (s.shot) { const f = path.join(OUT, `${name}_${s.shot}.png`); await page.screenshot({ path: f }); console.log("saved", f); }
  i++;
}
if (!steps.some((s) => s.shot)) {
  const f = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: f });
  console.log("saved", f);
}
fs.writeFileSync(path.join(OUT, `${name}_console.txt`), logs.join("\n"));
console.log("console lines:", logs.length, "| errors:", logs.filter((l) => /error/i.test(l)).length);
await browser.close();
