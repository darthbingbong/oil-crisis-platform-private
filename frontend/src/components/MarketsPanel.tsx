import { useEffect, useId, useMemo, useRef, useState } from "react";
import { usePriceState } from "../hooks/priceContext";
import { CFD_NOTE, EIA_HELP, FORMULA_BAND_PP, INDICES_NOTE, TABS, TAB_LABEL, TV_SCRIPT_URL, WIDGET_CHIP, WIDGET_HELP, widgetConfig, widgetHeight, wtiScenario, type MarketTab } from "../lib/markets";
import { TOKENS } from "../lib/constants";
import type { PriceLive } from "../types";
import TradingViewWidget from "./TradingViewWidget";

/** The scenario the Crisis Scenario panel is showing right now (lifted to the dashboard). */
export interface ScenarioNumbers { supplyLossPct: number; movePct: number }

function Help({ text, label }: { text: string; label: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        data-testid="markets-help"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="section-label"
        style={{ width: 28, height: 28, borderRadius: 14, border: "1px solid rgba(244,241,234,0.3)", background: "transparent", cursor: "help", padding: 0, lineHeight: "26px" }}
      >
        ?
      </button>
      {open && (
        <div id={id} role="tooltip" data-testid="markets-help-text" className="text-xs leading-relaxed"
          style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 50, width: 300, padding: "10px 12px", borderRadius: 6, background: "rgba(8,8,8,0.97)", border: "1px solid rgba(244,241,234,0.16)", color: TOKENS.bone }}>
          {text}
        </div>
      )}
    </span>
  );
}

function Chip({ text, color, testId }: { text: string; color: string; testId?: string }) {
  return <span data-testid={testId} className="section-label" style={{ padding: "2px 8px", border: `1px solid ${color}`, color, borderRadius: 4, textAlign: "left" }}>{text}</span>;
}

const money = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Change({ change, pct }: { change: number | null; pct: number | null }) {
  if (change === null || pct === null) return <span style={{ color: TOKENS.ash }}>n/a</span>;
  const color = change === 0 ? TOKENS.ash : change > 0 ? TOKENS.gain : TOKENS.alarm;
  return <span className="data-readout" style={{ color }}>{change > 0 ? "▲ +" : change < 0 ? "▼ " : ""}{change.toFixed(2)} ({pct > 0 ? "+" : ""}{pct.toFixed(2)}%)</span>;
}

/** WTI and Brent: our own cards from the EIA feed (daily close or the dated offline fallback), never a widget. */
function EiaCard({ name, value, change, pct, live, scenario, showScenario }: {
  name: "WTI" | "Brent"; value: number | null; change: number | null; pct: number | null; live: PriceLive;
  scenario: ScenarioNumbers | null; showScenario: boolean;
}) {
  const fallback = live.status === "OFFLINE_FALLBACK";
  const chipColor = fallback ? TOKENS.alarm : TOKENS.crude;
  const result = name === "WTI" && showScenario && scenario && !fallback ? wtiScenario(live.wti, scenario.supplyLossPct, scenario.movePct) : null;
  return (
    <div data-testid={`eia-card-${name.toLowerCase()}`} className="flex flex-col gap-2" style={{ border: "1px solid rgba(244,241,234,0.1)", borderRadius: 6, padding: "10px 12px" }}>
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <span className="section-label" style={{ color: TOKENS.bone }}>{name} spot</span>
        <span className="flex items-center gap-2">
          <Chip text={live.status} color={chipColor} testId={`eia-chip-${name.toLowerCase()}`} />
          <Help text={EIA_HELP} label={`About the ${name} price`} />
        </span>
      </div>
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="data-readout" style={{ fontSize: 20, color: TOKENS.bone }} data-testid={`eia-value-${name.toLowerCase()}`}>{value === null ? "n/a" : `$${money(value)}`}</span>
        <span style={{ fontSize: 12 }}><Change change={change} pct={pct} /></span>
        <span className="text-xs" style={{ color: TOKENS.ash }}>per barrel</span>
      </div>
      <div className="text-xs" style={{ color: TOKENS.ash }} data-testid={`eia-asof-${name.toLowerCase()}`}>
        As of {name === "Brent" ? live.brent_as_of ?? live.as_of : live.as_of}
        {live.age_days > 0 ? `, ${live.age_days} day${live.age_days === 1 ? "" : "s"} old` : ", today"}
        {fallback ? " (saved fallback, not current)" : ""}
      </div>
      {name === "WTI" && showScenario && !result && (
        <div className="text-xs" data-testid="wti-scenario-unavailable" style={{ color: TOKENS.crude }}>
          {fallback ? "Scenario number off: the price shown is a stale saved fallback, not a usable starting price." : "Scenario number unavailable: no WTI price or scenario yet."}
        </div>
      )}
      {result && (
        <div data-testid="wti-scenario" className="flex flex-col gap-1" style={{ borderTop: "1px solid rgba(244,241,234,0.1)", paddingTop: 8 }}>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="section-label" style={{ color: TOKENS.bone }}>30-day scenario</span>
            <Chip text={result.badge} color={result.validated ? TOKENS.gain : TOKENS.alarm} testId="wti-scenario-badge" />
          </div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="data-readout" style={{ fontSize: 18, color: result.movePct > 0 ? TOKENS.crude : TOKENS.bone }} data-testid="wti-scenario-value">${money(result.central)}</span>
            <span className="data-readout" style={{ fontSize: 12, color: TOKENS.ash }}>{result.movePct > 0 ? "+" : ""}{result.movePct.toFixed(1)}%</span>
          </div>
          <div className="text-xs" style={{ color: TOKENS.ash }} data-testid="wti-scenario-range">
            {result.validated && result.low !== null && result.high !== null
              ? `Measured error ± ${FORMULA_BAND_PP} pp: $${money(result.low)} to $${money(result.high)}.`
              : "Beyond the 8% supply loss the formula was tested on: an extrapolation, no error band is shown."}
          </div>
          <div className="text-xs" style={{ color: TOKENS.ash }}>
            Model scenario from the Crisis Scenario panel (supply loss {scenario?.supplyLossPct}% ÷ 0.15) applied to the last EIA close. Not a forecast.
          </div>
        </div>
      )}
    </div>
  );
}

