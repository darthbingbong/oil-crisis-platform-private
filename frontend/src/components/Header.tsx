import { useEffect, useState } from "react";
import { useAnimatedNumber } from "../lib/useAnimatedNumber";
import type { StreamStatus } from "../hooks/useNewsStream";
import type { PriceState } from "../types";
import type { ViewMode } from "../lib/viewState";
import ViewToggle from "./ViewToggle";

type BackendStatus = "loading" | "live" | "mock";

interface Props {
  backendStatus: BackendStatus;
  priceState: PriceState | null;
  streamStatus: StreamStatus;
  /** GLOBE | MAP switch (shown when both are given) */
  view?: ViewMode;
  onViewChange?: (v: ViewMode) => void;
}

const BADGE: Record<BackendStatus, { text: string; color: string }> = {
  loading: { text: "CONNECTING", color: "var(--color-ash)" },
  live: { text: "BACKEND CONNECTED", color: "var(--color-crude)" },
  mock: { text: "OFFLINE · MOCK DATA", color: "var(--color-alarm)" },
};

export default function Header({ backendStatus, priceState, streamStatus, view, onViewChange }: Props) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const badge = BADGE[backendStatus];
  const animatedPrice = useAnimatedNumber(priceState?.crude_price_usd ?? 0, 800);

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 sm:px-8 py-5">
      <div className="flex items-center gap-4">
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{
            background: badge.color,
            boxShadow: backendStatus === "live" ? `0 0 8px ${badge.color}` : "none",
          }}
        />
        <h1
          className="section-label whitespace-nowrap"
          style={{ color: "var(--color-bone)", letterSpacing: "0.08em" }}
        >
          Oil Crisis Terminal
        </h1>
        <span className="section-label hidden sm:inline whitespace-nowrap" style={{ color: badge.color }}>
          {badge.text}
        </span>
      </div>

      <div className="flex items-center gap-5 shrink-0">
        {view && onViewChange && <ViewToggle view={view} onChange={onViewChange} />}
        {priceState && (
          <div
            className="hidden md:flex items-baseline gap-2"
            style={{ opacity: streamStatus === "open" ? 1 : 0.5, transition: "opacity 300ms ease" }}
            data-testid="model-baseline"
            title={`Model baseline (simulation, not a market price). Source: a hand-set seed of $82.50 (unsourced, "real-ish recent Brent") moved by the price engine, +/-2% at most per classified news headline, drifting back toward the seed. Last updated ${priceState.last_updated_at.slice(0, 19).replace("T", " ")} UTC. For real prices see the EIA ticker above.`}
          >
            <span className="section-label whitespace-nowrap" style={{ color: "var(--color-ash)" }}>
              MODEL BASELINE
            </span>
            <span className="data-readout text-sm" style={{ color: "var(--color-crude)" }}>
              ${animatedPrice.toFixed(2)}
            </span>
          </div>
        )}
        <div className="data-readout text-xs hidden sm:block" style={{ color: "var(--color-ash)" }}>
          {now.toISOString().slice(0, 19).replace("T", " ")} UTC
        </div>
      </div>
    </header>
  );
}
