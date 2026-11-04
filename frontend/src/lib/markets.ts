// M13 Markets panel: the symbol lists, the TradingView widget settings and the one scenario number (WTI). Pure functions, no React, so the plain-node checks
// (e2e/markets_unit.mjs) can run them.
//
// What this panel is and is not: indices, natural gas, gold, silver, copper and FX are drawn by TradingView's own free "Market Overview" widget (an iframe from
// TradingView). We never see its prices, so we cannot stamp an "as of" time or a delay on them and we never write LIVE. WTI and Brent are our own cards from the EIA
// feed. Only the WTI card may show a scenario number, from the same 30-day formula and the same validated-range rule as the Results page.

export type MarketTab = "indices" | "commodities" | "fx";

export interface MarketSymbol { name: string; displayName: string }

export const TAB_LABEL: Record<MarketTab, string> = { indices: "Indices", commodities: "Commodities", fx: "FX" };
export const TABS: MarketTab[] = ["indices", "commodities", "fx"];

/** TradingView symbols. If a symbol is not available to the widget it shows its own "invalid symbol" row; nothing here is invented. */
export const TAB_SYMBOLS: Record<MarketTab, MarketSymbol[]> = {
  // Symbols were tried one by one in the real widget on 2026-11-04 (docs/m13_screenshots/_probe). Rows marked CFD are broker quotes (FOREXCOM, OANDA,
  // CAPITALCOM) that track the index or commodity closely but are not the official index level or an exchange price. Not available in TradingView's free
  // widget, so not listed: Nasdaq Composite (NASDAQ:IXIC) and Nifty 50 (NSE:NIFTY) showed "no data"; the Nasdaq 100 stands in for the Nasdaq and Sensex covers India.
  indices: [
    { name: "FOREXCOM:SPXUSD", displayName: "S&P 500 (CFD)" },
    { name: "FOREXCOM:DJI", displayName: "Dow Jones (CFD)" },
    { name: "FOREXCOM:NSXUSD", displayName: "Nasdaq 100 (CFD)" },
    { name: "FOREXCOM:UK100", displayName: "FTSE 100 (CFD)" },
    { name: "XETR:DAX", displayName: "DAX" },
    { name: "FOREXCOM:JP225", displayName: "Nikkei 225 (CFD)" },
    { name: "OANDA:HK33HKD", displayName: "Hang Seng (CFD)" },
    { name: "BSE:SENSEX", displayName: "Sensex" },
    { name: "CAPITALCOM:VIX", displayName: "VIX (CFD)" },
  ],
  // WTI and Brent are NOT here: they are our own EIA cards above the widget, so one barrel price is never shown twice with two different numbers.
  commodities: [
    { name: "OANDA:NATGASUSD", displayName: "Natural gas (CFD)" },
    { name: "TVC:GOLD", displayName: "Gold" },
    { name: "TVC:SILVER", displayName: "Silver" },
    { name: "CAPITALCOM:COPPER", displayName: "Copper (CFD, USD/lb)" },
  ],
  fx: [
    { name: "FX:EURUSD", displayName: "EUR/USD" },
    { name: "FX:USDJPY", displayName: "USD/JPY" },
    { name: "FX_IDC:USDCNY", displayName: "USD/CNY" },
    { name: "FX_IDC:USDINR", displayName: "USD/INR" },
    { name: "CAPITALCOM:DXY", displayName: "Dollar index (DXY, CFD)" },
  ],
};

/** Said under the Indices tab: what is missing and why. */
export const INDICES_NOTE = "Not shown: Nasdaq Composite and Nifty 50 (TradingView's free widget returns no data for them; the Nasdaq 100 and the Sensex stand in).";

/** Said under every tab, at every screen width: what "CFD" in a row name means. */
export const CFD_NOTE = "Rows marked CFD are broker quotes that track the index or commodity closely, not the official level or an exchange price.";

