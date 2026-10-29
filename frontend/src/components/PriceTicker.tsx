import { useId, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { usePrice } from "../hooks/usePrice";
import { TOKENS } from "../lib/constants";
import type { PriceHistory, PriceLive, PriceStatus } from "../types";

const GAIN = TOKENS.gain;
const LANE = TOKENS.lane;

const STATUS_COLOR: Record<PriceStatus, string> = { DAILY_CLOSE: TOKENS.crude, OFFLINE_FALLBACK: TOKENS.alarm };

function Change({ change, pct }: { change: number | null; pct: number | null }) {
  if (change === null || pct === null) return <span style={{ color: TOKENS.ash }}>n/a</span>;
  const up = change >= 0;
  const color = change === 0 ? TOKENS.ash : up ? GAIN : TOKENS.alarm;
  return (
    <span className="data-readout" style={{ color }} data-testid="price-change">
      {change === 0 ? "" : up ? "▲" : "▼"} {up ? "+" : ""}
      {change.toFixed(2)} ({up ? "+" : ""}
      {pct.toFixed(2)}%)
    </span>
  );
}

function Quote({ label, value, change, pct, testId }: { label: string; value: number | null; change: number | null; pct: number | null; testId: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }} data-testid={testId}>
      <span className="section-label">{label}</span>
      <span className="data-readout" style={{ fontSize: 16, color: TOKENS.bone }}>{value === null ? "n/a" : value.toFixed(2)}</span>
      <span style={{ fontSize: 12 }}><Change change={change} pct={pct} /></span>
    </div>
  );
}

function Sparkline({ history }: { history: PriceHistory | null }) {
  if (!history || history.points.length < 2) return <span className="text-xs" style={{ color: TOKENS.ash }} data-testid="sparkline-missing">no history</span>;
  const first = history.points[0].date, last = history.points[history.points.length - 1].date;
  return (
    <div data-testid="sparkline" role="img" aria-label={`30 day sparkline of WTI and Brent spot prices, ${first} to ${last}`} style={{ width: 132, height: 30 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={history.points} margin={{ top: 3, right: 2, left: 2, bottom: 3 }}>
          <YAxis hide domain={["dataMin - 2", "dataMax + 2"]} />
          <Tooltip
            contentStyle={{ background: TOKENS.surface, border: "1px solid rgba(244,241,234,0.14)", fontSize: 11, padding: "4px 8px" }}
            labelStyle={{ color: TOKENS.ash }}
            formatter={(v, name) => [Number(v).toFixed(2), String(name).toUpperCase()]}
          />
          <Line type="monotone" dataKey="brent" stroke={LANE} strokeWidth={1.4} dot={false} connectNulls isAnimationActive={false} />
          <Line type="monotone" dataKey="wti" stroke={TOKENS.bone} strokeWidth={1.6} dot={false} connectNulls isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** What the badge means, in plain words. Opens on hover and keyboard focus. */
function StatusBadge({ live }: { live: PriceLive }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const color = STATUS_COLOR[live.status];
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        data-testid="price-status"
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="section-label"
        style={{ padding: "2px 8px", border: `1px solid ${color}`, color, borderRadius: 4, background: "transparent", cursor: "help" }}
      >
        {live.status} ⓘ
      </button>
      {open && (
        <div
          id={id}
          role="tooltip"
          data-testid="price-status-tooltip"
          style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 50, width: 340, padding: "10px 12px", borderRadius: 6, background: "rgba(8,8,8,0.97)", border: "1px solid rgba(244,241,234,0.16)" }}
        >
          <div className="section-label" style={{ color, marginBottom: 6 }}>{live.status}</div>
          {live.status === "DAILY_CLOSE" ? (
            <p className="text-xs leading-relaxed" style={{ margin: 0, color: TOKENS.bone }}>
              The EIA API answered. EIA spot prices are end-of-day closes, published in a <strong>weekly</strong> release, so the newest point is usually several days
              old. It is the last close, not a live quote.{live.cached ? " Served from the server's cache of that answer." : ""}
            </p>
          ) : (
            <p className="text-xs leading-relaxed" style={{ margin: 0, color: TOKENS.bone }}>
              {live.fallback_message ?? "EIA could not be used, so this is the last row of a local CSV file."} It is dated <strong>{live.as_of}</strong> and is stale, not current.
            </p>
          )}
          <p className="text-xs leading-relaxed" style={{ margin: "8px 0 0", color: TOKENS.ash }}>
            No source here is real time, so nothing is ever labelled LIVE. Source: {live.source}.
          </p>
        </div>
      )}
    </span>
  );
}

const bar: React.CSSProperties = {
  display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 28px", padding: "6px 24px", minHeight: 40,
  borderBottom: "1px solid rgba(244,241,234,0.08)", background: "rgba(3,3,3,0.96)",
};

/** Top ticker: WTI and Brent with coloured change, a 30-day sparkline, the as-of date (and how old it is), and an honest status badge. */
export default function PriceTicker() {
  const state = usePrice();

  if (state.kind === "loading") {
    return (
      <div role="region" aria-label="Oil prices" data-testid="price-ticker" data-state="loading" style={bar} aria-busy="true">
        <span className="section-label">WTI</span><span style={{ width: 70, height: 14, borderRadius: 3, background: "rgba(244,241,234,0.08)" }} />
        <span className="section-label">BRENT</span><span style={{ width: 70, height: 14, borderRadius: 3, background: "rgba(244,241,234,0.08)" }} />
        <span className="text-xs" style={{ color: TOKENS.ash }}>Loading prices...</span>
      </div>
    );
  }

  const shown = state.kind === "ready" ? { live: state.live, history: state.history } : state.last;

  return (
    <div role="region" aria-label="Oil prices" data-testid="price-ticker" data-state={state.kind} style={bar}>
      {shown ? (
        <>
          <Quote label="WTI" value={shown.live.wti} change={shown.live.change} pct={shown.live.change_pct} testId="quote-wti" />
          <Quote label="BRENT" value={shown.live.brent} change={shown.live.brent_change} pct={shown.live.brent_change_pct} testId="quote-brent" />
          <Sparkline history={shown.history} />
          <span className="text-xs" style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }} data-testid="price-as-of">
            <span className="section-label">AS OF</span>
            <span className="data-readout" style={{ color: TOKENS.bone }}>{shown.live.as_of}</span>
            <span data-testid="price-age" title={shown.live.age_warning ?? undefined} style={{ color: shown.live.age_days > 3 ? TOKENS.crude : TOKENS.ash }}>
              {shown.live.age_days === 0 ? "today" : `${shown.live.age_days} day${shown.live.age_days === 1 ? "" : "s"} old`}
            </span>
          </span>
          <StatusBadge live={shown.live} />
          <span className="text-xs" style={{ color: TOKENS.ash }}>USD per barrel</span>
        </>
      ) : null}
      {state.kind === "error" && (
        <span role="alert" data-testid="price-error" className="text-xs" style={{ color: TOKENS.alarm }}>
          {shown ? "Price update failed, showing the last result. " : "Price feed unavailable: the backend could not be reached. "}
          Retrying in {state.retryInSeconds} s.
        </span>
      )}
    </div>
  );
}
