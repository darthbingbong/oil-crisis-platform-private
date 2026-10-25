import { fmtCompact, fmtInt, fmtSigned } from "../../lib/format";
import type { ReportResponse } from "../../types";

function Tile({ label, value, sub, color, testId }: { label: string; value: string; sub?: string; color?: string; testId: string }) {
  return (
    <div data-testid={testId} style={{ minWidth: 0 }}>
      <div className="section-label" style={{ marginBottom: 6 }}>{label}</div>
      <div className="data-readout" style={{ fontSize: "clamp(20px, 2.4vw, 30px)", color: color ?? "var(--color-bone)", lineHeight: 1.1 }}>{value}</div>
      {sub && <div className="text-xs" style={{ color: "var(--color-ash)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

/** Headline numbers. When the scenario lies outside the validated range the warning sits right here, next to the number,
 * and the +/-13 pp band is replaced by "not validated at this magnitude". */
export default function KpiStrip({ report }: { report: ReportResponse }) {
  const k = report.kpis;
  const outside = k.outside_validated_range;
  return (
    <div>
      <div
        data-testid="kpi-strip"
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "20px 24px", padding: "20px 0" }}
      >
        <Tile
          testId="kpi-price"
          label="Price impact (linear formula)"
          value={`${fmtSigned(k.price_impact_pct)}%`}
          color={outside ? "var(--color-alarm)" : "var(--color-bone)"}
          sub={outside ? "not validated at this magnitude" : `± ${k.price_band_pp} pp (measured error)`}
        />
        <Tile testId="kpi-displaced" label="Barrels per day displaced" value={fmtInt(k.displaced_bpd)} sub={`${fmtCompact(k.displaced_bpd)} bpd`} color="#5aa9ff" />
        <Tile testId="kpi-evs" label="EVs required" value={fmtCompact(k.evs_required)} sub={`${fmtInt(k.evs_required)} cars`} color="var(--color-ion)" />
        <Tile
          testId="kpi-lithium"
          label={`Extra lithium (${k.lithium_headline_case} case)`}
          value={`${fmtCompact(k.extra_lithium_t_lce)} t`}
          sub={`LCE; range ${fmtCompact(k.extra_lithium_range_t_lce[0])} to ${fmtCompact(k.extra_lithium_range_t_lce[1])} t`}
          color="var(--color-ion)"
        />
        <Tile
          testId="kpi-deficit"
          label="Lithium deficit"
          value={`${fmtCompact(k.lithium_deficit_t_lce)} t`}
          sub={`${report.scenario.lithium_availability_pct}% availability over ${k.horizon_years} years (cap ${fmtCompact(report.sections.lithium.chart.cases.sourced.supply_cap_over_horizon_t_lce)} t)`}
          color={k.lithium_deficit_t_lce > 0 ? "var(--color-alarm)" : "var(--color-bone)"}
        />
      </div>

      {outside && (
        <div
          data-testid="kpi-outside-warning"
          role="alert"
          style={{ borderLeft: "3px solid var(--color-alarm)", padding: "10px 14px", background: "linear-gradient(90deg, rgba(255,59,59,0.10), transparent)" }}
        >
          <div className="section-label" style={{ color: "var(--color-alarm)", marginBottom: 4 }}>Outside the validated range</div>
          <p className="text-sm font-light leading-relaxed" style={{ margin: 0, color: "var(--color-bone)", maxWidth: 900 }}>
            {k.validated_note} The formula's error band was measured only on events up to {report.validated_supply_loss_max_pct}% supply loss, so it is not
            shown here (&quot;not validated at this magnitude&quot;). The largest validated event, {report.validated_reference.name}, had a {report.validated_reference.supply_loss_pct}% supply loss and an actual price move of{" "}
            {fmtSigned(report.validated_reference.actual_price_move_pct)}%.
          </p>
        </div>
      )}
    </div>
  );
}
