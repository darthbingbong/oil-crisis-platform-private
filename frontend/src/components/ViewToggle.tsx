import type { ViewMode } from "../lib/viewState";

/** GLOBE | MAP switch for the top bar. Selection, scenario and panels are kept when switching (they live in the URL and the dashboard, not in either view). */
export default function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div role="group" aria-label="View" data-testid="view-toggle" style={{ display: "inline-flex", border: "1px solid rgba(244,241,234,0.25)", borderRadius: 4, overflow: "hidden" }}>
      {(["globe", "map"] as const).map((v) => (
        <button
          key={v}
          type="button"
          data-testid={`view-${v}`}
          aria-pressed={view === v}
          onClick={() => view !== v && onChange(v)}
          className="section-label"
          style={{ padding: "5px 12px", cursor: view === v ? "default" : "pointer", color: view === v ? "var(--color-void)" : "var(--color-bone)", background: view === v ? "var(--color-bone)" : "transparent", fontWeight: 600 }}
        >
          {v === "globe" ? "GLOBE" : "MAP"}
        </button>
      ))}
    </div>
  );
}
