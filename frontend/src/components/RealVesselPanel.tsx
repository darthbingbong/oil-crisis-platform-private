import { memo } from "react";
import type { WatchVessel } from "../types";
import type { VesselExtras } from "../hooks/useVesselExtras";
import { ageText, fmtUtc } from "../lib/format";
import { Row } from "./VesselUi";

const STATE_COLOR: Record<WatchVessel["state"], string> = { LIVE: "var(--color-gain)", DELAYED: "var(--color-caution)", STALE: "var(--color-alarm)", SNAPSHOT: "var(--color-ion)" };
const NEAR_SHOWN = 6;

function TrackBlock({ extras }: { extras: VesselExtras }) {
  const t = extras.track;
  if (extras.loading && !t) return <div className="text-xs" style={{ color: "var(--color-ash)" }}>Looking for a saved track…</div>;
  if (!t || t.status !== "SAVED") {
    return <div data-testid="vessel-track-label" className="text-xs" style={{ color: "var(--color-ash)" }}>{t?.label ?? "no saved track"}</div>;
  }
  return (
    <div data-testid="vessel-track-info">
      <div data-testid="vessel-track-label" className="text-xs" style={{ color: "var(--color-ion)", fontWeight: 600 }}>
        {t.label}
        {t.headline && <span data-testid="vessel-track-headline" style={{ marginLeft: 6, color: "var(--color-bone)", border: "1px solid rgba(244,241,234,0.4)", borderRadius: 3, padding: "0 4px" }}>HEADLINE TRACK</span>}
      </div>
      {t.motion_note && <div data-testid="vessel-track-motion" className="text-xs" style={{ color: "var(--color-caution)", marginTop: 2 }}>{t.motion_note}</div>}
      <div className="text-xs" style={{ color: "var(--color-ash)", marginTop: 3 }}>
        {t.first_point_utc ? `${fmtUtc(t.first_point_utc)} to ${fmtUtc(t.last_point_utc ?? null)}` : ""}
        {t.path_nm != null ? ` · ${t.path_nm} nm sailed, ${t.start_to_end_nm} nm start to end` : ""}
        {t.points_provider ? ` · ${t.points_provider.toLocaleString("en-US")} AIS points` : ""}
      </div>
      <div className="text-xs" style={{ color: "var(--color-ash)", marginTop: 2 }}>AIS positions joined by a line; not a surveyed route.</div>
    </div>
  );
}

function NearBlock({ extras }: { extras: VesselExtras }) {
  const n = extras.near;
  if (extras.loading && !n) return null;
  if (!n || n.status !== "SAVED SAMPLE") {
    return <div data-testid="vessel-near" className="text-xs" style={{ color: "var(--color-ash)" }}>{n?.message ?? "No saved Nearby sample for this vessel."} {n?.note}</div>;
  }
  const shown = n.vessels.slice(0, NEAR_SHOWN);
  return (
    <div data-testid="vessel-near">
      <div data-testid="vessel-near-label" className="text-xs" style={{ color: "var(--color-ion)", fontWeight: 600 }}>{n.label}</div>
      <div className="text-xs" style={{ color: "var(--color-ash)", marginTop: 2 }}>{n.note}</div>
      <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none" }}>
        {shown.map((v) => (
          <li key={v.mmsi} className="text-xs" style={{ display: "flex", justifyContent: "space-between", gap: 8, color: "var(--color-bone)", padding: "1px 0" }}>
            <span>{v.name ?? `MMSI ${v.mmsi}`} <span style={{ color: "var(--color-ash)" }}>{v.tanker ? "tanker" : `type ${v.ship_type ?? "?"}`}</span></span>
            <span className="data-readout" style={{ color: "var(--color-ash)" }}>{v.distance_nm} nm</span>
          </li>
        ))}
      </ul>
      <div className="text-xs" style={{ color: "var(--color-ash)", marginTop: 3 }}>
        {n.returned != null ? `${shown.length} of the ${n.returned} vessels in the sample listed, nearest first. ` : ""}{n.distances_note}
      </div>
      <div className="text-xs" style={{ color: "var(--color-ash)", marginTop: 3 }}>{n.caveat}</div>
    </div>
  );
}