export default function MarketsPanel({ scenario }: { scenario: ScenarioNumbers | null }) {
  const [tab, setTab] = useState<MarketTab>("indices");
  // A widget stays mounted (hidden) once its tab has been opened, so switching back does not reload it; none loads before its tab is first opened.
  const [visited, setVisited] = useState<MarketTab[]>(["indices"]);
  const openTab = (t: MarketTab) => { setTab(t); setVisited((v) => (v.includes(t) ? v : [...v, t])); };
  const [showScenario, setShowScenario] = useState(false);
  const price = usePriceState();
  const tabsId = useId();
  // Nothing is requested from TradingView until the panel has been scrolled into view once (on a laptop it sits below the map), so a visitor who never
  // looks at the Markets panel never loads it and the map keeps all its frames.
  const sectionRef = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || seen) return;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  const configs = useMemo(() => Object.fromEntries(TABS.map((t) => [t, widgetConfig(t)])) as Record<MarketTab, Record<string, unknown>>, []);
  const shown = price.kind === "ready" ? price.live : price.kind === "error" ? price.last?.live ?? null : null;

  return (
    <section ref={sectionRef} data-testid="markets-panel" data-widgets-requested={seen} aria-label="Markets" className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="section-label" style={{ color: "var(--color-bone)" }}>Markets</h2>
        <span className="text-[11px]" style={{ color: TOKENS.ash }}>Quotes for information only, not investment advice.</span>
      </div>

      <div role="tablist" aria-label="Market groups" className="flex gap-1.5">
        {TABS.map((t) => (
          <button key={t} role="tab" id={`${tabsId}-${t}`} aria-selected={tab === t} aria-controls={`${tabsId}-panel`} data-testid={`markets-tab-${t}`} type="button"
            onClick={() => openTab(t)} className="section-label"
            style={{ padding: "6px 12px", minHeight: 32, borderRadius: 4, cursor: "pointer", background: tab === t ? "rgba(244,241,234,0.12)" : "transparent", color: tab === t ? TOKENS.bone : TOKENS.ash, border: `1px solid ${tab === t ? "rgba(244,241,234,0.3)" : "rgba(244,241,234,0.12)"}` }}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${tab}`} className="flex flex-col gap-3">
        {tab === "commodities" && (
          <>
            {shown ? (
              <>
                <EiaCard name="WTI" value={shown.wti} change={shown.change} pct={shown.change_pct} live={shown} scenario={scenario} showScenario={showScenario} />
                <label className="flex items-center gap-2 text-xs" style={{ color: TOKENS.bone, cursor: "pointer" }}>
                  <input type="checkbox" data-testid="wti-scenario-toggle" checked={showScenario} onChange={(e) => setShowScenario(e.target.checked)} />
                  Show the 30-day scenario on the WTI card (WTI only; no other card has a scenario number)
                </label>
                <EiaCard name="Brent" value={shown.brent} change={shown.brent_change} pct={shown.brent_change_pct} live={shown} scenario={null} showScenario={false} />
              </>
            ) : (
              <div role="status" data-testid="eia-loading" className="text-xs" style={{ color: price.kind === "error" ? TOKENS.alarm : TOKENS.ash }}>
                {price.kind === "error" ? "WTI and Brent unavailable: the backend could not be reached." : "Loading WTI and Brent..."}
              </div>
            )}
          </>
        )}

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Chip text={WIDGET_CHIP} color={TOKENS.lane} testId="widget-chip" />
          <Help text={WIDGET_HELP} label="About these quotes" />
        </div>
        {seen && visited.map((t) => (
          <div key={t} hidden={t !== tab} style={{ overflowX: "auto" }}>
            <TradingViewWidget scriptSrc={TV_SCRIPT_URL} config={configs[t]} height={widgetHeight(t)} title={`${TAB_LABEL[t]} quotes from TradingView`} />
          </div>
        ))}
        {tab === "indices" && <p className="text-[11px]" style={{ margin: 0, color: TOKENS.ash }} data-testid="indices-note">{INDICES_NOTE}</p>}
        <p className="text-[11px]" style={{ margin: 0, color: TOKENS.ash }} data-testid="cfd-note">{CFD_NOTE}</p>
        {tab === "commodities" && (
          <p className="text-[11px]" style={{ margin: 0, color: TOKENS.ash }} data-testid="lithium-note">No free source for lithium prices, so none are shown.</p>
        )}
        <p className="text-[11px]" style={{ margin: 0, color: TOKENS.ash }} data-testid="widget-load-note">
          These rows load from TradingView, so your browser contacts TradingView when this tab is open.
        </p>
      </div>
    </section>
  );
}
