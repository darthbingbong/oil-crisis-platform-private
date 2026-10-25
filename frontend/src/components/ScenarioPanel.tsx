import { useEffect, useMemo, useState } from "react";
import { simulate, simulateReportPreview, type ReportPreview } from "../lib/api";
import { localSimulate } from "../lib/localFormula";
import { useAnimatedNumber } from "../lib/useAnimatedNumber";
import Slider from "./Slider";
import type { RouteScenarioPrefill, RouteSummary, SimulateRequest, SimulateResponse } from "../types";

interface SliderConfig {
  key: keyof SimulateRequest;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}

const SLIDERS: SliderConfig[] = [
  { key: "supply_loss_pct", label: "Supply loss", min: -20, max: 20, step: 0.5, unit: "%" },
  { key: "conflict_intensity", label: "Conflict intensity", min: 0, max: 10, step: 1, unit: "" },
  { key: "detour_days", label: "Detour days", min: 0, max: 30, step: 1, unit: "d" },
  { key: "demand_change_pct", label: "Demand change", min: -50, max: 50, step: 1, unit: "%" },
];

const DEFAULT_SCENARIO: SimulateRequest = {
  supply_loss_pct: 5,
  conflict_intensity: 6,
  detour_days: 3,
  demand_change_pct: 0,
};

const DEBOUNCE_MS = 200;

/** Largest supply loss among the 21 daily-resolution events the formula's error was validated on
 * (backend/data/events.csv; the backend reports the same value as validated_supply_loss_max_pct). */
const VALIDATED_SUPPLY_LOSS_MAX_PCT = 8;

const DEFAULT_LITHIUM_AVAILABILITY_PCT = 10;
const DEFAULT_DURATION_DAYS = 30;

function priceColor(pct: number): string {
  return Math.abs(pct) >= 40 ? "var(--color-alarm)" : "var(--color-bone)";
}

/** The route-based part of the scenario, set by "Simulate disruption on this route". */
interface RouteScenario {
  routeId: string;
  disruptionType: "blockade" | "detour";
  blockedSharePct: number;
  detourDays: number;
  durationDays: number;
  lithiumAvailabilityPct: number;
}

interface Props {
  /** Bumps whenever the news pipeline moves the lithium_supply_index
   * (useNewsStream's lastEventId) -- /api/v1/simulate's EV feasibility
   * numbers depend on that index server-side now (see backend/ev_lithium.py),
   * so a live news event should refresh this panel's numbers even when no
   * slider moved. undefined/null is treated as "no news yet, no-op". */
  newsUpdateSignal?: number | null;
  routes?: RouteSummary[];
  /** Set by the route panel's "Simulate disruption on this route" button. */
  prefill?: RouteScenarioPrefill | null;
  /** Tells the globe which route to draw as disrupted (crimson) and how intense the conflict is. */
  onRouteScenarioChange?: (state: { routeId: string; disruptionType: "blockade" | "detour"; altRouteId: string | null } | null, conflictIntensity: number) => void;
}

