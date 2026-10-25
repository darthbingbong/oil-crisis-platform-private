import type { CurrentConditions } from "../types";

/** Shown on the Hormuz location view and on every route panel: baseline data is a pre-crisis year,
 * and real 2026 conditions differ. Links go to EIA's latest releases. */
export default function CurrentConditionsNote({ conditions }: { conditions: CurrentConditions | null }) {
  if (!conditions) return null;
  return (
    <div
      data-testid="current-conditions"
      style={{
        borderLeft: "2px solid var(--color-alarm)",
        padding: "6px 0 6px 12px",
        background: "linear-gradient(90deg, rgba(255,59,59,0.07), transparent)",
      }}
    >
      <div className="section-label" style={{ color: "var(--color-alarm)", marginBottom: 4 }}>
        Current conditions
      </div>
      <p className="text-xs font-light leading-relaxed" style={{ color: "var(--color-bone)", margin: 0 }}>
        {conditions.note}
      </p>
      <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none" }}>
        {conditions.links.map((l) => (
          <li key={l.url}>
            <a
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs"
              style={{ color: "var(--color-crude)", textDecoration: "underline" }}
            >
              {l.label} ↗
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
