import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import CurrentConditionsNote from "../components/CurrentConditionsNote";
import { BarrelsChart, EvChart, ImporterChart, LithiumChart, PriceChart } from "../components/results/Charts";
import EconomyPanel from "../components/results/EconomyPanel";
import PriceTicker from "../components/PriceTicker";
import KpiStrip from "../components/results/KpiStrip";
import LithiumControl from "../components/results/LithiumControl";
import ReportSection from "../components/results/ReportSection";
import { ApiError, getRoutes, simulateReport } from "../lib/api";
import { cannotSimulateReason, normalizeRouteId } from "../lib/routeRules";
import { fmtInt } from "../lib/format";
import { parseScenario, toReportRequest } from "../lib/scenarioParams";
import type { ReportResponse } from "../types";

type State =
  | { kind: "loading" }
  | { kind: "ready"; report: ReportResponse }
  | { kind: "rejected"; message: string }      // the backend understood the request and says this scenario cannot be run (pipeline, bad route ...)
  | { kind: "offline"; message: string };       // the server could not be reached

const wrap: React.CSSProperties = { maxWidth: 1080, margin: "0 auto", padding: "0 24px" };

function Card({ title, children, testId, tone = "ash" }: { title: string; children: React.ReactNode; testId: string; tone?: "ash" | "alarm" }) {
  return (
    <div data-testid={testId} role="alert" style={{ border: `1px solid ${tone === "alarm" ? "rgba(255,59,59,0.45)" : "rgba(244,241,234,0.16)"}`, borderRadius: 10, padding: "22px 24px", margin: "32px 0", maxWidth: 760 }}>
      <h2 className="display-heading" style={{ fontSize: 24, margin: "0 0 10px" }}>{title}</h2>
      <div className="text-sm font-light leading-relaxed" style={{ color: "var(--color-bone)" }}>{children}</div>
    </div>
  );
}

