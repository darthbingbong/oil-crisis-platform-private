// Offline fallback for GET /api/v1/refineries/at-risk/{chokepoint}, mirroring
// backend/refineries.py's capacity_at_risk_bpd / capacity_at_risk_pct_of_global.
// Used only when the real backend request fails (see ChokepointPanel.tsx) --
// computed against whatever refinery data the caller has on hand (real or mock).

import type { ChokepointRisk, RefineryHub } from "../types";

// Mirrors backend/services/config.py global_supply_bpd (EIA world oil supply, 2024).
const DEFAULT_GLOBAL_DAILY_CRUDE_PRODUCTION_BBL = 103_300_000.0;

export function computeChokepointRisk(refineries: RefineryHub[], chokepoint: string): ChokepointRisk {
  const affected = refineries.filter(
    (r) => r.nearest_chokepoint.toLowerCase() === chokepoint.toLowerCase()
  );
  const capacity = affected.reduce((sum, r) => sum + r.capacity_bpd, 0);

  return {
    chokepoint,
    capacity_at_risk_bpd: capacity,
    pct_of_global_daily_production:
      Math.round((capacity / DEFAULT_GLOBAL_DAILY_CRUDE_PRODUCTION_BBL) * 10000) / 10000,
    affected_hubs: affected.map((r) => r.name),
  };
}
