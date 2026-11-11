// Thin client for the real FastAPI backend. Requests go to /api/v1/... which
// vite.config.ts proxies to http://127.0.0.1:8000 in dev; in production this
// assumes the frontend is served from behind the same origin as the API (or
// a reverse proxy doing the same job) -- revisit if that stops being true.

import type {
  ChokepointRisk,
  HostedConfig,
  HeadlinesResponse,
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
  WatchlistResponse,
  VesselTrack,
  VesselNear,
  SavedSearch,
  ProviderSearch,
} from "../types";

/** Empty when the page and the API share an origin (dev proxy, one host). A separate frontend host sets VITE_API_ORIGIN at build time (a public address, not a secret). */
export const API_ORIGIN: string = (import.meta.env.VITE_API_ORIGIN as string | undefined)?.replace(/\/$/, "") ?? "";
const API_BASE = `${API_ORIGIN}/api/v1`;

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // the public site answers with {error, message}: show that sentence, not the raw body
    let friendly: string | null = null;
    try {
      const j = JSON.parse(body) as { error?: string; message?: string };
      if (j.error && j.message) friendly = j.message;
    } catch {
      friendly = null;
    }
    if (friendly) throw new Error(friendly);
    throw new Error(`${init?.method ?? "GET"} ${path} failed: ${res.status} ${body}`);
  }
  return res.json() as Promise<T>;
}

export function getHeadlines(): Promise<HeadlinesResponse> {
  return fetchJson<HeadlinesResponse>("/news/headlines");
}

export function getHosted(): Promise<HostedConfig> {
  return fetchJson<HostedConfig>("/hosted");
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

/** The saved watchlist of real tankers. Never fails on the server side (status NONE when there is no snapshot). */
export function getWatchlist(): Promise<WatchlistResponse> {
  return fetchJson<WatchlistResponse>("/vessels/watchlist");
}

export function getVesselTrack(mmsi: number): Promise<VesselTrack> {
  return fetchJson<VesselTrack>(`/vessels/${mmsi}/track`);
}

export function getVesselNear(mmsi: number): Promise<VesselNear> {
  return fetchJson<VesselNear>(`/vessels/${mmsi}/near`);
}

/** The saved watchlist only: this never reaches the provider. */
export function searchSaved(q: string): Promise<SavedSearch> {
  return fetchJson<SavedSearch>(`/ais/search?q=${encodeURIComponent(q)}`);
}

/** ONE provider search. Only ever called from an explicit button press, never from typing. */
export function searchProvider(q: string): Promise<ProviderSearch> {
  return fetchJson<ProviderSearch>("/ais/search/provider", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q }) });
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
