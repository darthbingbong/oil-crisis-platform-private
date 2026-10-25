// Thin client for the real FastAPI backend. Requests go to /api/v1/... which
// vite.config.ts proxies to http://127.0.0.1:8000 in dev; in production this
// assumes the frontend is served from behind the same origin as the API (or
// a reverse proxy doing the same job) -- revisit if that stops being true.

import type {
  ChokepointRisk,
  ConflictEvent,
  PriceHistory,
  PriceLive,
  RefineryHub,
  ReportResponse,
  RouteDetail,
  RouteNews,
  RoutesResponse,
  SimulateRequest,
  SimulateResponse,
} from "../types";

const API_BASE = "/api/v1";

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${init?.method ?? "GET"} ${path} failed: ${res.status} ${body}`);
  }
  return res.json() as Promise<T>;
}

export function simulate(req: SimulateRequest): Promise<SimulateResponse> {
  return fetchJson<SimulateResponse>("/simulate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
}

export function getConflicts(): Promise<ConflictEvent[]> {
  return fetchJson<ConflictEvent[]>("/conflicts");
}

export function getRefineries(): Promise<RefineryHub[]> {
  return fetchJson<RefineryHub[]>("/refineries");
}

export function getChokepointRisk(chokepoint: string): Promise<ChokepointRisk> {
  return fetchJson<ChokepointRisk>(`/refineries/at-risk/${encodeURIComponent(chokepoint)}`);
}

export function getRoutes(): Promise<RoutesResponse> {
  return fetchJson<RoutesResponse>("/routes");
}

export function getRouteDetail(id: string): Promise<RouteDetail> {
  return fetchJson<RouteDetail>(`/routes/${encodeURIComponent(id)}`);
}

export function getRouteNews(id: string): Promise<RouteNews> {
  return fetchJson<RouteNews>(`/routes/${encodeURIComponent(id)}/news`);
}

export interface ReportRequest {
  route_id: string;
  disruption_type: "blockade" | "detour";
  blocked_share_pct: number;
  detour_days: number | null;
  duration_days: number;
  lithium_availability_pct: number;
  conflict_intensity?: number;
  demand_change_pct?: number;
  ev_substitution_rate_pct?: number;
  fleet_constrained?: boolean;
  horizon_years?: number;
  baseline_year?: number | null;
}

/** An API error that keeps the HTTP status and the backend's own message (e.g. "pipeline ... cannot be simulated"). */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** The full scenario report for the Results page. 4xx replies carry a human-readable `detail` from the backend. */
export async function simulateReport(req: ReportRequest): Promise<ReportResponse> {
  const res = await fetch(`${API_BASE}/simulate/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    let detail = `The server answered ${res.status}.`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
      else if (Array.isArray(body.detail)) detail = body.detail.map((d: { loc?: string[]; msg?: string }) => `${(d.loc ?? []).slice(1).join(".")}: ${d.msg}`).join("; ");
    } catch {
      /* keep the generic message */
    }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<ReportResponse>;
}

/** Only the fields the scenario controls need from POST /simulate/report (the Results page reads the rest in M5). */
export interface ReportPreview {
  kpis: { displaced_bpd: number; price_impact_pct: number; outside_validated_range: boolean; validated_note: string | null };
  sections: { barrels: { numbers: { supply_loss_pct: number } } };
}

export function simulateReportPreview(req: ReportRequest): Promise<ReportPreview> {
  return fetchJson<ReportPreview>("/simulate/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
}

export function getPriceLive(): Promise<PriceLive> {
  return fetchJson<PriceLive>("/price/live");
}

export function getPriceHistory(days = 30): Promise<PriceHistory> {
  return fetchJson<PriceHistory>(`/price/history?days=${days}`);
}
