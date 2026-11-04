import { useState } from "react";
import { fmtUtc } from "../../lib/format";
import type { LayerId } from "../../lib/viewState";
import type { WatchlistResponse } from "../../types";

export interface LayerCounts {
  routes: number;
  chokepoints: number;
  places: number;
  simulated: number;
  watchlist: WatchlistResponse | null;
  watchlistLoading: boolean;
  /** name of the route under a scenario, if any */
  scenarioRoute: string | null;
}

interface Row {
  id: LayerId;
  label: string;
  count: string;
  chip: string;
  chipColor: string;
  disabled?: boolean;
  hint: string;
}

function rows(c: LayerCounts): { group: string; items: Row[] }[] {
  const wl = c.watchlist;
  const haveWatch = !!wl && wl.status === "SNAPSHOT" && wl.vessels.length > 0;
  return [
    { group: "ROUTES", items: [{ id: "routes", label: "Routes and pipelines", count: String(c.routes), chip: "ILLUSTRATIVE GEOMETRY", chipColor: "var(--color-ash)", hint: "Flows and capacities are sourced (EIA, GEM); the lines are hand-placed for drawing, not surveyed lanes." }] },
    {
      group: "PLACES",
      items: [
        { id: "chokepoints", label: "Chokepoints", count: String(c.chokepoints), chip: "SOURCED", chipColor: "var(--color-crude)", hint: "Chokepoint positions from the project's data. Capacity at risk is computed from the refinery table." },
        { id: "places", label: "Hubs and cities", count: String(c.places), chip: "REFINERY TABLE / ILLUSTRATIVE", chipColor: "var(--color-ash)", hint: "Refinery and export hubs from the project's CSV, plus an illustrative list of cities." },
      ],
    },
    {
      group: "TANKERS",
      items: [
        {
          id: "watchlist", label: "Real tankers (watchlist)", count: haveWatch ? String(wl!.vessels.length) : "0", disabled: !haveWatch,
          chip: c.watchlistLoading ? "LOADING" : haveWatch ? `SNAPSHOT ${fmtUtc(wl!.captured_at_utc)}` : "NO SNAPSHOT", chipColor: haveWatch ? "var(--color-ion)" : "var(--color-ash)",
          hint: haveWatch ? wl!.label ?? "" : "No saved snapshot of real tankers on this machine. Only simulated vessels can be shown.",
        },
        { id: "simulated", label: "Simulated traffic", count: c.simulated.toLocaleString("en-US"), chip: "SIMULATED", chipColor: "var(--color-crude)", hint: "Invented for illustration: tankers spread along the route lines at 14 knots with time compressed. No count here is a statistic." },
      ],
    },
    {
      group: "SCENARIO",
      items: [{
        id: "scenario", label: "Scenario overlay", count: c.scenarioRoute ? "1" : "0", chip: c.scenarioRoute ? `ACTIVE · ${c.scenarioRoute}` : "IDLE", chipColor: c.scenarioRoute ? "var(--color-alarm)" : "var(--color-ash)",
        hint: "The disrupted route in crimson, its alternate lane, and an illustrative focus circle. Use Simulate on a route to switch it on.",
      }],
    },
  ];
}

/** Collapsible, grouped layer toggles, each with a count and a status chip. The "?" explains the sources and limits. */
export default function LayersPanel({ on, onToggle, counts }: { on: Set<LayerId>; onToggle: (id: LayerId) => void; counts: LayerCounts }) {
  const [open, setOpen] = useState(() => window.innerWidth >= 900);          // collapsed by default on a tablet or phone, where it would cover the map
  return (
    <div data-testid="layers-panel" style={{ position: "absolute", left: 12, top: 12, zIndex: 6, width: 270, maxWidth: "calc(100% - 24px)", background: "rgba(3,3,3,0.9)", border: "1px solid rgba(244,241,234,0.16)", borderRadius: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px" }}>
        <button type="button" data-testid="layers-collapse" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="section-label" style={{ color: "var(--color-bone)", cursor: "pointer", display: "flex", gap: 6, alignItems: "center", minHeight: 32, minWidth: 32 }}>
          <span aria-hidden>{open ? "▾" : "▸"}</span> LAYERS
        </button>
        <span
          role="note" tabIndex={0} aria-label="About these layers" data-testid="layers-help"
          title="Each layer shows what it is made of. SNAPSHOT = a saved copy with its time. SIMULATED = invented for illustration. Counts of real vessels are of a sample, never of a chokepoint or an area."
          style={{ color: "var(--color-ash)", border: "1px solid rgba(244,241,234,0.25)", borderRadius: 9, width: 18, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, cursor: "help" }}
        >?</span>
      </div>
      {open && (
        <div style={{ padding: "0 10px 10px", maxHeight: "min(60vh, 520px)", overflowY: "auto" }}>
          {rows(counts).map((g) => (
            <div key={g.group} style={{ marginTop: 6 }}>
              <div className="section-label" style={{ color: "var(--color-ash)", fontSize: 11, marginBottom: 3 }}>{g.group}</div>
              {g.items.map((r) => (
                <label key={r.id} title={r.hint} style={{ display: "grid", gridTemplateColumns: "16px 1fr auto", columnGap: 8, alignItems: "start", padding: "4px 0", opacity: r.disabled ? 0.55 : 1, cursor: r.disabled ? "not-allowed" : "pointer" }}>
                  <input type="checkbox" data-testid={`layer-toggle-${r.id}`} checked={on.has(r.id) && !r.disabled} disabled={r.disabled} onChange={() => onToggle(r.id)} style={{ marginTop: 2 }} />
                  <span>
                    <span className="text-xs" style={{ color: "var(--color-bone)" }}>{r.label}</span>
                    <span data-testid={`layer-chip-${r.id}`} className="data-readout" style={{ display: "block", fontSize: 11, color: r.chipColor, marginTop: 1 }}>{r.chip}</span>
                  </span>
                  <span data-testid={`layer-count-${r.id}`} className="data-readout" style={{ fontSize: 11, color: "var(--color-ash)" }}>{r.count}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
