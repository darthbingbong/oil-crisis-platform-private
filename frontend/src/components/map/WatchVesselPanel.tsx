import type { WatchVessel } from "../../types";
import { ageText, fmtUtc } from "../../lib/format";
import { Row } from "../VesselUi";

const STATE_COLOR: Record<WatchVessel["state"], string> = { LIVE: "var(--color-gain)", DELAYED: "var(--color-caution)", STALE: "var(--color-alarm)", SNAPSHOT: "var(--color-ion)" };

/** A real tanker from the saved watchlist. Its state is SNAPSHOT unless it was just refreshed; "last seen" is measured from now, and nothing here says what it carries. */
export default function WatchVesselPanel({ vessel, onClose }: { vessel: WatchVessel; onClose: () => void }) {
  const v = vessel;
  return (
    <div
      data-testid="watch-vessel-panel"
      role="dialog"
      aria-label="Real vessel details"
      style={{ position: "absolute", right: 12, top: 12, zIndex: 7, width: 310, background: "rgba(3,3,3,0.94)", border: "1px solid rgba(244,241,234,0.16)", borderRadius: 6, padding: "12px 14px" }}
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
    </div>
  );
}