export default function Results() {
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const key = search.toString();
  const parsed = useMemo(() => parseScenario(new URLSearchParams(key)), [key]);
  // The result is stored with the URL it was computed for; if the URL has since changed, the page is loading again (derived, no extra state).
  const [result, setResult] = useState<{ key: string; state: State } | null>(null);
  const state: State = result && result.key === key ? result.state : { kind: "loading" };

  useEffect(() => {
    document.title = "Results · Oil Crisis Terminal";
  }, []);

  useEffect(() => {
    if (!parsed.ok) return;
    let cancelled = false;
    const done = (state: State) => !cancelled && setResult({ key, state });
    // Check the route list first (a normal 200 reply): a route that cannot be simulated gets its explanation here, without sending a
    // request that is certain to be rejected. The backend enforces the same rules if a request does get through.
    getRoutes()
      .then((all) => {
        const route = all.routes.find((r) => r.id === normalizeRouteId(parsed.value.route));
        if (!route) throw new ApiError(404, `Unknown route '${parsed.value.route}'`);
        const reason = cannotSimulateReason(route);
        if (reason) throw new ApiError(422, reason);
        return simulateReport(toReportRequest(parsed.value));
      })
      .then((report) => done({ kind: "ready", report }))
      .catch((e: unknown) => {
        if (e instanceof ApiError) done({ kind: "rejected", message: e.status === 404 ? `${e.message}. Check the route in the link, or choose one on the map.` : e.message });
        else done({ kind: "offline", message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [parsed, key]);

  const setLithium = useCallback(
    (li: number) => setSearch((prev) => { const q = new URLSearchParams(prev); q.set("li", String(li)); return q; }, { replace: true }),
    [setSearch]
  );

  const backToMap = () => navigate("/");
  const editScenario = () => navigate(`/?edit=1&${key}`);

  const topBar = (
    <div style={{ ...wrap, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "18px 24px" }}>
      <div className="section-label" style={{ color: "var(--color-bone)" }}>Oil Crisis Terminal · Results</div>
      <div style={{ display: "flex", gap: 10 }}>
        <button type="button" data-testid="back-to-map" onClick={backToMap} className="section-label" style={btn(false)}>← Back to map</button>
        <button type="button" data-testid="edit-scenario" onClick={editScenario} disabled={!parsed.ok && !search.get("route")} className="section-label" style={btn(true)}>Edit scenario</button>
      </div>
    </div>
  );

  if (!parsed.ok) {
    return (
      <main style={{ minHeight: "100vh" }}>
        <PriceTicker />
      {topBar}
        <div style={wrap}>
          <Card title="This link does not describe a scenario" testId="results-invalid" tone="alarm">
            <p style={{ margin: "0 0 10px" }}>Nothing was calculated, because the address has a problem:</p>
            <ul style={{ margin: "0 0 12px", paddingLeft: 20 }}>
              {parsed.errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
            <p style={{ margin: 0 }}>Go <Link to="/" style={{ color: "var(--color-crude)", textDecoration: "underline" }}>back to the map</Link>, click a route and choose &ldquo;Simulate disruption on this route&rdquo;, then &ldquo;Run full simulation&rdquo;.</p>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100vh", paddingBottom: 80 }}>
      <PriceTicker />
      {topBar}
      <div style={wrap}>
        {state.kind === "loading" && (
          <div data-testid="results-loading" aria-busy="true" style={{ padding: "40px 0" }}>
            <div className="section-label" style={{ marginBottom: 14 }}>Running the scenario…</div>
            {[0.5, 0.9, 0.7, 0.8].map((w, i) => <div key={i} style={{ height: 16, width: `${w * 100}%`, background: "rgba(244,241,234,0.07)", borderRadius: 3, marginBottom: 12 }} />)}
          </div>
        )}

        {state.kind === "rejected" && (
          <Card title="This scenario cannot be simulated" testId="results-rejected">
            <p style={{ margin: "0 0 10px" }}>{state.message}</p>
            <p style={{ margin: 0 }}>Nothing is wrong with the page: some routes (pipelines, routes without sourced data) are deliberately not sized. <Link to="/" style={{ color: "var(--color-crude)", textDecoration: "underline" }}>Back to the map</Link> to choose a chokepoint such as Hormuz or Suez.</p>
          </Card>
        )}

        {state.kind === "offline" && (
          <Card title="The simulation service could not be reached" testId="results-offline" tone="alarm">
            <p style={{ margin: "0 0 10px" }}>{state.message}</p>
            <p style={{ margin: 0 }}>Check that the backend is running (uvicorn on port 8000), then reload this page: your scenario is kept in the address.</p>
          </Card>
        )}

        {state.kind === "ready" && <ReportBody report={state.report} onLithium={setLithium} />}
      </div>
    </main>
  );
}

function btn(primary: boolean): React.CSSProperties {
  return {
    padding: "8px 14px", borderRadius: 6, cursor: "pointer",
    background: primary ? "rgba(232,135,30,0.14)" : "transparent",
    border: `1px solid ${primary ? "var(--color-crude)" : "rgba(244,241,234,0.2)"}`,
    color: primary ? "var(--color-crude)" : "var(--color-bone)",
  };
}

function Chip({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return <span data-testid={testId} className="data-readout text-xs" style={{ padding: "3px 9px", border: "1px solid rgba(244,241,234,0.18)", borderRadius: 999, color: "var(--color-bone)" }}>{children}</span>;
}

function ReportBody({ report, onLithium }: { report: ReportResponse; onLithium: (v: number) => void }) {
  const s = report.scenario;
  const sec = report.sections;
  const isDetour = s.disruption_type === "detour";
  return (
    <>
      <header data-testid="results-header" style={{ padding: "8px 0 4px" }}>
        <div className="section-label" style={{ marginBottom: 8 }}>Scenario report</div>
        <h1 data-testid="results-route" className="display-heading" style={{ fontSize: "clamp(30px, 5vw, 56px)", margin: "0 0 14px", lineHeight: 1.05 }}>
          {s.route_name}
        </h1>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          <Chip testId="chip-type">{isDetour ? "detour" : `blockade of ${s.blocked_share_pct}%`}</Chip>
          <Chip testId="chip-baseline">{report.baseline.label}{report.baseline.depressed_by_red_sea ? " (depressed by Red Sea attacks)" : ""}</Chip>
          <Chip>duration {s.duration_days} d</Chip>
          <Chip>conflict intensity {s.conflict_intensity}</Chip>
          {s.demand_change_pct !== 0 && <Chip>demand {s.demand_change_pct > 0 ? "+" : ""}{s.demand_change_pct}%</Chip>}
          <Chip>{s.ev_substitution_rate_pct}% EV substitution</Chip>
          <Chip>{s.horizon_years}-year horizon</Chip>
        </div>

        {isDetour && (
          <p data-testid="detour-days" className="text-sm" style={{ margin: "0 0 14px", color: "var(--color-bone)", maxWidth: 820 }}>
            <strong>Detour: {s.detour_days} days</strong>{" "}
            {s.detour_days_source === "user" ? (
              <>
                <span className="section-label" style={{ color: "var(--color-crude)", margin: "0 6px" }}>your input</span>
                {s.detour_days_default != null && <>(the route&apos;s derived default is {s.detour_days_default} days: the Cape voyage minus the Suez voyage, both planned sea distances from ShipFinder route planning at 14 knots).</>}
              </>
            ) : (
              <><span className="section-label" style={{ color: "var(--color-ash)", margin: "0 6px" }}>route default, derived</span>(Cape minus Suez planned sea distance at 14 knots; change it in the scenario).</>
            )}
          </p>
        )}

        <p className="text-xs" style={{ color: "var(--color-ash)", margin: "0 0 14px", maxWidth: 820 }}>
          Baseline flow {fmtInt(report.baseline.flow_bpd)} bpd ({report.baseline.year}).{report.baseline.note ? ` ${report.baseline.note}` : ""}
        </p>
        <div style={{ maxWidth: 820 }}><CurrentConditionsNote conditions={report.current_conditions} /></div>
      </header>

      <KpiStrip report={report} />
      <div className="hairline" style={{ margin: "10px 0 30px" }} />

      <div style={{ display: "flex", flexDirection: "column", gap: 34 }}>
        <ReportSection index={1} testId="section-barrels" title={sec.barrels.title} summary={sec.barrels.summary} takeaway={sec.barrels.takeaway} assumptions={sec.barrels.assumptions}>
          <BarrelsChart report={report} />
        </ReportSection>

        <ReportSection index={2} testId="section-price" title={sec.price.title} summary={sec.price.summary} takeaway={sec.price.takeaway} assumptions={sec.price.assumptions}>
          <PriceChart report={report} />
        </ReportSection>

        <ReportSection index={3} testId="section-evs" title={sec.evs.title} summary={sec.evs.summary} takeaway={sec.evs.takeaway} assumptions={sec.evs.assumptions}>
          <EvChart report={report} />
        </ReportSection>

        <ReportSection index={4} testId="section-lithium" title={sec.lithium.title} summary={sec.lithium.summary} takeaway={sec.lithium.takeaway} assumptions={sec.lithium.assumptions}>
          <LithiumChart report={report} />
          <LithiumControl key={s.lithium_availability_pct} value={s.lithium_availability_pct} onChange={onLithium} chemistryCaveat={sec.lithium.chart.chemistry_caveat} />
        </ReportSection>

        <ReportSection index={5} testId="section-importers" title={sec.importers.title} summary={sec.importers.summary} takeaway={sec.importers.takeaway} assumptions={sec.importers.assumptions}>
          <ImporterChart report={report} />
        </ReportSection>

        <ReportSection index={6} testId="section-economy" title={sec.economy.title} summary={sec.economy.summary} takeaway={sec.economy.takeaway} assumptions={sec.economy.assumptions}>
          <EconomyPanel report={report} />
        </ReportSection>
      </div>

      {report.caveats.length > 0 && (
        <div data-testid="caveats" style={{ marginTop: 10 }}>
          <div className="section-label" style={{ marginBottom: 8 }}>Caveats</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {report.caveats.map((c) => <li key={c} className="text-xs font-light leading-relaxed" style={{ color: "var(--color-ash)", marginBottom: 6, maxWidth: 820 }}>{c}</li>)}
          </ul>
        </div>
      )}
    </>
  );
}
