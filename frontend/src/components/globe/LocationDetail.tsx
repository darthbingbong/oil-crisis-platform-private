import { useMemo } from "react";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { TOKENS } from "../../lib/constants";
import type { ConflictEvent, CurrentConditions, Location } from "../../types";
import CurrentConditionsNote from "../CurrentConditionsNote";

interface Props {
  location: Location;
  conflicts: ConflictEvent[];
  visible: boolean;
  onBack: () => void;
  /** Shown on the Hormuz chokepoint view: baseline data is pre-crisis, real 2026 conditions differ. */
  currentConditions?: CurrentConditions | null;
}

const TYPE_LABEL: Record<Location["type"], string> = {
  chokepoint: "Maritime chokepoint",
  hub: "Refinery / export hub",
  city: "Demand center",
};

/** Full-bleed detail view for a traveled-to location, crossfaded in once the
 * camera flight completes (see EarthGlobe's phase machine). Stays mounted
 * (at opacity 0, non-interactive) during travel/return so the fade has
 * something to animate to/from -- unmounted only back at "idle". */
export default function LocationDetail({ location, conflicts, visible, onBack, currentConditions = null }: Props) {
  const accentColor = location.accent === "crude" ? TOKENS.crude : TOKENS.ion;

  const history = useMemo(
    () =>
      conflicts
        .filter((c) => c.chokepoint.toLowerCase() === location.name.toLowerCase())
        .slice()
        .sort((a, b) => a.event_date.localeCompare(b.event_date)),
    [conflicts, location.name]
  );

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 10,
        background: "rgba(3,3,3,0.94)",
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 320ms ease",
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
      }}
      aria-hidden={!visible}
      data-testid="location-detail"
    >
      <div style={{ padding: "28px 40px", display: "flex", flexDirection: "column", gap: 28, flex: 1 }}>
        <button
          type="button"
          onClick={onBack}
          tabIndex={visible ? 0 : -1}
          className="section-label"
          style={{
            alignSelf: "flex-start",
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            color: "var(--color-ash)",
          }}
        >
          ← Back to overview
        </button>

        <div>
          <div className="section-label" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: accentColor }} />
            {TYPE_LABEL[location.type]}
          </div>
          <h1
            className="display-heading"
            style={{ fontSize: "clamp(40px, 6vw, 96px)", lineHeight: 1.02, margin: 0 }}
          >
            {location.name}
          </h1>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 24,
            maxWidth: 760,
          }}
        >
          {location.metrics.map((m) => {
            const isNumeric = /^[\d,.\s%-]+$/.test(m.value);
            return (
            <div key={m.label}>
              <div className="section-label" style={{ marginBottom: 6 }}>
                {m.label}
              </div>
              <div
                className={isNumeric ? "data-readout" : undefined}
                style={{
                  fontSize: isNumeric ? "clamp(22px, 2.6vw, 34px)" : 16,
                  fontWeight: isNumeric ? 400 : 300,
                  color: isNumeric ? accentColor : "var(--color-bone)",
                }}
              >
                {m.value}
                {m.unit && m.unit !== "illustrative" ? ` ${m.unit}` : ""}
              </div>
              {m.delta && (
                <div className="data-readout" style={{ fontSize: 12, color: "var(--color-ash)", marginTop: 2 }}>
                  {m.delta}
                </div>
              )}
            </div>
            );
          })}
        </div>

        <p
          className="text-sm font-light leading-relaxed"
          style={{ color: "var(--color-bone)", maxWidth: 640 }}
        >
          {location.narrative}
        </p>

        {history.length > 1 && (
          <div style={{ maxWidth: 420 }}>
            <div className="section-label" style={{ marginBottom: 6 }}>
              Supply loss over recorded events
            </div>
            <div style={{ height: 48 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                  <Line
                    type="monotone"
                    dataKey="supply_loss_pct"
                    stroke={TOKENS.alarm}
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {location.type === "chokepoint" && location.name.toLowerCase() === "hormuz" && (
          <div style={{ maxWidth: 640 }}>
            <CurrentConditionsNote conditions={currentConditions} />
          </div>
        )}

        <p
          className="text-xs font-light italic"
          style={{ color: "var(--color-ash)", maxWidth: 640, marginTop: "auto" }}
        >
          {location.sourceNote}
        </p>
      </div>
    </div>
  );
}
