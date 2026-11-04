// Unit checks for the Markets panel's pure parts (symbol lists, widget settings, the WTI scenario number). Plain node, no browser:
//   node --experimental-strip-types e2e/markets_unit.mjs
import assert from "node:assert/strict";
import { FORMULA_BAND_PP, INDICES_NOTE, TABS, TAB_SYMBOLS, TV_SCRIPT_URL, VALIDATED_SUPPLY_LOSS_MAX_PCT, WIDGET_CHIP, WIDGET_HELP, widgetConfig, widgetHeight, wtiScenario } from "../src/lib/markets.ts";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("PASS ", name); };
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

t("the three tabs are Indices, Commodities, FX in that order", () => assert.deepEqual(TABS, ["indices", "commodities", "fx"]));
t("the indices that have a feed are listed; the two that do not are named in the note", () => {
  const names = TAB_SYMBOLS.indices.map((x) => x.displayName).join("|");
  for (const want of ["S&P 500", "Dow Jones", "Nasdaq 100", "FTSE 100", "DAX", "Nikkei 225", "Hang Seng", "Sensex", "VIX"]) assert.ok(names.includes(want), want);
  assert.ok(!/Nasdaq Composite|Nifty/.test(names));
  assert.match(INDICES_NOTE, /Nasdaq Composite/); assert.match(INDICES_NOTE, /Nifty 50/);
});
t("broker-quote rows say CFD in their name (they are not the official level)", () => {
  for (const x of TABS.flatMap((tab) => TAB_SYMBOLS[tab])) if (/^(FOREXCOM|OANDA|CAPITALCOM):/.test(x.name)) assert.match(x.displayName, /CFD/, x.name);
});
t("WTI and Brent are not in the widget (they are our own EIA cards)", () => {
  const all = TABS.flatMap((tab) => TAB_SYMBOLS[tab].map((s) => (s.displayName + s.name).toLowerCase()));
  assert.ok(!all.some((s) => /wti|brent|usoil|ukoil|cl1!/.test(s)));
});
t("no lithium row anywhere", () => assert.ok(!TABS.flatMap((tab) => TAB_SYMBOLS[tab]).some((s) => /lithium/i.test(s.displayName + s.name))));
t("FX has EUR/USD, USD/JPY, USD/CNY, USD/INR and a dollar index", () => {
  const names = TAB_SYMBOLS.fx.map((s) => s.displayName).join("|");
  for (const w of ["EUR/USD", "USD/JPY", "USD/CNY", "USD/INR", "DXY"]) assert.ok(names.includes(w), w);
});
t("symbols are unique and look like EXCHANGE:SYMBOL", () => {
  const all = TABS.flatMap((tab) => TAB_SYMBOLS[tab].map((s) => s.name));
  assert.equal(new Set(all).size, all.length);
  for (const s of all) assert.match(s, /^[A-Z_]+:[A-Z0-9!]+$/);
});
t("the widget script is TradingView's own https address", () => assert.match(TV_SCRIPT_URL, /^https:\/\/s3\.tradingview\.com\/external-embedding\//));
t("widget settings: dark, one tab per widget, no chart, height follows the row count", () => {
  for (const tab of TABS) {
    const c = widgetConfig(tab);
    assert.equal(c.colorTheme, "dark"); assert.equal(c.tabs.length, 1); assert.equal(c.showChart, false);
    assert.equal(c.tabs[0].symbols.length, TAB_SYMBOLS[tab].length); assert.equal(c.height, widgetHeight(tab));
    assert.deepEqual(c.tabs[0].symbols.map((x) => x.s), TAB_SYMBOLS[tab].map((x) => x.name));
  }
});
t("the chip wording is exactly the approved text and never says LIVE", () => {
  assert.equal(WIDGET_CHIP, "Via TradingView widget, delay set by TradingView");
  assert.ok(!/\blive\b/i.test(WIDGET_CHIP));
});
t("the tooltip quotes TradingView and says no delay or as-of time is shown here", () => {
  assert.match(WIDGET_HELP, /only allowed to stream delayed data/); assert.match(WIDGET_HELP, /Forex and crypto data is real-time/);
  assert.match(WIDGET_HELP, /nothing is labelled LIVE/); assert.match(WIDGET_HELP, /not investment advice/);
});

// ---- the WTI scenario number
t("constants match the validated record (8 percent, 13.09 pp)", () => { assert.equal(VALIDATED_SUPPLY_LOSS_MAX_PCT, 8); assert.equal(FORMULA_BAND_PP, 13.09); });
t("inside the range: 5 percent supply loss is +33.33 percent, with the band on the move", () => {
  const r = wtiScenario(100, 5, 5 / 0.15);
  assert.equal(r.validated, true); near(r.central, 133.3333333333, 1e-6);
  near(r.low, 100 * (1 + (5 / 0.15 - 13.09) / 100), 1e-9); near(r.high, 100 * (1 + (5 / 0.15 + 13.09) / 100), 1e-9);
  assert.equal(r.badge, "VALIDATED 30 DAYS (≤ 8% supply loss)");
});
t("exactly 8 percent is still inside the range", () => assert.equal(wtiScenario(100, 8, 8 / 0.15).validated, true));
t("above 8 percent: outside the range, no band, the badge says so", () => {
  const r = wtiScenario(100, 8.5, 8.5 / 0.15);
  assert.equal(r.validated, false); assert.equal(r.low, null); assert.equal(r.high, null); assert.equal(r.badge, "OUTSIDE VALIDATED RANGE");
  near(r.central, 100 * (1 + 8.5 / 0.15 / 100), 1e-9);
});
t("a surplus (negative supply loss) is inside the range and lowers the price", () => { const r = wtiScenario(100, -3, -3 / 0.15); assert.equal(r.validated, true); assert.ok(r.central < 100); });
t("no usable base price: no number", () => {
  for (const base of [null, 0, -5, NaN, Infinity]) assert.equal(wtiScenario(base, 5, 33), null);
  assert.equal(wtiScenario(100, 5, NaN), null);
});
t("zero supply loss gives the base price back", () => near(wtiScenario(103.37, 0, 0).central, 103.37));

console.log(`${n} checks passed`);
