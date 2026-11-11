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
  /** true: the last cached result is shown at once while a fresh one is fetched in the background. */
  refreshing: boolean;
  /** true: a saved DEMO SNAPSHOT of real headlines (with its own date), NOT live and not from this session. */
  snapshot: boolean;
  feed: "gdelt";
  feed_status: "ok" | "empty" | "stale" | "snapshot" | "unavailable";
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
  /** Set when restoring from the Results page ("Edit scenario"); the route panel's button leaves these to the defaults. */
  detourUserSet?: boolean;
  durationDays?: number;
  lithiumAvailabilityPct?: number;
  conflictIntensity?: number;
  demandChangePct?: number;
  evSubstitutionPct?: number;
  horizonYears?: number;
  fleetConstrained?: boolean;
  baselineYear?: number | null;
}

// ---------------------------------------------------------------------------
// POST /api/v1/simulate/report (backend/services/report.py). Only the fields the Results page reads are typed.
// ---------------------------------------------------------------------------
export interface Assumption {
  text: string;
  source: string | null;
  source_url: string | null;
  is_estimate: boolean;
}

export interface ReportSectionBase {
  title: string;
  summary: string;
  takeaway: string;
  assumptions: Assumption[];
}

export interface TrajectoryPoint {
  day: number;
  pct: number;
  low: number | null;
  high: number | null;
  beyond_validated: boolean;
}

export interface ValidatedReference {
  name: string;
  date: string;
  supply_loss_pct: number;
  actual_price_move_pct: number;
  n_events: number;
  note: string | null;
}

export interface BypassCase {
  label: string;
  bypass_bpd: number;
  displaced_bpd: number;
  supply_loss_pct: number;
  price_impact_pct: number;
}

export interface MacroItem {
  key: string;
  label: string;
  unit: string;
  low: number;
  high: number;
  is_point: boolean;
  per_10pct_low: number;
  per_10pct_high: number;
  source: string;
  source_url: string;
  year: number;
  quote: string;
  corroboration: string;
}

export interface ReportResponse {
  scenario: {
    route_id: string;
    route_name: string;
    disruption_type: "blockade" | "detour";
    blocked_share_pct: number;
    detour_days: number;
    detour_days_default: number | null;
    detour_days_source: "user" | "route default";
    duration_days: number;
    conflict_intensity: number;
    demand_change_pct: number;
    ev_substitution_rate_pct: number;
    lithium_availability_pct: number;
    fleet_constrained: boolean;
    horizon_years: number;
    baseline_year: number;
  };
  baseline: { route_id: string; route_name: string; year: number; flow_bpd: number; label: string; note: string | null; depressed_by_red_sea: boolean };
  current_conditions: CurrentConditions;
  kpis: {
    price_impact_pct: number;
    price_horizon_days: number;
    validation_badge: string;
    price_band_pp: number | null;
    outside_validated_range: boolean;
    validated_note: string | null;
    displaced_bpd: number;
    evs_required: number;
    extra_lithium_t_lce: number;
    extra_lithium_range_t_lce: [number, number];
    lithium_deficit_t_lce: number;
    lithium_headline_case: string;
    horizon_years: number;
  };
  caveats: string[];
  validated_supply_loss_max_pct: number;
  validated_reference: ValidatedReference;
  sections: {
    barrels: ReportSectionBase & {
      chart: { series: { day: number; daily_bbl: number; cumulative_bbl: number }[] };
      numbers: { displaced_bpd: number; supply_loss_pct: number; transit_gap_bbl: number; baseline_voyage_days?: number; delivery_factor?: number };
    };
    price: ReportSectionBase & {
      chart: { trajectory: TrajectoryPoint[]; horizon_days: number; band_validated: boolean; validated_price_ceiling_pct: number; validated_reference: ValidatedReference };
      sensitivity: BypassCase[];
    };
    evs: ReportSectionBase & {
      chart: {
        horizons: { years: number; total_evs: number; evs_per_year: number; x_current_global_production: number; x_current_global_sales: number }[];
        current_global_sales: number;
        current_global_production: number;
        current_data_year: number;
        source: string;
        source_url: string;
      };
    };
    lithium: ReportSectionBase & {
      chart: {
        cases: Record<"project" | "sourced", { label: string; lce_t_per_ev: number; required_t_lce: number; deficit_t_lce: number; supply_cap_over_horizon_t_lce: number; supply_cap_per_year_t_lce: number; pct_of_world_production_per_year: number }>;
        headline_case: string;
        pack_cases: { label: string; pack_kwh: number; lce_t_per_ev: number; required_t_lce: number; deficit_t_lce: number }[];
        range_t_lce: [number, number];
        world_production_2025_t_lce: number;
        chemistry_caveat: string;
      };
    };
    importers: ReportSectionBase & {
      chart: { importers: { name: string; iso3: string | null; level: string; derived: boolean; share_of_route_flow_pct: number; shortfall_bpd: number; reserve_cover_days: number | null }[]; label: string };
    };
    economy: ReportSectionBase & {
      chart: {
        items: MacroItem[];
        hard_numbers: { label: string; value: number; unit: string }[];
        sectors: { sector: string; direction: string; quantified: boolean; note: string }[];
      };
    };
  };
}