/** A real tanker from the saved watchlist, on both the globe and the 2D map. Its state is SNAPSHOT unless it was just refreshed; "last seen" is measured from now, and
 *  nothing here says what it carries. The saved past track and the saved Nearby sample come with it (from disk; no provider call). */
const RealVesselPanel = memo(function RealVesselPanel({ vessel, extras, keyLine, onClose, style }: { vessel: WatchVessel; extras: VesselExtras; keyLine?: string | null; onClose: () => void; style?: React.CSSProperties }) {
  const v = vessel;
  return (
    <div
      data-testid="watch-vessel-panel"
      role="dialog"
      aria-label="Real vessel details"
      style={{ position: "absolute", right: 12, top: 12, zIndex: 7, width: 310, maxWidth: "calc(100% - 24px)", maxHeight: "calc(100% - 24px)", overflowY: "auto", background: "rgb(3,3,3)", border: "1px solid rgba(244,241,234,0.16)", borderRadius: 6, padding: "12px 14px", ...style }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <div className="section-label" data-testid="watch-vessel-state" style={{ color: STATE_COLOR[v.state], marginBottom: 3 }}>
            {v.state === "SNAPSHOT" ? `SNAPSHOT ${fmtUtc(v.record_fetched_utc)}` : v.state} · REAL VESSEL
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-bone)" }}>{v.name ?? `MMSI ${v.mmsi}`}</div>
        </div>
        <button type="button" data-testid="watch-vessel-close" aria-label="Close vessel details" onClick={onClose} style={{ color: "var(--color-ash)", fontSize: 16, lineHeight: 1, cursor: "pointer" }}>
          {"×"}
        </button>
      </div>
      <div style={{ marginTop: 8 }}>
        <Row k="Last seen" v={`${ageText(v.last_seen_age_s_now)}${v.last_seen_utc ? ` (${fmtUtc(v.last_seen_utc)})` : ""}`} />
        <Row k="MMSI" v={String(v.mmsi)} />
        <Row k="IMO" v={v.imo ? String(v.imo) : "not reported"} />
        <Row k="Flag" v={v.flag ?? "not reported"} />
        <Row k="Type" v={`tanker (AIS type ${v.ship_type})`} />
        <Row k="Length" v={v.length_m ? `${v.length_m} m` : "not reported"} />
        <Row k="Speed" v={v.sog_kn == null ? "not reported" : `${v.sog_kn.toFixed(1)} kn`} />
        <Row k="Course" v={v.cog_deg == null ? "not reported" : `${v.cog_deg.toFixed(0).padStart(3, "0")}°`} />
        <Row k="Destination" v={v.destination ?? "not reported"} />
        <Row k="Draught" v={v.draught_m ? `${v.draught_m} m` : "not reported"} />
        <Row k="AIS status" v={`${v.nav_status} (crew-set)`} />
        <Row k="Position" v={`${v.lat.toFixed(3)}°, ${v.lng.toFixed(3)}°`} />
      </div>
      <div className="text-xs" style={{ color: "var(--color-ash)", marginTop: 8 }}>
        {v.area}. Position confirmed by {v.position_confirmed_by ?? "unknown"}; typed as a tanker by the {v.typed_as_tanker_by ?? "provider"}.
        {v.flag_source ? ` Flag: ${v.flag_source}.` : ""} A saved position, not a live one.
      </div>
      <div data-testid="vessel-cargo-note" className="text-xs" style={{ color: "var(--color-crude)", marginTop: 6 }}>{v.cargo_note}</div>
      {keyLine && <div data-testid="vessel-key-line" className="text-xs" style={{ color: "var(--color-alarm)", marginTop: 6 }}>{keyLine}</div>}

      <div className="section-label" style={{ color: "var(--color-ash)", marginTop: 12, marginBottom: 4 }}>PAST TRACK</div>
      <TrackBlock extras={extras} />
      <div className="section-label" style={{ color: "var(--color-ash)", marginTop: 12, marginBottom: 4 }}>VESSELS NEAR THIS VESSEL (10 NM)</div>
      <NearBlock extras={extras} />
    </div>
  );
});

export default RealVesselPanel;
