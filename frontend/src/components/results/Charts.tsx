import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TOKENS } from "../../lib/constants";
import { fmtCompact, fmtInt, fmtSigned } from "../../lib/format";
import type { ReportResponse } from "../../types";

const LANE = "#5aa9ff";
const GRID = "rgba(244,241,234,0.08)";
const AXIS = { fill: TOKENS.ash, fontSize: 11 } as const;
const TOOLTIP = { contentStyle: { background: "#0b0b0b", border: "1px solid rgba(244,241,234,0.14)", fontSize: 12 }, labelStyle: { color: TOKENS.bone } } as const;

/** Round an axis outward to clean numbers (multiples of a nice step) and return matching ticks, so labels read 0, 20, 40 and not 49, 29, 9. */
function niceAxis(lo: number, hi: number, targetTicks = 6): { domain: [number, number]; ticks: number[] } {
  const raw = (hi - lo) / targetTicks || 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((c) => c >= raw) ?? raw;
  const min = Math.floor(lo / step) * step, max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = min; t <= max + step / 2; t += step) ticks.push(Number(t.toFixed(6)));
  return { domain: [min, max], ticks };
}

const DAY_TICKS = [0, 30, 60, 90, 120, 150, 180];

function Frame({ height = 300, children, testId }: { height?: number; children: React.ReactElement; testId: string }) {
  return (
    <div data-testid={testId} style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
    </div>
  );
}

