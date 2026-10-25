import { useEffect, useState } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getRouteDetail } from "../lib/api";
import { TOKENS } from "../lib/constants";
import { ROUTE_COLORS, ROUTE_TYPE_LABEL, formatMbpd } from "../lib/routeGeometry";
import type { RouteDetail, RouteScenarioPrefill, RouteSummary } from "../types";
import CurrentConditionsNote from "./CurrentConditionsNote";
import RouteNews from "./RouteNews";

interface Props {
  route: RouteSummary;
  visible: boolean;
  onClose: () => void;
  onSimulate: (prefill: Omit<RouteScenarioPrefill, "nonce">) => void;
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div>
      <div className="section-label" style={{ marginBottom: 4 }}>{label}</div>
      <div className="data-readout" style={{ fontSize: 20, color: color ?? "var(--color-bone)" }}>{value}</div>
      {sub && <div className="text-xs" style={{ color: "var(--color-ash)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function EstimateTag() {
  return (
    <span
      className="section-label"
      style={{ marginLeft: 8, padding: "1px 6px", border: "1px solid var(--color-crude)", color: "var(--color-crude)", borderRadius: 3 }}
    >
      estimate
    </span>
  );
}

/** Right-hand route panel: stats, importers by region/group, exporters, bypass, "if closed" quick stat,
 * current-conditions note, and the "Simulate disruption on this route" button.
 * Pipelines show NAMEPLATE CAPACITY (never flow); routes with no sourced importer data say so. */
export default function RoutePanel({ route, visible, onClose, onSimulate }: Props) {
  const [detail, setDetail] = useState<RouteDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<"blockade" | "detour">("blockade");

  useEffect(() => {
    let cancelled = false;
    getRouteDetail(route.id)
      .then((d) => !cancelled && setDetail(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [route.id]);

  const isPipeline = route.type === "pipeline";
  const color = ROUTE_COLORS[route.type];
  const canSimulate = !isPipeline && !route.excluded_from_calculations;
  const canDetour = detail?.baseline_voyage_days != null;
  const importers = detail?.top_importers ?? [];

  return (
    <aside
      data-testid="route-panel"
      aria-hidden={!visible}
      aria-label={`${route.name} details`}
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        bottom: 12,
        width: 392,
        maxWidth: "calc(100% - 24px)",
        zIndex: 10,
        background: "rgba(8,8,8,0.88)",
        backdropFilter: "blur(10px)",
        border: "1px solid rgba(244,241,234,0.12)",
        borderRadius: 10,
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 320ms ease",
        overflowY: "auto",
        padding: "16px 22px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <button
        type="button"
        onClick={onClose}
        tabIndex={visible ? 0 : -1}
        className="section-label"
        style={{ alignSelf: "flex-start", background: "none", border: "none", padding: 0, cursor: "pointer" }}
      >
        ← Back to overview
      </button>

      <div>
        <div className="section-label" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: color }} />
          {ROUTE_TYPE_LABEL[route.type]}
          {route.is_estimate && <EstimateTag />}
        </div>
        <h2 className="display-heading" style={{ fontSize: 28, lineHeight: 1.1, margin: 0 }}>{route.name}</h2>
      </div>

      {route.excluded_from_calculations && (
        <div className="text-sm" style={{ color: "var(--color-crude)" }} data-testid="route-na">
          n/a: {detail?.exclusion_reason ?? "No sourced throughput or capacity. Excluded from all calculations until one exists."}
        </div>
      )}

      {/* headline numbers: flow for sea routes, NAMEPLATE CAPACITY for pipelines */}
      {!route.excluded_from_calculations && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {isPipeline ? (
            <>
              <Stat label="Nameplate capacity" value={formatMbpd(route.capacity_bpd)} sub={`${route.capacity_bpd?.toLocaleString() ?? "n/a"} bpd`} color={color} />
              <Stat label="Throughput" value="not available" sub="no current sourced figure; capacity is not flow" />
            </>
          ) : (
            <>
              <Stat label={`Annual flow (${route.baseline_year ?? route.data_year})`} value={formatMbpd(route.annual_flow_bpd)} sub={`${route.annual_flow_bpd?.toLocaleString() ?? "n/a"} bpd`} color={color} />
              <Stat
                label="Barrels per year"
                value={detail?.annual_flow_bbl_per_year ? `${(detail.annual_flow_bbl_per_year / 1e9).toFixed(2)} bn` : "..."}
                sub={route.share_of_global_seaborne_oil_pct != null ? `${route.share_of_global_seaborne_oil_pct}% of global seaborne oil` : undefined}
              />
            </>
          )}
        </div>
      )}
      {detail?.baseline_year_note && <p className="text-xs" style={{ color: "var(--color-ash)", margin: 0 }}>{detail.baseline_year_note}</p>}

      <CurrentConditionsNote conditions={detail?.current_conditions ?? null} />

      {!detail && !error && <div className="text-xs" style={{ color: "var(--color-ash)" }} data-testid="route-loading">Loading route details...</div>}
      {error && <div className="text-xs" style={{ color: "var(--color-alarm)" }}>Could not load route details: {error}</div>}

      {detail && !route.excluded_from_calculations && (
        <>
          {!isPipeline && (
            <div>
              <div className="section-label" style={{ marginBottom: 6 }}>Top importers, by region/group</div>
              {importers.length > 0 ? (
                <>
                  <div style={{ height: 36 * importers.length + 24 }} data-testid="importer-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={importers} layout="vertical" margin={{ top: 0, right: 28, left: 0, bottom: 0 }}>
                        <XAxis type="number" domain={[0, 100]} hide />
                        <YAxis type="category" dataKey="country" width={150} tick={{ fill: TOKENS.bone, fontSize: 10 }} axisLine={false} tickLine={false} />
                        <Tooltip
                          cursor={{ fill: "rgba(255,255,255,0.04)" }}
                          contentStyle={{ background: "#0b0b0b", border: "1px solid rgba(244,241,234,0.14)", fontSize: 11 }}
                          formatter={(v) => [`${v}% of route flow`, "share"]}
                        />
                        <Bar
                          dataKey="share_of_route_flow_pct"
                          radius={2}
                          label={{ position: "right", fill: TOKENS.bone, fontSize: 10 }}
                          isAnimationActive={false}
                        >
                          {importers.map((i) => (
                            <Cell key={i.country} fill={i.derived ? "rgba(90,169,255,0.35)" : color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-xs" style={{ color: "var(--color-ash)", margin: "4px 0 0" }}>
                    Pale bars are <strong>derived</strong> (a subtraction of two published shares). EIA publishes destination shares only at region/group level.
                  </p>
                </>
              ) : (
                <p className="text-xs" data-testid="importers-na" style={{ color: "var(--color-ash)", margin: 0 }}>
                  Not available: our sources (EIA) give no importer breakdown for this route, and nothing has been estimated.
                </p>
              )}
            </div>
          )}

          {detail.top_exporters.length > 0 && (
            <div>
              <div className="section-label" style={{ marginBottom: 6 }}>{isPipeline ? "Origin" : "Top exporters"}</div>
              {detail.top_exporters.map((e) => (
                <div key={e.country} className="text-xs" style={{ color: "var(--color-bone)", marginBottom: 2 }}>
                  {e.country}
                  <span className="data-readout" style={{ color: "var(--color-ash)" }}>
                    {" "}{e.share_pct != null ? `${e.share_pct}%` : "share not published"}
                  </span>
                </div>
              ))}
            </div>
          )}
          {isPipeline && (detail.owners?.length ?? 0) > 0 && (
            <div>
              <div className="section-label" style={{ marginBottom: 6 }}>Owners (Global Energy Monitor, partial)</div>
              {detail.owners!.map((o) => (
                <div key={o.name} className="text-xs" style={{ marginBottom: 2 }}>
                  {o.name} <span style={{ color: "var(--color-ash)" }}>({o.country}{o.share_pct != null ? `, ${o.share_pct}%` : ""})</span>
                </div>
              ))}
            </div>
          )}

          {!isPipeline && (
            <div>
              <div className="section-label" style={{ marginBottom: 6 }}>Bypass and if closed</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <Stat
                  label="Bypass capacity"
                  value={route.bypass_capacity_bpd != null ? formatMbpd(route.bypass_capacity_bpd) : "not sourced"}
                  sub={detail.bypass_capacity_low_bpd ? `sensitivity: ${formatMbpd(detail.bypass_capacity_low_bpd)}` : undefined}
                />
                <Stat
                  label="If fully closed"
                  value={detail.if_closed_displaced_bpd != null ? formatMbpd(detail.if_closed_displaced_bpd) : "n/a"}
                  sub={
                    detail.if_closed_displaced_low_bypass_bpd != null
                      ? `displaced; ${formatMbpd(detail.if_closed_displaced_low_bypass_bpd)} with the low bypass`
                      : "displaced, net of bypass"
                  }
                  color={TOKENS.alarm}
                />
              </div>
              {detail.bypass_note && <p className="text-xs" style={{ color: "var(--color-ash)", margin: "6px 0 0" }}>{detail.bypass_note}</p>}
              {detail.affected_hubs && detail.affected_hubs.length > 0 && (
                <p className="text-xs" style={{ color: "var(--color-ash)", margin: "6px 0 0" }}>
                  Hubs depending on this route: {detail.affected_hubs.join(", ")}.
                </p>
              )}
            </div>
          )}
          {isPipeline && detail.bypass_note && <p className="text-xs" style={{ color: "var(--color-ash)", margin: 0 }}>{detail.bypass_note}</p>}
        </>
      )}

      <RouteNews routeId={route.id} />

      {canSimulate && detail && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            position: "sticky",
            bottom: -20,
            margin: "0 -22px -20px",
            padding: "12px 22px 16px",
            background: "linear-gradient(to top, rgba(8,8,8,0.98) 80%, rgba(8,8,8,0))",
            zIndex: 2,
          }}
        >
          <div role="group" aria-label="Disruption type" style={{ display: "flex", gap: 6 }}>
            {(["blockade", "detour"] as const).map((t) => (
              <button
                key={t}
                type="button"
                disabled={t === "detour" && !canDetour}
                aria-pressed={type === t}
                onClick={() => setType(t)}
                className="section-label"
                style={{
                  flex: 1,
                  padding: "6px 0",
                  cursor: t === "detour" && !canDetour ? "not-allowed" : "pointer",
                  borderRadius: 4,
                  background: type === t ? "rgba(232,135,30,0.16)" : "transparent",
                  border: `1px solid ${type === t ? "var(--color-crude)" : "rgba(244,241,234,0.14)"}`,
                  color: type === t ? "var(--color-crude)" : "var(--color-ash)",
                  opacity: t === "detour" && !canDetour ? 0.4 : 1,
                }}
              >
                {t}
              </button>
            ))}
          </div>
          <button
            type="button"
            data-testid="simulate-on-route"
            onClick={() =>
              onSimulate({
                routeId: route.id,
                disruptionType: type,
                blockedSharePct: 100,
                detourDays: detail.default_detour_days ?? 10,
              })
            }
            style={{
              padding: "10px 14px",
              borderRadius: 6,
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 13,
              background: "var(--color-crude)",
              color: "#120a02",
              border: "none",
            }}
          >
            Simulate disruption on this route
          </button>
        </div>
      )}
      {isPipeline && (
        <p className="text-xs" style={{ color: "var(--color-ash)", margin: 0 }} data-testid="pipeline-no-sim">
          Pipelines are shown by nameplate capacity only. No sourced throughput exists, so a disruption cannot be sized here. Simulate a chokepoint or sea lane instead.
        </p>
      )}

      <div className="text-xs font-light italic" style={{ color: "var(--color-ash)", marginTop: "auto" }}>
        <div>Source: {route.source}</div>
        <a href={route.source_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-ash)", textDecoration: "underline", wordBreak: "break-all" }}>
          {route.source_url}
        </a>
        <div>Data year {route.data_year}. {detail?.path_disclaimer ?? "Route geometry is illustrative."}</div>
      </div>
    </aside>
  );
}
