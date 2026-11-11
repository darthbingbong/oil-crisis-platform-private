import { useState } from "react";
import { useHosted } from "../hooks/useHosted";
import { useAisStreamConfigured, type AisStatus, type StreamPhase } from "../hooks/useVesselStream";
import type { VesselInfo } from "../lib/vesselSim";
import { AIS_LIMITS } from "../lib/aisLimits";
import { SIM } from "../lib/vesselSim";

export type VesselMode = "simulated" | "ais";


interface ControlsProps {
  mode: VesselMode;
  setMode: (m: VesselMode) => void;
  /** true when the AIS source is what is actually drawn */
  showingAis: boolean;
  phase: StreamPhase;
  status: AisStatus | null;
  aisCount: number;
}

/** Permanent badge for the vessel layer. In simulated mode it always reads SIMULATED; there is no way to hide it. */
export function VesselControls({ mode, setMode, showingAis, phase, status, aisCount }: ControlsProps) {
  const [open, setOpen] = useState(false);
  const streamConfigured = useAisStreamConfigured();
  const hostedCfg = useHosted();
  const showToggle = hostedCfg?.ais_live_toggle !== false;      // the public site has no AISStream key: the switch is not offered at all
  const notConfigured = streamConfigured === false;       // the live AISStream feed has no key on this server
  const unavailable = mode === "ais" && !showingAis;
  const note =
    mode !== "ais" ? null
      : phase === "connecting" ? "Connecting to the AIS feed. Showing simulated vessels meanwhile."
      : status?.state === "no_key" ? "The live AISStream feed is not configured (no AISStream key on this server). Showing simulated vessels."
      : status?.state === "error" ? `AIS feed error (${status.detail}). Showing simulated vessels.`
      : phase === "closed" ? "AIS connection closed. Showing simulated vessels."
      : status && status.state !== "streaming" ? "Waiting for the first AIS frames. Showing simulated vessels."
      : null;

  return (
    <div data-testid="vessel-controls" style={{ position: "absolute", left: 12, top: 12, zIndex: 6, maxWidth: 330, fontFamily: "var(--font-body)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span
          data-testid="vessel-badge"
          className="section-label"
          style={{
            padding: "3px 8px", borderRadius: 3, border: `1px solid ${showingAis ? "var(--color-ion)" : "var(--color-crude)"}`,
            color: showingAis ? "var(--color-ion)" : "var(--color-crude)", background: "rgba(3,3,3,0.8)", whiteSpace: "nowrap",
          }}
        >
          {showingAis ? "AIS FEED · UNVERIFIED" : "SIMULATED VESSELS"}
        </span>
        <button
          type="button"
          data-testid="vessel-info-button"
          aria-expanded={open}
          aria-label="About vessel data and AIS limits"
          onClick={() => setOpen((o) => !o)}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          style={{ width: 20, height: 20, borderRadius: 10, border: "1px solid rgba(244,241,234,0.3)", color: "var(--color-bone)", background: "rgba(3,3,3,0.8)", fontSize: 11, lineHeight: "18px", cursor: "help" }}
        >
          i
        </button>
        {showToggle && <div role="group" aria-label="Vessel source" style={{ display: "flex", border: "1px solid rgba(244,241,234,0.18)", borderRadius: 3, overflow: "hidden" }}>
          {(["simulated", "ais"] as const).map((m) => (
            <button
              key={m}
              type="button"
              data-testid={`vessel-mode-${m}`}
              aria-pressed={mode === m}
              disabled={m === "ais" && notConfigured}
              title={m === "ais" && notConfigured ? "Not configured: the live AISStream feed needs an AISStream key on the server. The real ShipFinder tankers are the SNAPSHOT layer, not this feed." : undefined}
              onClick={() => setMode(m)}
              className="section-label"
              style={{ padding: "3px 8px", cursor: m === "ais" && notConfigured ? "not-allowed" : "pointer", opacity: m === "ais" && notConfigured ? 0.5 : 1, background: mode === m ? "rgba(244,241,234,0.14)" : "rgba(3,3,3,0.8)", color: mode === m ? "var(--color-bone)" : "var(--color-ash)" }}
            >
              {m === "simulated" ? "Simulated" : "AISStream live"}
            </button>
          ))}
        </div>}
      </div>

      {notConfigured && showToggle && (
        <div data-testid="vessel-feed-explain" className="text-xs" style={{ marginTop: 6, color: "var(--color-ash)", background: "rgba(3,3,3,0.8)", padding: "4px 8px", borderRadius: 3 }}>
          Live AISStream feed: not configured (no AISStream key on this server). The real tankers marked SNAPSHOT are saved ShipFinder positions, not this feed.
        </div>
      )}
      {(note || unavailable) && !notConfigured && showToggle && (
        <div data-testid="vessel-note" className="text-xs" style={{ marginTop: 6, color: "var(--color-crude)", background: "rgba(3,3,3,0.8)", padding: "4px 8px", borderRadius: 3 }}>
          {note}
        </div>
      )}
      {showingAis && (
        <div className="text-xs" style={{ marginTop: 6, color: "var(--color-ash)", background: "rgba(3,3,3,0.8)", padding: "4px 8px", borderRadius: 3 }}>
          {aisCount} tankers reported (type 80 to 89). {status?.disclaimer ?? "Unverified against the live feed."}
        </div>
      )}

      {open && (
        <div data-testid="vessel-info" role="tooltip" style={{ marginTop: 6, background: "rgba(3,3,3,0.96)", border: "1px solid rgba(244,241,234,0.16)", borderRadius: 6, padding: "10px 12px" }}>
          <div className="text-xs" style={{ color: "var(--color-bone)", fontWeight: 600, marginBottom: 4 }}>
            {showingAis ? "AIS vessels (unverified against the live feed)" : "Simulated vessels"}
          </div>
          {!showingAis && (
            <p className="text-xs" style={{ color: "var(--color-bone)", margin: "0 0 6px" }}>
              These tankers are not real ships. They move along the drawn lanes at {SIM.KNOTS} knots with time compressed {SIM.SIM_HOURS_PER_SECOND} simulated hours per second,
              and the number per lane is cosmetic. They are never used in any result or route statistic.
            </p>
          )}
          <p className="text-xs" style={{ color: "var(--color-ash)", margin: "0 0 6px" }}>
            Click a vessel to inspect it: zoom in first, or Shift-click at any zoom. Alt-click selects the route underneath.
          </p>
          <div className="text-xs" style={{ color: "var(--color-ash)", marginBottom: 3 }}>What AIS can and cannot tell you:</div>
          <ul className="text-xs" style={{ color: "var(--color-ash)", margin: 0, paddingLeft: 16, listStyle: "disc" }}>
            {AIS_LIMITS.map((l) => <li key={l} style={{ marginBottom: 2 }}>{l}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

export function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "3px 0", borderBottom: "1px solid rgba(244,241,234,0.06)" }}>
      <span className="section-label" style={{ color: "var(--color-ash)" }}>{k}</span>
      <span className="data-readout" style={{ fontSize: 11, textAlign: "right", color: v.includes("simulated") || v === "not reported" ? "var(--color-ash)" : "var(--color-bone)" }}>{v}</span>
    </div>
  );
}

export function VesselPanel({ info, onClose }: { info: VesselInfo; onClose: () => void }) {
  const sim = info.kind === "simulated";
  return (
    <div
      data-testid="vessel-panel"
      role="dialog"
      aria-label="Vessel details"
      style={{ position: "absolute", right: 12, top: 12, zIndex: 7, width: 300, background: "rgba(3,3,3,0.92)", border: "1px solid rgba(244,241,234,0.16)", borderRadius: 6, padding: "12px 14px" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <div className="section-label" style={{ color: sim ? "var(--color-crude)" : "var(--color-ion)", marginBottom: 3 }}>
            {sim ? "SIMULATED VESSEL" : "AIS REPORT · UNVERIFIED FEED"}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-bone)" }}>{info.name}</div>
        </div>
        <button type="button" data-testid="vessel-panel-close" aria-label="Close vessel details" onClick={onClose} style={{ color: "var(--color-ash)", fontSize: 16, lineHeight: 1, cursor: "pointer", minWidth: 32, minHeight: 32 }}>
          {"×"}
        </button>
      </div>
      <div style={{ marginTop: 8 }}>
        <Row k="MMSI" v={info.mmsi} />
        <Row k="Flag" v={info.flag} />
        <Row k="Speed" v={info.speed} />
        <Row k="Course" v={info.course} />
        <Row k="Destination" v={info.destination} />
        <Row k="Draught" v={info.draught} />
        <Row k="Position" v={`${info.lat.toFixed(2)}°, ${info.lng.toFixed(2)}°`} />
      </div>
      <div className="text-xs" style={{ color: "var(--color-ash)", marginTop: 8 }}>{info.status}</div>
      <div data-testid="vessel-cargo-note" className="text-xs" style={{ color: "var(--color-crude)", marginTop: 6 }}>cargo type not confirmed by AIS</div>
    </div>
  );
}