// ---------------------------------------------------------------------------
// Oil prices (backend/services/price_feed.py). Status is DAILY_CLOSE or OFFLINE_FALLBACK, never "live".
// ---------------------------------------------------------------------------
export type PriceStatus = "DAILY_CLOSE" | "OFFLINE_FALLBACK";

export interface PriceLive {
  wti: number | null;
  brent: number | null;
  change: number | null;
  change_pct: number | null;
  brent_change: number | null;
  brent_change_pct: number | null;
  as_of: string;
  brent_as_of: string | null;
  status: PriceStatus;
  age_days: number;
  age_warning: string | null;
  source: string;
  units: string;
  fetched_at: string | null;
  cached: boolean;
  fallback_reason: string | null;
  fallback_message: string | null;
}

export interface PricePoint {
  date: string;
  wti: number | null;
  brent: number | null;
  source: "csv" | "eia";
}

export interface PriceHistory {
  points: PricePoint[];
  days: number;
  status: PriceStatus;
  latest_date: string;
  age_days: number;
}

// ---- Saved watchlist of real tankers (GET /api/v1/vessels/watchlist). Always a snapshot unless a deliberate refresh just happened.
export type VesselFreshness = "LIVE" | "DELAYED" | "STALE" | "SNAPSHOT";

export interface WatchVessel {
  mmsi: number;
  imo: number | null;
  name: string | null;
  flag: string | null;
  flag_source: string | null;
  ship_type: number;
  length_m: number | null;
  draught_m: number | null;
  destination: string | null;
  sog_kn: number | null;
  cog_deg: number | null;
  heading_deg: number | null;
  nav_status: string;
  lat: number;
  lng: number;
  last_seen_utc: string | null;
  last_seen_age_s_now: number | null;
  record_fetched_utc: string | null;
  position_confirmed_by: string | null;
  area: string;
  state: VesselFreshness;
  typed_as_tanker_by: string | null;
  cargo_note: string;
}

export interface WatchlistSample {
  label: string;
  area: string;
  seed: { mmsi: number; name: string } | null;
  fetched_utc: string;
  radius_nm: number;
  returned: number;
  caveat: string;
}

/** The AIS key's state and the plain sentence to show (the server decides; the browser never counts days itself). */
export interface AisKeyInfo {
  expires_on: string;
  expires_in_days: number;
  expired: boolean;
  line: string;
  saved_on: string | null;
}

/** A saved past track (Vessel History Track), served from disk. points: [lng, lat, unix seconds, speed over ground]. */
export interface VesselTrack {
  status: "SAVED" | "NONE";
  mmsi: number;
  name?: string | null;
  label: string;
  fetched_utc?: string | null;
  first_point_utc?: string | null;
  last_point_utc?: string | null;
  points_provider?: number;
  path_nm?: number | null;
  start_to_end_nm?: number | null;
  max_sog_kn?: number | null;
  stationary?: boolean;
  motion_note?: string | null;
  headline?: boolean;
  points: [number, number, number, number | null][];
  note?: string;
  key?: AisKeyInfo;
}

export interface NearVessel { mmsi: number; name: string | null; ship_type: number | null; tanker: boolean; nav_status: string | null; sog_kn: number | null; distance_nm: number }

/** The saved Vessels Nearby sample that contains a vessel. Never live, never an area count. */
export interface VesselNear {
  status: "SAVED SAMPLE" | "NOT_IN_SAMPLE" | "NONE";
  mmsi: number;
  label?: string;
  seed?: { mmsi: number; name: string };
  fetched_utc?: string;
  radius_nm?: number;
  returned?: number;
  caveat?: string;
  note: string;
  message?: string;
  distances_note?: string;
  listed?: number;
  vessels: NearVessel[];
  key?: AisKeyInfo;
}

export interface SavedSearchHit { mmsi: number; name: string | null; flag: string | null; area: string; ship_type: number | null; nav_status: string | null }
export interface SavedSearch {
  query: string;
  source: string;
  results: SavedSearchHit[];
  message: string | null;
  provider_search: { available: boolean; min_chars: number; note: string };
}
export interface ProviderHit { mmsi: number; imo: number | null; name: string | null; call_sign: string | null; flag: string | null; last_report_utc: string | null; in_watchlist: boolean }
export interface ProviderSearch {
  status: "OK" | "NO_MATCH" | "TOO_SHORT" | "KEY_EXPIRED" | "UNAVAILABLE";
  query: string;
  message: string | null;
  note?: string;
  kind?: string;
  retry_after_s?: number | null;
  results: ProviderHit[];
  key: AisKeyInfo;
}

export interface WatchlistResponse {
  status: "SNAPSHOT" | "NONE";
  provider: string;
  key_expires_in_days: number;
  key: AisKeyInfo;
  key_expired: boolean;
  key_line: string;
  captured_at_utc: string | null;
  label: string | null;
  note: string;
  vessels: WatchVessel[];
  samples: WatchlistSample[];
}

/** GET /api/v1/hosted: what the deployment says about itself (public facts only, never a key). */
export interface HostedSource {
  enabled: boolean;
  label: string;
  attribution: string | null;
  url: string | null;
}
export interface HostedConfig {
  hosted: boolean;
  sources: Record<string, HostedSource>;
  voyage_distances: "estimated" | "shipfinder";
  vessels: "SIMULATED_ONLY" | "SIMULATED_AND_SAVED_REAL";
  disclaimer: string;
  privacy: string;
  repo_url: string;
  tradingview_note: string;
}
