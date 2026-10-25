// Mirrors the Pydantic models in backend/main.py exactly -- field names and
// shapes must stay in sync with the FastAPI response_models there.

export interface SimulateRequest {
  supply_loss_pct: number;
  conflict_intensity: number;
  detour_days: number;
  demand_change_pct: number;
}

export interface EvFeasibility {
  barrels_per_day_lost: number;
  gasoline_vehicle_years_displaced: number;
  lithium_tonnes_required: number;
  lithium_supply_ratio: number;
  explanation: string;
  /** Added keys: the per-EV figure used (sourced case) and the project's earlier 0.008 t LCE for comparison. */
  lce_tonnes_per_ev_used: number;
  lce_tonnes_per_ev_project_assumption: number;
  lithium_tonnes_required_project_assumption: number;
  lithium_supply_ratio_project_assumption: number;
}

export interface SimulateResponse {
  predicted_price_change_pct: number;
  explanation: string;
  model_used: string;
  ev_feasibility: EvFeasibility;
}

export interface ConflictEvent {
  name: string;
  event_date: string;
  chokepoint: string;
  conflict_intensity: number;
  supply_loss_pct: number;
  lat: number | null;
  lng: number | null;
}

export interface RefineryHub {
  name: string;
  country: string;
  lat: number;
  lng: number;
  capacity_bpd: number;
  hub_type: "refinery" | "export_terminal" | "refinery_and_export_terminal";
  nearest_chokepoint: string;
  notes: string;
}

export interface ChokepointRisk {
  chokepoint: string;
  capacity_at_risk_bpd: number;
  pct_of_global_daily_production: number;
  affected_hubs: string[];
}

export const KNOWN_CHOKEPOINTS = ["Hormuz", "Bab el-Mandeb", "Suez", "Malacca"] as const;
export type Chokepoint = (typeof KNOWN_CHOKEPOINTS)[number];

// Unified globe-marker/detail-view data shape. "crude" = oil supply side
// (chokepoints, refinery/export hubs); "ion" = EV/lithium-transition demand
// side (major consuming cities). Every metric must carry real data or say
// so in sourceNote -- see LocationMetric.
export interface LocationMetric {
  label: string;
  value: string;
  delta?: string;
  unit?: string;
}

export interface Location {
  id: string;
  name: string;
  type: "chokepoint" | "city" | "hub";
  lat: number;
  lng: number;
  accent: "crude" | "ion";
  /** 0-1, drives marker glow intensity on the globe. */
  severity: number;
  metrics: LocationMetric[];
  narrative: string;
  sourceNote: string;
}

// News pipeline (backend/news/*) -- mirrors news/db.py's price_state and
// row_to_alert_dict shapes exactly. ALWAYS a simulation calibrated off
// classified news, never a live market feed -- see price_engine.py.
export interface PriceState {
  id: number;
  crude_price_usd: number;
  rolling_baseline_usd: number;
  lithium_supply_index: number;
  last_updated_at: string;
}

export type ClassifierUsed = "rules" | "claude";

export interface AlertEvent {
  id: number;
  occurred_at: string;
  article_title: string;
  article_url: string;
  event_type: string;
  severity: number;
  confidence: number;
  classifier_used: ClassifierUsed;
  price_before: number | null;
  price_after: number | null;
  price_pct_change: number | null;
  lithium_index_before: number | null;
  lithium_index_after: number | null;
  chokepoints: string[];
  countries: string[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Route layer (backend/routers/routes.py, data in backend/data/routes.json).
// Pipelines carry NAMEPLATE CAPACITY, never flow: annual_flow_bpd is null for them.
// ---------------------------------------------------------------------------
export type RouteType = "chokepoint" | "sea_lane" | "pipeline";

export interface RouteSummary {
  id: string;
  name: string;
  type: RouteType;
  /** [lat, lng] waypoints. ILLUSTRATIVE geometry, not surveyed coordinates. */
  path: [number, number][];
  annual_flow_bpd: number | null;
  capacity_bpd: number | null;
  flow_basis: "eia_chokepoint_table" | "nameplate_capacity_gem" | "unverified";
  baseline_year?: number;
  share_of_global_seaborne_oil_pct: number | null;
  bypass_capacity_bpd: number | null;
  alt_route_id: string | null;
  source: string;
  source_url: string;
  data_year: number;
  is_estimate: boolean;
  status?: string;
  excluded_from_calculations?: boolean;
}

export interface CurrentConditions {
  note: string;
  links: { label: string; url: string }[];
}

export interface RoutesResponse {
  path_disclaimer: string;
  current_conditions: CurrentConditions;
  routes: RouteSummary[];
}

export interface RouteImporter {
  country: string;
  iso3: string | null;
  level: "country" | "group";
  derived: boolean;
  share_of_route_flow_pct: number;
  basis?: string;
}

export interface RouteExporter {
  country: string;
  share_pct: number | null;
  basis?: string;
}

export interface RouteOwner {
  name: string;
  country: string;
  share_pct: number | null;
}

/** GET /api/v1/routes/{id}: route fields plus (for the four original chokepoints) the legacy bypass keys. */
export interface RouteDetail extends RouteSummary {
  annual_flow_bbl_per_year: number | null;
  capacity_label: string | null;
  if_closed_displaced_bpd: number | null;
  if_closed_displaced_low_bypass_bpd: number | null;
  if_closed_supply_loss_pct: number | null;
  top_importers: RouteImporter[];
  importers_unverified?: string;
  top_exporters: RouteExporter[];
  owners?: RouteOwner[];
  bypass_note?: string;
  bypass_capacity_low_bpd?: number;
  baseline_year_note?: string;
  baseline_voyage_days: number | null;
  default_detour_days?: number;
  flow_by_year_bpd?: Record<string, number>;
  exclusion_reason?: string;
  capacity_resolution?: { finding: string; decision: string };
  current_conditions: CurrentConditions;
  path_disclaimer: string;
  // legacy bypass keys (present only for hormuz, bab_el_mandeb, suez, malacca)
  chokepoint?: string;
  capacity_at_risk_bpd?: number;
  affected_hubs?: string[];
  explanation?: string;
}

export type NewsTag = "attack" | "sanctions" | "disruption" | "shipping" | "general";

/** Headline, source, date and link only (never article text). */
export interface NewsItem {
  title: string;
  source: string;
  published_at: string;
  url: string;
  tag: NewsTag;
}

/** GET /api/v1/routes/{id}/news. stale=true means the live feed failed and this is the last cached result. */
export interface RouteNews {
  route_id: string;
  route_name: string;
  items: NewsItem[];
  count: number;
  stale: boolean;
  feed: "gdelt";
  feed_status: "ok" | "empty" | "stale" | "unavailable";
  last_updated: string | null;
  message: string | null;
  cache_ttl_seconds: number;
  timespan: string;
  attribution: string;
}

/** What "Simulate disruption on this route" hands to the scenario controls. */
export interface RouteScenarioPrefill {
  routeId: string;
  disruptionType: "blockade" | "detour";
  blockedSharePct: number;
  detourDays: number;
  nonce: number;
}