export default function ScenarioPanel({
  newsUpdateSignal = null,
  routes = [],
  prefill = null,
  onRouteScenarioChange,
}: Props) {
  const [scenario, setScenario] = useState<SimulateRequest>(DEFAULT_SCENARIO);
  const [result, setResult] = useState<SimulateResponse>(() => localSimulate(DEFAULT_SCENARIO));
  const [status, setStatus] = useState<"loading" | "live" | "offline">("loading");
  const [routeScenario, setRouteScenario] = useState<RouteScenario | null>(null);
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const simulatable = useMemo(
    () => routes.filter((r) => r.type !== "pipeline" && !r.excluded_from_calculations && r.annual_flow_bpd),
    [routes]
  );

  // "Simulate disruption on this route" pre-fills every route control.
  useEffect(() => {
    if (!prefill) return;
    setRouteScenario({
      routeId: prefill.routeId,
      disruptionType: prefill.disruptionType,
      blockedSharePct: prefill.blockedSharePct,
      detourDays: prefill.detourDays,
      durationDays: DEFAULT_DURATION_DAYS,
      lithiumAvailabilityPct: DEFAULT_LITHIUM_AVAILABILITY_PCT,
    });
  }, [prefill]);

  // Tell the globe which route is disrupted (and the alt lane for a detour).
  useEffect(() => {
    if (!onRouteScenarioChange) return;
    if (!routeScenario) return onRouteScenarioChange(null, scenario.conflict_intensity);
    const route = routes.find((r) => r.id === routeScenario.routeId);
    onRouteScenarioChange(
      {
        routeId: routeScenario.routeId,
        disruptionType: routeScenario.disruptionType,
        altRouteId: routeScenario.disruptionType === "detour" ? (route?.alt_route_id ?? null) : null,
      },
      scenario.conflict_intensity
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeScenario?.routeId, routeScenario?.disruptionType, scenario.conflict_intensity, routes]);

  // With a route chosen, the backend engine derives supply loss (and detour days) from the route's
  // sourced flow/bypass/voyage data; the supply-loss slider then follows it.
  useEffect(() => {
    if (!routeScenario) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      simulateReportPreview({
        route_id: routeScenario.routeId,
        disruption_type: routeScenario.disruptionType,
        blocked_share_pct: routeScenario.blockedSharePct,
        detour_days: routeScenario.disruptionType === "detour" ? routeScenario.detourDays : null,
        duration_days: routeScenario.durationDays,
        lithium_availability_pct: routeScenario.lithiumAvailabilityPct,
      })
        .then((p) => {
          if (cancelled) return;
          setPreview(p);
          setPreviewError(null);
          const loss = Math.max(-20, Math.min(20, Math.round(p.sections.barrels.numbers.supply_loss_pct * 2) / 2));
          setScenario((prev) => ({
            ...prev,
            supply_loss_pct: loss,
            detour_days: routeScenario.disruptionType === "detour" ? Math.min(30, routeScenario.detourDays) : prev.detour_days,
          }));
        })
        .catch((e: Error) => {
          if (!cancelled) {
            setPreview(null);
            setPreviewError(e.message);
          }
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [routeScenario]);

  // Debounced so dragging a slider doesn't fire a request per pixel of
  // movement. Also re-runs (undebounced is fine here, it's not a drag) when
  // newsUpdateSignal changes, so a live price_event picks up the new
  // lithium_supply_index without requiring a slider touch.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      simulate(scenario)
        .then((response) => {
          if (!cancelled) {
            setResult(response);
            setStatus("live");
          }
        })
        .catch(() => {
          if (!cancelled) {
            setResult(localSimulate(scenario));
            setStatus("offline");
          }
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scenario, newsUpdateSignal]);

  const animatedPricePct = useAnimatedNumber(result.predicted_price_change_pct);
  const animatedVehicleYears = useAnimatedNumber(result.ev_feasibility.gasoline_vehicle_years_displaced);
  const animatedLithiumTonnes = useAnimatedNumber(result.ev_feasibility.lithium_tonnes_required);
  const animatedLithiumRatio = useAnimatedNumber(result.ev_feasibility.lithium_supply_ratio);

  const outsideValidated = scenario.supply_loss_pct > VALIDATED_SUPPLY_LOSS_MAX_PCT;
  const patchRoute = (patch: Partial<RouteScenario>) => setRouteScenario((prev) => (prev ? { ...prev, ...patch } : prev));
  const selectedRoute = routeScenario ? routes.find((r) => r.id === routeScenario.routeId) : null;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <h2 className="section-label" style={{ color: "var(--color-bone)" }}>
          Crisis Scenario
        </h2>
        <StatusBadge status={status} />
      </div>

      {routeScenario && (
        <div
          data-testid="route-scenario"
          className="flex flex-col gap-4"
          style={{ border: "1px solid rgba(255,59,59,0.35)", borderRadius: 8, padding: "14px 16px", background: "rgba(255,59,59,0.04)" }}
        >
          <div className="flex items-center justify-between">
            <span className="section-label" style={{ color: "var(--color-alarm)" }}>Route scenario</span>
            <button
              type="button"
              onClick={() => setRouteScenario(null)}
              className="section-label"
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
            >
              clear
            </button>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="section-label">Route</span>
            <select
              data-testid="route-select"
              value={routeScenario.routeId}
              onChange={(e) => patchRoute({ routeId: e.target.value })}
              className="text-sm"
              style={{ background: "#0b0b0b", color: "var(--color-bone)", border: "1px solid rgba(244,241,234,0.18)", borderRadius: 4, padding: "6px 8px" }}
            >
              {simulatable.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </label>

          <div role="group" aria-label="Disruption type" className="flex gap-1.5">
            {(["blockade", "detour"] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={routeScenario.disruptionType === t}
                onClick={() => patchRoute({ disruptionType: t })}
                className="section-label"
                data-testid={`type-${t}`}
                style={{
                  flex: 1, padding: "6px 0", cursor: "pointer", borderRadius: 4,
                  background: routeScenario.disruptionType === t ? "rgba(232,135,30,0.16)" : "transparent",
                  border: `1px solid ${routeScenario.disruptionType === t ? "var(--color-crude)" : "rgba(244,241,234,0.14)"}`,
                  color: routeScenario.disruptionType === t ? "var(--color-crude)" : "var(--color-ash)",
                }}
              >
                {t}
              </button>
            ))}
          </div>

          {routeScenario.disruptionType === "blockade" ? (
            <Slider label="Share of route blocked" min={0} max={100} step={5} unit="%" value={routeScenario.blockedSharePct}
              onChange={(v) => patchRoute({ blockedSharePct: v })} />
          ) : (
            <Slider label="Detour (extra voyage days)" min={0} max={30} step={1} unit="d" value={routeScenario.detourDays}
              onChange={(v) => patchRoute({ detourDays: v })} />
          )}
          <Slider label="Disruption duration" min={5} max={365} step={5} unit="d" value={routeScenario.durationDays}
            onChange={(v) => patchRoute({ durationDays: v })} />

          <div>
            <Slider label="Lithium availability" min={0} max={100} step={5} unit="%" value={routeScenario.lithiumAvailabilityPct}
              onChange={(v) => patchRoute({ lithiumAvailabilityPct: v })} />
            <p data-testid="lithium-availability-help" className="text-xs font-light leading-relaxed" style={{ color: "var(--color-ash)", margin: 0 }}>
              How much of today's world lithium mine output could be redirected to build the EVs that replace the lost oil.
              This caps the lithium supply in the report; the shortfall beyond it is the deficit. The 10% default is anchored on
              USGS (Mineral Commodity Summaries 2026): 2025 production (290,000 t lithium) exceeded consumption (263,000 t) by only
              about 9%, so little is spare. A scenario input, not a forecast.
            </p>
          </div>

          <div className="text-xs" data-testid="route-preview" style={{ color: "var(--color-bone)" }}>
            {previewError && <span style={{ color: "var(--color-alarm)" }}>Could not compute this route: {previewError}</span>}
            {preview && (
              <>
                {selectedRoute?.name}: displaces{" "}
                <span className="data-readout">{Math.round(preview.kpis.displaced_bpd).toLocaleString()}</span> bpd (
                <span className="data-readout">{preview.sections.barrels.numbers.supply_loss_pct.toFixed(2)}%</span> of world supply).
                Supply loss below is derived from the route.
              </>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-5">
        {SLIDERS.map((s) => (
          <Slider
            key={s.key}
            label={s.label}
            min={s.min}
            max={s.max}
            step={s.step}
            unit={s.unit}
            value={scenario[s.key]}
            disabled={!!routeScenario && (s.key === "supply_loss_pct" || (s.key === "detour_days" && routeScenario.disruptionType === "detour"))}
            onChange={(value) => setScenario((prev) => ({ ...prev, [s.key]: value }))}
          />
        ))}
      </div>

      <div className="hairline" />

      <div>
        <div className="section-label mb-3">Predicted price change</div>
        <div
          data-testid="predicted-price-change"
          className="data-readout font-medium leading-none"
          style={{
            // three-digit values need a smaller size to stay inside the column
            fontSize: Math.abs(result.predicted_price_change_pct) >= 100 ? "clamp(38px, 4.4vw, 58px)" : "clamp(48px, 6vw, 72px)",
            color: priceColor(result.predicted_price_change_pct),
          }}
        >
          {animatedPricePct > 0 ? "+" : ""}
          {animatedPricePct.toFixed(2)}%
        </div>
        {outsideValidated && (
          <p
            data-testid="outside-validated"
            className="text-xs leading-relaxed mt-3"
            style={{ color: "var(--color-alarm)", borderLeft: "2px solid var(--color-alarm)", paddingLeft: 10 }}
          >
            Outside the validated range. The linear formula implies this figure for a {scenario.supply_loss_pct}% supply loss, but its error was only
            measured on events up to {VALIDATED_SUPPLY_LOSS_MAX_PCT}%, so the figure is an extrapolation, not a forecast.
          </p>
        )}
        <p className="text-sm font-light leading-relaxed mt-4" style={{ color: "var(--color-ash)" }}>
          {result.explanation}
        </p>
      </div>

      <div className="hairline" />

      <div>
        <div className="section-label mb-4">EV / lithium feasibility</div>
        <div className="grid grid-cols-2 gap-6 mb-5">
          <StatBlock
            label="Vehicle-years displaced"
            value={Math.round(animatedVehicleYears).toLocaleString()}
          />
          <StatBlock
            label="Lithium required (t)"
            value={Math.round(animatedLithiumTonnes).toLocaleString()}
          />
        </div>
        <div className="section-label mb-2">vs. world annual lithium supply</div>
        <RatioBar ratio={result.ev_feasibility.lithium_supply_ratio} animatedRatio={animatedLithiumRatio} />
        <p className="text-sm font-light leading-relaxed mt-4" style={{ color: "var(--color-ash)" }}>
          {result.ev_feasibility.explanation}
        </p>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: "loading" | "live" | "offline" }) {
  const color =
    status === "live" ? "var(--color-crude)" : status === "offline" ? "var(--color-alarm)" : "var(--color-ash)";
  const text = status === "live" ? "LIVE" : status === "offline" ? "OFFLINE" : "CONNECTING";
  return (
    <span className="section-label flex items-center gap-1.5" style={{ color }}>
      <span
        className="w-1 h-1 rounded-full"
        style={{ background: color, boxShadow: status === "live" ? `0 0 6px ${color}` : "none" }}
      />
      {text}
    </span>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] mb-1.5" style={{ color: "var(--color-ash)" }}>
        {label}
      </div>
      <div className="data-readout text-xl" style={{ color: "var(--color-ion)" }}>
        {value}
      </div>
    </div>
  );
}

function RatioBar({ ratio, animatedRatio }: { ratio: number; animatedRatio: number }) {
  // Bar width/number count smoothly via animatedRatio; the alarm/ion color
  // threshold uses the real final ratio so it doesn't flicker mid-count.
  const pct = Math.min(animatedRatio, 1) * 100;
  const over = ratio > 1;
  const color = over ? "var(--color-alarm)" : "var(--color-ion)";
  return (
    <div className="relative">
      <div className="w-full h-px" style={{ background: "rgba(244,241,234,0.12)" }}>
        <div className="h-px" style={{ width: `${pct}%`, background: color, boxShadow: `0 0 6px ${color}` }} />
      </div>
      {over && (
        <span className="data-readout absolute right-0 -top-4 text-[11px]" style={{ color }}>
          {animatedRatio.toFixed(1)}x
        </span>
      )}
    </div>
  );
}
