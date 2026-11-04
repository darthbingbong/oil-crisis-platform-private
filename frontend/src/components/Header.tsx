import { useEffect, useState } from "react";
import { usePriceState } from "../hooks/priceContext";
import type { PriceLive } from "../types";
import type { ViewMode } from "../lib/viewState";
import ViewToggle from "./ViewToggle";

type BackendStatus = "loading" | "live" | "mock";

interface Props {
  backendStatus: BackendStatus;
  /** GLOBE | MAP switch (shown when both are given) */
  view?: ViewMode;
  onViewChange?: (v: ViewMode) => void;
  /** the vessel search box, between the title and the controls */
  search?: React.ReactNode;
}

const BADGE: Record<BackendStatus, { text: string; color: string }> = {
  loading: { text: "CONNECTING", color: "var(--color-ash)" },
  live: { text: "BACKEND CONNECTED", color: "var(--color-crude)" },
  mock: { text: "OFFLINE · MOCK DATA", color: "var(--color-alarm)" },
};

export default function Header({ backendStatus, view, onViewChange, search }: Props) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const badge = BADGE[backendStatus];
  const price = usePriceState();
  const live: PriceLive | null = price.kind === "ready" ? price.live : price.kind === "error" ? price.last?.live ?? null : null;
  const fallback = live?.status === "OFFLINE_FALLBACK";

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

      {search && <div data-testid="header-search" className="order-last sm:order-none" style={{ flex: "1 1 240px", maxWidth: 380, minWidth: 200 }}>{search}</div>}

      <div className="flex items-center gap-5 shrink-0">
        {view && onViewChange && <ViewToggle view={view} onChange={onViewChange} />}
        {live && live.wti !== null && (
          <div
            className="hidden md:flex items-baseline gap-2"
            data-testid="baseline-price"
            title={`WTI baseline: the latest sourced WTI spot close, EIA Open Data API v2 (series RWTC), dated ${live.as_of} (${live.age_days === 0 ? "today" : `${live.age_days} day${live.age_days === 1 ? "" : "s"} old`}), status ${live.status}${fallback ? " (a saved fallback row, not current)" : ""}. It is the same number as the WTI card in the ticker and the starting price of the WTI scenario card in the Markets panel. The Results page and the scenario panel give percentage moves only, so they have no separate price baseline. A daily close published weekly, never a live quote.`}
          >
            <span className="section-label whitespace-nowrap" style={{ color: "var(--color-ash)" }}>
              WTI BASELINE
            </span>
            <span className="data-readout text-sm" style={{ color: fallback ? "var(--color-alarm)" : "var(--color-crude)" }}>
              ${live.wti.toFixed(2)}
            </span>
            <span className="text-xs whitespace-nowrap" style={{ color: "var(--color-ash)" }}>EIA {live.as_of}{fallback ? " · saved fallback" : ""}</span>
          </div>
        )}
        <div className="data-readout text-xs hidden sm:block" style={{ color: "var(--color-ash)" }}>
          {now.toISOString().slice(0, 19).replace("T", " ")} UTC
        </div>
      </div>
    </header>
  );
}
