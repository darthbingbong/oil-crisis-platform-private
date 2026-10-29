import type { ReactNode } from "react";
import type { Assumption } from "../../types";

interface Props {
  index: number;
  testId: string;
  title: string;
  summary: string;
  takeaway: string;
  assumptions: Assumption[];
  children: ReactNode;      // the chart (and any controls)
}

/** One report section: chart, a 2-4 sentence summary written by the backend from computed numbers, a one-line key takeaway,
 * and a collapsible "Assumptions and sources" block. The text is never composed here, so it cannot disagree with the chart. */
export default function ReportSection({ index, testId, title, summary, takeaway, assumptions, children }: Props) {
  return (
    <section data-testid={testId} aria-labelledby={`${testId}-h`} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 id={`${testId}-h`} className="section-label" style={{ color: "var(--color-bone)", fontSize: 13 }}>
        {index}. {title}
      </h2>

      <div style={{ minWidth: 0 }}>{children}</div>

      <p data-testid={`${testId}-summary`} className="text-sm font-light leading-relaxed" style={{ color: "var(--color-bone)", margin: 0, maxWidth: 820 }}>
        {summary}
      </p>

      <p data-testid={`${testId}-takeaway`} className="text-sm" style={{ margin: 0, borderLeft: "2px solid var(--color-crude)", paddingLeft: 12, color: "var(--color-bone)", fontWeight: 500 }}>
        <span className="section-label" style={{ color: "var(--color-crude)", marginRight: 8 }}>Key takeaway</span>
        {takeaway}
      </p>

      <details data-testid={`${testId}-assumptions`}>
        <summary className="section-label" style={{ cursor: "pointer", padding: "6px 0" }}>Assumptions and sources ({assumptions.length})</summary>
        <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10, maxWidth: 820 }}>
          {assumptions.map((a, i) => (
            <li key={i} className="text-xs font-light leading-relaxed" style={{ color: "var(--color-ash)" }}>
              {a.is_estimate && (
                <span className="section-label" style={{ marginRight: 8, padding: "0 5px", border: "1px solid var(--color-crude)", color: "var(--color-crude)", borderRadius: 3, fontSize: 11 }}>
                  estimate / assumption
                </span>
              )}
              {a.text}
              {a.source && (
                <span style={{ display: "block", marginTop: 2 }}>
                  Source:{" "}
                  {a.source_url ? (
                    <a href={a.source_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-ash)", textDecoration: "underline", wordBreak: "break-word" }}>
                      {a.source}
                    </a>
                  ) : (
                    a.source
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      </details>
      <div className="hairline" />
    </section>
  );
}