function Legend({ items }: { items: { color: string; label: string; dashed?: boolean; swatch?: "line" | "box"; solid?: boolean }[] }) {
  return (
    <div className="text-xs" style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", color: TOKENS.ash, marginTop: 8 }}>
      {items.map((i) => (
        <span key={i.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {i.swatch === "box" ? (
            <span style={{ width: 12, height: 10, background: i.color, opacity: i.solid ? 1 : 0.45, display: "inline-block" }} />
          ) : (
            <span style={{ width: 20, borderTop: `2px ${i.dashed ? "dashed" : "solid"} ${i.color}`, display: "inline-block" }} />
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- 1. barrels displaced */
export function BarrelsChart({ report }: { report: ReportResponse }) {
  const data = report.sections.barrels.chart.series.map((p) => ({ day: p.day, daily: p.daily_bbl / 1e6, cumulative: p.cumulative_bbl / 1e6 }));
  const dur = report.scenario.duration_days;
  return (
    <>
      <Frame testId="chart-barrels">
        <ComposedChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 20 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="day" type="number" domain={[0, 180]} ticks={DAY_TICKS} tick={AXIS} label={{ value: "days since the disruption starts", position: "insideBottom", offset: -10, fill: TOKENS.ash, fontSize: 11 }} />
          <YAxis yAxisId="cum" tick={AXIS} tickFormatter={(v) => `${v}M`} width={52} label={{ value: "cumulative barrels", angle: -90, position: "insideLeft", fill: TOKENS.ash, fontSize: 11 }} />
          <YAxis yAxisId="day" orientation="right" tick={AXIS} tickFormatter={(v) => `${v}M`} width={44} />
          <Tooltip {...TOOLTIP} formatter={(v, name) => [`${Number(v).toFixed(1)} million barrels`, name === "cumulative" ? "cumulative" : "per day"]} labelFormatter={(d) => `day ${d}`} />
          <Area yAxisId="cum" type="monotone" dataKey="cumulative" stroke={LANE} fill={LANE} fillOpacity={0.18} strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line yAxisId="day" type="stepAfter" dataKey="daily" stroke={TOKENS.crude} strokeWidth={2} dot={false} isAnimationActive={false} />
          <ReferenceLine yAxisId="cum" x={dur} stroke={TOKENS.ash} strokeDasharray="4 4" label={{ value: `disruption ends (day ${dur})`, position: "insideTopLeft", fill: TOKENS.ash, fontSize: 11 }} />
        </ComposedChart>
      </Frame>
      <Legend items={[{ color: LANE, label: "cumulative barrels lost (left axis)", swatch: "box" }, { color: TOKENS.crude, label: "barrels displaced per day (right axis)" }]} />
    </>
  );
}

/* ---------------------------------------------------------------- 2. price trajectory */
export function PriceChart({ report }: { report: ReportResponse }) {
  const sec = report.sections.price;
  const traj = sec.chart.trajectory;
  const ceiling = sec.chart.validated_price_ceiling_pct;
  const ref = report.validated_reference;
  const bandShown = sec.chart.band_validated;
  const dur = report.scenario.duration_days;

  // Split the line into a solid part (inside the validated range) and a dashed part (beyond it); neighbours at the boundary are
  // included in both so the two pieces join without a gap.
  const data = traj.map((p, i) => {
    const prev = traj[i - 1]?.beyond_validated, next = traj[i + 1]?.beyond_validated;
    const touchesValid = !p.beyond_validated || prev === false || next === false;
    const touchesBeyond = p.beyond_validated || prev === true || next === true;
    return {
      day: p.day,
      valid: touchesValid ? p.pct : null,
      beyond: touchesBeyond ? p.pct : null,
      band: bandShown && p.low !== null && p.high !== null ? [p.low, p.high] : null,
    };
  });
  const anyBeyond = traj.some((p) => p.beyond_validated);
  const peak = Math.max(...traj.map((p) => p.pct));
  const sens = sec.sensitivity;
  const sensPeaks = sens.map((s) => s.price_impact_pct);
  const hiRaw = Math.max(peak, ceiling, ref.actual_price_move_pct, ...sensPeaks, ...(bandShown ? traj.map((p) => p.high ?? 0) : [0])) * 1.08;
  const loRaw = Math.min(0, ...traj.map((p) => (bandShown ? (p.low ?? p.pct) : p.pct)));
  const { domain: yDomain, ticks: yTicks } = niceAxis(loRaw, hiRaw);
  const hi = yDomain[1];

  return (
    <>
      <Frame height={340} testId="chart-price">
        <ComposedChart data={data} margin={{ top: 14, right: 16, left: 4, bottom: 20 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="day" type="number" domain={[0, 180]} ticks={DAY_TICKS} tick={AXIS} label={{ value: "days since the disruption starts", position: "insideBottom", offset: -10, fill: TOKENS.ash, fontSize: 11 }} />
          <YAxis tick={AXIS} domain={yDomain} ticks={yTicks} tickFormatter={(v) => `${Math.round(v)}%`} width={52} allowDataOverflow />
          <Tooltip
            {...TOOLTIP}
            labelFormatter={(d) => `day ${d}`}
            formatter={(v, name) => (Array.isArray(v) ? [`${Number(v[0]).toFixed(1)}% to ${Number(v[1]).toFixed(1)}%`, "± band (validated)"] : [`${fmtSigned(Number(v))}%`, name === "beyond" ? "beyond the validated range" : "within the validated range"])}
          />

          {/* shaded zone: the price the linear formula gives above the edge of the validated range */}
          {anyBeyond && <ReferenceArea y1={ceiling} y2={hi} fill={TOKENS.alarm} fillOpacity={0.07} ifOverflow="hidden" />}
          {/* the bypass assumption (Hormuz): the same blockade under two published capacities */}
          {sens.length > 1 && (
            <ReferenceArea x1={0} x2={dur} y1={Math.min(...sensPeaks)} y2={Math.max(...sensPeaks)} fill={TOKENS.crude} fillOpacity={0.22} ifOverflow="visible"
              label={{ value: `bypass sensitivity: ${(sens[0].bypass_bpd / 1e6).toFixed(1)} vs ${(sens[1].bypass_bpd / 1e6).toFixed(1)} Mb/d`, position: "insideTopLeft", dy: -2, fill: TOKENS.crude, fontSize: 11 }} />
          )}
          {bandShown && <Area type="monotone" dataKey="band" stroke="none" fill={LANE} fillOpacity={0.16} isAnimationActive={false} connectNulls />}

          <ReferenceLine y={ceiling} stroke={TOKENS.ash} strokeDasharray="2 4"
            label={{ value: `formula at ${report.validated_supply_loss_max_pct}% supply loss: ${fmtSigned(ceiling)}%`, position: "insideBottomRight", dy: 17, fill: TOKENS.ash, fontSize: 11 }} />
          <ReferenceLine y={ref.actual_price_move_pct} stroke={TOKENS.ion} strokeDasharray="6 3"
            label={{ value: `2026 war: ${fmtSigned(ref.actual_price_move_pct)}% actual, ${ref.supply_loss_pct}% supply loss (soft)`, position: "insideTopRight", dy: -22, fill: TOKENS.ion, fontSize: 11 }} />

          <Line type="monotone" dataKey="valid" stroke={LANE} strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="beyond" stroke={TOKENS.alarm} strokeWidth={2.5} strokeDasharray="7 5" dot={false} connectNulls={false} isAnimationActive={false} />
        </ComposedChart>
      </Frame>

      <Legend
        items={[
          { color: LANE, label: "linear formula, within the validated range" },
          ...(anyBeyond ? [{ color: TOKENS.alarm, label: "linear formula, beyond the validated range (extrapolation)", dashed: true }] : []),
          ...(bandShown ? [{ color: LANE, label: `± ${report.kpis.price_band_pp} pp measured error band`, swatch: "box" as const }] : []),
          { color: TOKENS.ion, label: `largest validated event (reference): ${ref.name.replace(/\s*\(.*\)/, "")}, soft figure, still unfolding`, dashed: true },
          ...(sens.length > 1 ? [{ color: TOKENS.crude, label: `bypass-capacity sensitivity range (${(sens[0].bypass_bpd / 1e6).toFixed(1)} vs ${(sens[1].bypass_bpd / 1e6).toFixed(1)} Mb/d)`, swatch: "box" as const }] : []),
        ]}
      />
      {!bandShown && (
        <p data-testid="band-not-validated" className="text-xs" style={{ color: TOKENS.alarm, margin: "8px 0 0" }}>
          The formula&apos;s error band is <strong>not validated at this magnitude</strong> and is not drawn: it was measured only on events up to {report.validated_supply_loss_max_pct}% supply loss.
        </p>
      )}
      {sens.length > 1 && (
        <table data-testid="bypass-sensitivity" className="text-xs" style={{ marginTop: 12, borderCollapse: "collapse", color: TOKENS.bone }}>
          <thead><tr style={{ color: TOKENS.ash, textAlign: "left" }}><th style={{ paddingRight: 24, fontWeight: 600 }}>Bypass assumption</th><th style={{ paddingRight: 24, fontWeight: 600 }}>Displaced</th><th style={{ fontWeight: 600 }}>Price (linear formula)</th></tr></thead>
          <tbody>
            {sens.map((s) => (
              <tr key={s.label}>
                <td style={{ paddingRight: 24, paddingTop: 4 }}>{s.label} ({(s.bypass_bpd / 1e6).toFixed(1)} Mb/d)</td>
                <td className="data-readout" style={{ paddingRight: 24 }}>{fmtInt(s.displaced_bpd)} bpd</td>
                <td className="data-readout">{fmtSigned(s.price_impact_pct)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- 3. EVs required */
export function EvChart({ report }: { report: ReportResponse }) {
  const c = report.sections.evs.chart;
  const data = c.horizons.map((h) => ({ name: `${h.years} year${h.years > 1 ? "s" : ""}`, perYear: h.evs_per_year, ratio: h.x_current_global_production, years: h.years }));
  const { domain: evDomain, ticks: evTicks } = niceAxis(0, Math.max(...data.map((d) => d.perYear), c.current_global_production) * 1.12);
  return (
    <>
      <Frame testId="chart-evs">
        <BarChart data={data} margin={{ top: 24, right: 16, left: 4, bottom: 8 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="name" tick={AXIS} />
          <YAxis tick={AXIS} domain={evDomain} ticks={evTicks} tickFormatter={(v) => fmtCompact(v, 0)} width={56} allowDataOverflow />
          <Tooltip {...TOOLTIP} formatter={(v) => [`${fmtCompact(Number(v))} EVs per year`, "needed"]} />
          <Bar dataKey="perYear" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((d) => <Cell key={d.years} fill={d.years === report.kpis.horizon_years ? TOKENS.ion : "rgba(53,224,201,0.45)"} />)}
            <LabelList dataKey="ratio" position="top" formatter={(v: unknown) => `${Number(v).toFixed(1)}x`} fill={TOKENS.bone} fontSize={12} />
          </Bar>
          <ReferenceLine y={c.current_global_production} stroke={TOKENS.crude} strokeWidth={2}
            label={{ value: `${c.current_data_year} global EV production: ${fmtCompact(c.current_global_production, 1)} (IEA)`, position: "insideTopRight", fill: TOKENS.crude, fontSize: 11 }} />
        </BarChart>
      </Frame>
      <Legend items={[{ color: TOKENS.ion, label: "extra EVs per year if delivered over 1, 3 or 5 years (label = multiple of production; brighter bar = the headline horizon)", swatch: "box" }, { color: TOKENS.crude, label: `${c.current_data_year} global production (IEA Global EV Outlook 2026); sales that year exceeded ${fmtCompact(c.current_global_sales, 0)}` }]} />
    </>
  );
}

/* ---------------------------------------------------------------- 4. lithium */
export function LithiumChart({ report }: { report: ReportResponse }) {
  const c = report.sections.lithium.chart;
  const cap = c.cases.sourced.supply_cap_over_horizon_t_lce;
  const data = [
    { name: `Project assumption ${c.cases.project.lce_t_per_ev} t/EV (comparison)`, v: c.cases.project.required_t_lce, kind: "project" },
    ...c.pack_cases.map((p, i) => ({ name: `Sourced, ${p.pack_kwh} kWh${i === 0 ? " (headline)" : ""}`, v: p.required_t_lce, kind: i === 0 ? "headline" : "range" })),
  ];
  const fill = (k: string) => (k === "headline" ? TOKENS.ion : k === "range" ? "rgba(53,224,201,0.45)" : "rgba(138,133,128,0.55)");
  const { domain: liDomain, ticks: liTicks } = niceAxis(0, Math.max(...data.map((d) => d.v), cap) * 1.12);
  return (
    <>
      <Frame height={320} testId="chart-lithium">
        <BarChart data={data} margin={{ top: 16, right: 16, left: 4, bottom: 8 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="name" tick={{ ...AXIS, fontSize: 10 }} interval={0} />
          <YAxis tick={AXIS} domain={liDomain} ticks={liTicks} tickFormatter={(v) => fmtCompact(v, 1)} width={56} allowDataOverflow />
          <Tooltip {...TOOLTIP} formatter={(v) => [`${fmtInt(Number(v))} t LCE`, "required"]} />
          <Bar dataKey="v" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((d) => <Cell key={d.name} fill={fill(d.kind)} />)}
            <LabelList dataKey="v" position="top" formatter={(v: unknown) => fmtCompact(Number(v), 2)} fill={TOKENS.bone} fontSize={11} />
          </Bar>
          {cap > 0 && (
            <ReferenceLine y={cap} stroke={TOKENS.alarm} strokeDasharray="6 3"
              label={{ value: `supply cap ${fmtCompact(cap)} t = ${report.scenario.lithium_availability_pct}% availability x ${report.kpis.horizon_years} years`, position: "insideTopLeft", dy: -16, fill: TOKENS.alarm, fontSize: 11 }} />
          )}
        </BarChart>
      </Frame>
      <Legend items={[
        { color: TOKENS.ion, label: "headline: sourced 0.10 kg Li/kWh x 60 kWh pack", swatch: "box" },
        { color: TOKENS.ion, label: "range: 70 kWh (EU) and 90 kWh (US) packs", swatch: "box" },
        { color: TOKENS.ash, label: "project's unsourced assumption, comparison only", swatch: "box" },
        { color: TOKENS.alarm, label: "supply cap (availability x world production x years)", dashed: true },
      ]} />
      <p data-testid="lithium-cap-formula" className="text-xs" style={{ color: TOKENS.bone, margin: "10px 0 0" }}>
        <strong>Supply cap</strong> = {report.scenario.lithium_availability_pct}% lithium availability x {fmtInt(c.world_production_2025_t_lce)} t LCE a year (2025 world mine production) x {report.kpis.horizon_years} years ={" "}
        <span className="data-readout">{fmtInt(cap)} t</span>. <strong>Deficit</strong> = required minus cap, for each case below.
      </p>
      <table data-testid="lithium-table" className="text-xs" style={{ marginTop: 12, borderCollapse: "collapse", color: TOKENS.bone }}>
        <thead><tr style={{ color: TOKENS.ash, textAlign: "left" }}><th style={{ paddingRight: 24, fontWeight: 600 }}>Case</th><th style={{ paddingRight: 24, fontWeight: 600 }}>t LCE per EV</th><th style={{ paddingRight: 24, fontWeight: 600 }}>Required</th><th style={{ fontWeight: 600 }}>Deficit vs cap</th></tr></thead>
        <tbody>
          <tr><td style={{ paddingRight: 24, paddingTop: 4 }}>Project assumption (comparison)</td><td className="data-readout" style={{ paddingRight: 24 }}>{c.cases.project.lce_t_per_ev}</td><td className="data-readout" style={{ paddingRight: 24 }}>{fmtInt(c.cases.project.required_t_lce)} t</td><td className="data-readout">{fmtInt(c.cases.project.deficit_t_lce)} t</td></tr>
          {c.pack_cases.map((p, i) => (
            <tr key={p.pack_kwh}><td style={{ paddingRight: 24, paddingTop: 4 }}>Sourced, {p.pack_kwh} kWh{i === 0 ? " (headline)" : ""}</td><td className="data-readout" style={{ paddingRight: 24 }}>{p.lce_t_per_ev.toFixed(4)}</td><td className="data-readout" style={{ paddingRight: 24 }}>{fmtInt(p.required_t_lce)} t</td><td className="data-readout">{fmtInt(p.deficit_t_lce)} t</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/* ---------------------------------------------------------------- 5. importers */
export function ImporterChart({ report }: { report: ReportResponse }) {
  const imps = report.sections.importers.chart.importers;
  if (imps.length === 0) {
    return (
      <p data-testid="importers-not-available" className="text-sm" style={{ color: TOKENS.ash, margin: 0, padding: "14px 16px", border: "1px dashed rgba(244,241,234,0.2)", borderRadius: 6 }}>
        Not available: our sources (EIA) give no importer breakdown for this route, and nothing has been estimated.
      </p>
    );
  }
  const data = imps.map((i) => ({ name: i.name, bpd: i.shortfall_bpd, share: i.share_of_route_flow_pct, derived: i.derived }));
  return (
    <>
      <Frame height={70 + 56 * data.length} testId="chart-importers">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 90, left: 4, bottom: 4 }}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" tick={AXIS} tickFormatter={(v) => fmtCompact(v, 1)} />
          <YAxis type="category" dataKey="name" width={190} tick={{ fill: TOKENS.bone, fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip {...TOOLTIP} formatter={(v, _n, item) => [`${fmtInt(Number(v))} bpd (${(item.payload as { share: number }).share}% of route flow)`, "shortfall"]} />
          <Bar dataKey="bpd" radius={[0, 3, 3, 0]} isAnimationActive={false}>
            {data.map((d) => <Cell key={d.name} fill={d.derived ? "rgba(90,169,255,0.35)" : LANE} />)}
            <LabelList dataKey="bpd" position="right" formatter={(v: unknown) => `${fmtCompact(Number(v), 2)} bpd`} fill={TOKENS.bone} fontSize={11} />
          </Bar>
        </BarChart>
      </Frame>
      <Legend items={[{ color: LANE, label: "published share of route flow", swatch: "box", solid: true }, { color: "rgba(90,169,255,0.35)", label: "derived share (a subtraction of two published figures)", swatch: "box", solid: true }]} />
      <p className="text-xs" style={{ color: TOKENS.ash, margin: "8px 0 0" }}>Shortfall by region/group. EIA publishes destination shares only at region or group level. Strategic-reserve cover is not available from the sources used.</p>
    </>
  );
}
