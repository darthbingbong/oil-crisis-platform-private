// M15 first-time-user walk: the main screens at laptop (1440), tablet (820) and phone (390) widths, with screenshots and automatic layout checks.
//   SHOT_DIR=<dir> node e2e/m15_walk.mjs        Needs the backend on :8000 and `npm run dev` on :5173. Makes no AIS call and no TradingView request is waited for.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = process.env.SHOT_DIR;
const BASE = "http://localhost:5173";
const exe = path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe");
const browser = await chromium.launch({ executablePath: exe, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"] });
const logs = [];
const problems = [];
const MUHUT = 538006502;
const SIZES = [["laptop", 1440, 900], ["tablet", 820, 1180], ["phone", 390, 844]];
const SUEZ = "route=suez&type=detour&detour=20&dur=60&conf=5&dem=0&ev=100&li=10&horizon=5";

async function page(w, h) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  p.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
  p.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  return p;
}
const shot = async (p, name, full = false) => { await p.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full }); };
/** Automatic checks that catch what a first-time user would trip over: sideways scroll, text clipped by its box, tiny tap targets, tiny text. */
async function audit(p, label) {
  const r = await p.evaluate(() => {
    const out = { hscroll: document.documentElement.scrollWidth - window.innerWidth, clipped: [], smallTargets: [], smallText: [] };
    const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
    for (const e of document.querySelectorAll("button, a, [role=tab], input, select")) {
      if (!vis(e)) continue; if (e.closest(".sr-only")) continue; const lab = e.tagName === "INPUT" ? e.closest("label") : null; const r = (lab ?? e).getBoundingClientRect();
      if (r.top > window.innerHeight * 3) continue;
      if (r.width < 32 || r.height < 28) out.smallTargets.push(`${e.tagName.toLowerCase()} "${(e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    for (const e of document.querySelectorAll("body *")) {
      if (e.children.length || !e.textContent.trim() || !vis(e)) continue;
      const cs = getComputedStyle(e); const fs = parseFloat(cs.fontSize);
      if (fs < 11) out.smallText.push(`${e.textContent.trim().slice(0, 30)} (${fs}px)`);
      if (e.scrollWidth > e.clientWidth + 2 && cs.overflowX === "hidden" && cs.textOverflow !== "ellipsis") out.clipped.push(`${e.textContent.trim().slice(0, 40)} (${e.scrollWidth}>${e.clientWidth})`);
    }
    out.smallTargets = out.smallTargets.slice(0, 12); out.smallText = [...new Set(out.smallText)].slice(0, 8); out.clipped = out.clipped.slice(0, 8);
    return out;
  });
  const bits = [];
  if (r.hscroll > 1) bits.push(`sideways scroll ${r.hscroll}px`);
  if (r.clipped.length) bits.push(`clipped text: ${r.clipped.join(" | ")}`);
  if (r.smallTargets.length) bits.push(`small tap targets: ${r.smallTargets.join(" | ")}`);
  if (r.smallText.length) bits.push(`text under 11px: ${r.smallText.join(" | ")}`);
  console.log(`${bits.length ? "NOTE" : "ok  "}  ${label}${bits.length ? "  -> " + bits.join("  //  ") : ""}`);
  if (bits.length) problems.push(`${label}: ${bits.join(" // ")}`);
}

for (const [name, w, h] of SIZES) {
  console.log(`\n=== ${name} ${w}x${h}`);
  const p = await page(w, h);
  // 1. first screen, globe (the default view)
  await p.goto(`${BASE}/`, { waitUntil: "load" });
  await p.waitForSelector('[data-testid="view-toggle"]', { timeout: 60000 });
  await p.waitForTimeout(4000);
  await shot(p, `${name}_1_first_screen_globe`); await audit(p, `${name}: first screen (globe)`);
  // 2. the 2D map
  await p.goto(`${BASE}/?view=map`, { waitUntil: "load" });
  await p.waitForSelector('[data-testid="map-view"]', { timeout: 60000 });
  await p.waitForFunction(() => window.__map?.simCount?.() > 0, null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  await shot(p, `${name}_2_map`); await audit(p, `${name}: 2D map`);
  // 3. a route selected (Hormuz) and its panel
  await p.goto(`${BASE}/?view=map&selected=hormuz`, { waitUntil: "load" });
  await p.waitForSelector('[data-testid="map-view"]', { timeout: 60000 });
  await p.waitForTimeout(3500);
  await shot(p, `${name}_3_route_selected`); await audit(p, `${name}: route selected`);
  // 4. a real vessel (MUHUT SILVER) with its saved track
  await p.goto(`${BASE}/?view=map&vessel=${MUHUT}`, { waitUntil: "load" });
  await p.waitForSelector('[data-testid="map-view"]', { timeout: 60000 });
  await p.waitForTimeout(4000);
  await shot(p, `${name}_4_vessel_panel`); await audit(p, `${name}: vessel panel`);
  await p.close();
  // 5. the whole dashboard column stacked (tablet and phone scroll inside <main>; a tall viewport shows it in one image)
  if (name !== "laptop") {
    const t = await page(w, 3600);
    await t.goto(`${BASE}/?view=map`, { waitUntil: "load" });
    await t.waitForSelector('[data-testid="markets-panel"]', { timeout: 60000 });
    await t.waitForTimeout(4000);
    await shot(t, `${name}_5_dashboard_stacked`); await audit(t, `${name}: dashboard stacked`);
    await t.close();
  }
  // 6. the Results page (document scroll, so a full-page image)
  const r = await page(w, h);
  await r.goto(`${BASE}/results?${SUEZ}`, { waitUntil: "load" });
  await r.waitForSelector('[data-testid="section-price"]', { timeout: 60000 });
  await r.waitForTimeout(2500);
  await shot(r, `${name}_6_results_suez`, true); await audit(r, `${name}: Results page (Suez)`);
  await r.close();
}
fs.writeFileSync(path.join(OUT, "m15_walk_notes.txt"), problems.join(String.fromCharCode(10)));
const errors = logs.filter((l) => /\[(error|pageerror)\]/.test(l));
console.log(`\nconsole errors: ${errors.length}`); errors.slice(0, 5).forEach((e) => console.log("  ", e.slice(0, 200)));
await browser.close();
