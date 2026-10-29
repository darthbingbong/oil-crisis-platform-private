import { TOKENS } from "../../lib/constants";
import { fmtInt, fmtSigned } from "../../lib/format";
import type { ReportResponse } from "../../types";

const th = { fontWeight: 600, textAlign: "left" as const, paddingRight: 24, paddingBottom: 6, color: TOKENS.ash };

/** Economy and markets. A macro effect appears ONLY with a cited coefficient (exact figure, year, link); a source that gives a single
 * figure is shown as a single figure, with no range invented around it. Hard numbers from the model sit beside it, and sector effects
 * stay qualitative, labelled "no sourced coefficient". */
export default function EconomyPanel({ report }: { report: ReportResponse }) {
  const eco = report.sections.economy.chart;
  return (
    <div data-testid="economy-panel" style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div>
        <div className="section-label" style={{ marginBottom: 8 }}>Macro effects from a cited rule of thumb (indicative, not a forecast)</div>
        <div style={{ overflowX: "auto" }}>
          <table data-testid="economy-coefficients" className="text-sm" style={{ borderCollapse: "collapse", color: TOKENS.bone, minWidth: 560 }}>
            <thead><tr><th style={th}>Effect</th><th style={th}>This scenario</th><th style={th}>Per +10% oil price</th><th style={{ ...th, paddingRight: 0 }}>Source</th></tr></thead>
            <tbody>
              {eco.items.map((i) => (
                <tr key={i.key} style={{ verticalAlign: "top" }}>
                  <td style={{ paddingRight: 24, paddingBottom: 10 }}>{i.label}</td>
                  <td className="data-readout" style={{ paddingRight: 24, color: i.low < 0 || i.key.includes("inflation") ? TOKENS.alarm : TOKENS.bone }}>
                    {i.is_point ? `about ${fmtSigned(i.low, 2)} ${i.unit}` : `${fmtSigned(i.low, 2)} to ${fmtSigned(i.high, 2)} ${i.unit}`}
                    {i.is_point && <div className="text-xs" style={{ color: TOKENS.ash, fontFamily: "var(--font-body)" }}>single figure from the source; no range shown</div>}
                  </td>
                  <td className="data-readout" style={{ paddingRight: 24 }}>
                    {i.is_point ? `${fmtSigned(i.per_10pct_low, 1)} ${i.unit}` : `${fmtSigned(i.per_10pct_low, 1)} to ${fmtSigned(i.per_10pct_high, 1)} ${i.unit}`}
                  </td>
                  <td className="text-xs" style={{ color: TOKENS.ash }}>
                    <a href={i.source_url} target="_blank" rel="noopener noreferrer" style={{ color: TOKENS.ash, textDecoration: "underline" }}>{i.source}, {i.year} ↗</a>
                    <div style={{ marginTop: 2, fontStyle: "italic" }}>&ldquo;{i.quote}&rdquo;</div>
                    {i.corroboration && <div style={{ marginTop: 2 }}>Corroboration: {i.corroboration}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs" style={{ color: TOKENS.ash, margin: "4px 0 0", maxWidth: 760 }}>
          Scaled linearly to the price move and to the disruption length (the source assumes a rise lasting most of a year). Effects for oil-importing regions and
          other studies are not shown because no primary source could be verified for them.
        </p>
      </div>

      <div>
        <div className="section-label" style={{ marginBottom: 8 }}>Hard numbers from the model</div>
        <dl data-testid="economy-hard-numbers" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "12px 24px", margin: 0 }}>
          {eco.hard_numbers.map((h) => (
            <div key={h.label}>
              <dt className="text-xs" style={{ color: TOKENS.ash }}>{h.label}</dt>
              <dd className="data-readout" style={{ margin: 0, fontSize: 18, color: TOKENS.bone }}>
                {h.unit.startsWith("%") || h.unit.includes("more") ? `${Math.abs(h.value) >= 100 ? fmtInt(h.value) : h.value.toFixed(2)}` : fmtInt(h.value)}{" "}
                <span className="text-xs" style={{ color: TOKENS.ash, fontFamily: "var(--font-body)" }}>{h.unit}</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div>
        <div className="section-label" style={{ marginBottom: 8 }}>Sectors (direction only)</div>
        <ul data-testid="economy-sectors" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {eco.sectors.map((s) => (
            <li key={s.sector} className="text-sm" style={{ color: TOKENS.bone }}>
              <strong>{s.sector}</strong>{" "}
              <span className="section-label" style={{ marginLeft: 6, padding: "0 6px", border: `1px solid ${TOKENS.ash}`, borderRadius: 3, fontSize: 11 }}>
                {s.direction}{s.quantified ? "" : ", not quantified"}
              </span>
              {!s.quantified && (
                <span className="section-label" style={{ marginLeft: 6, padding: "0 6px", border: `1px solid ${TOKENS.crude}`, color: TOKENS.crude, borderRadius: 3, fontSize: 11 }}>
                  no sourced coefficient
                </span>
              )}
              <div className="text-xs" style={{ color: TOKENS.ash, marginTop: 2 }}>{s.note}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