export const TV_SCRIPT_URL = "https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js";
export const TV_HOME = "https://www.tradingview.com/";
/** The Market Overview rows are about 60 px tall. */
export const widgetHeight = (tab: MarketTab): number => 50 + TAB_SYMBOLS[tab].length * 62;

export function widgetConfig(tab: MarketTab): Record<string, unknown> {
  return {
    colorTheme: "dark",
    dateRange: "1M",
    showChart: false,
    locale: "en",
    largeChartUrl: "",
    isTransparent: true,
    showSymbolLogo: false,
    showFloatingTooltip: false,
    support_host: "https://www.tradingview.com",
    width: "100%",
    height: widgetHeight(tab),
    tabs: [{ title: TAB_LABEL[tab], symbols: TAB_SYMBOLS[tab].map((x) => ({ s: x.name, d: x.displayName })), originalTitle: TAB_LABEL[tab] }],
  };
}

/** The chip on every widget tab. Exactly this wording; there is no "as of" time and never LIVE. */
export const WIDGET_CHIP = "Via TradingView widget, delay set by TradingView";

/** The "?" tooltip: TradingView's own wording, from its widget FAQ (checked 2026-11-04), and what we do not know. */
export const WIDGET_HELP =
  'Drawn by TradingView\'s free Market Overview widget, loaded from TradingView. TradingView says of its widget data: "As per their requirements we are only allowed to stream delayed data" for stocks, and "Forex and crypto data is real-time". ' +
  "It does not publish the delay per exchange, and this site never sees the prices, so no delay or \"as of\" time is shown here and nothing is labelled LIVE. Rows marked CFD are broker quotes (FOREXCOM, OANDA, CAPITALCOM) that track the index or commodity closely but are not the official index level or an exchange price. Quotes are for information only, not investment advice.";

export const EIA_HELP =
  "From the EIA spot-price API through this site's server. EIA publishes daily closes in a weekly release, so the newest point is usually several days old. It is a last close, not a live quote.";

// ---- the WTI scenario number --------------------------------------------------------------------------------------------------------------------------------
/** Largest supply loss among the 21 events the formula's error was measured on (backend/data/events.csv; the backend reports the same value). */
export const VALIDATED_SUPPLY_LOSS_MAX_PCT = 8;
/** Formula MAE at 30 days on those 21 events, in percentage points (backend/phase1_analysis.py output). */
export const FORMULA_BAND_PP = 13.09;

export interface WtiScenario {
  basePrice: number;
  /** 30-day price move from the formula, in percent (supply_loss_pct / 0.15, as returned by /simulate) */
  movePct: number;
  central: number;
  /** only inside the validated range; null outside it */
  low: number | null;
  high: number | null;
  validated: boolean;
  badge: string;
}

/**
 * The 30-day WTI scenario number: latest EIA close x (1 + move). Inside the validated range (supply loss up to 8%) the measured +/-13.09 pp band is applied to
 * the MOVE (so the range is base x (1 + (move -/+ 13.09)/100)); outside it there is no band and the badge says so.
 * Returns null when there is no usable price base.
 */
export function wtiScenario(basePrice: number | null, supplyLossPct: number, movePct: number): WtiScenario | null {
  if (basePrice === null || !Number.isFinite(basePrice) || basePrice <= 0 || !Number.isFinite(movePct)) return null;
  const validated = supplyLossPct <= VALIDATED_SUPPLY_LOSS_MAX_PCT;
  const at = (m: number) => basePrice * (1 + m / 100);
  return {
    basePrice,
    movePct,
    central: at(movePct),
    low: validated ? at(movePct - FORMULA_BAND_PP) : null,
    high: validated ? at(movePct + FORMULA_BAND_PP) : null,
    validated,
    badge: validated ? `VALIDATED 30 DAYS (≤ ${VALIDATED_SUPPLY_LOSS_MAX_PCT}% supply loss)` : "OUTSIDE VALIDATED RANGE",
  };
}
