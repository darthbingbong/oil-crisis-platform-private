// OFFLINE FALLBACK mirror of the backend's prediction logic (backend/main.py
// + backend/ev_lithium.py). ScenarioPanel calls the real POST /api/v1/simulate
// endpoint first; this only runs if that request fails (backend not running),
// so the UI stays usable instead of breaking outright -- shown with an
// "OFFLINE" badge so it's never mistaken for a live prediction. Intentionally
// a duplicate of backend logic -- if the backend formula changes, update here
// too or this fallback silently drifts.

import type { EvFeasibility, SimulateRequest, SimulateResponse } from "../types";

const ELASTICITY = 0.15;

const GASOLINE_YIELD_GAL_PER_BBL = 19.5;
const ANNUAL_FUEL_GAL_PER_VEHICLE = 500.0;
// Mirrors backend/services/config.py (single source of truth). Keep in sync.
const DEFAULT_GLOBAL_DAILY_CRUDE_PRODUCTION_BBL = 103_300_000.0; // EIA world oil supply, 2024
const LCE_PER_T_LI = 5.323; // USGS reports lithium content; LCE = Li x 5.323
// Sourced per-EV case: 0.10 kg Li/kWh (ICCT 2024, NMC-811) x 60 kWh pack (IEA GEVO 2026) x 5.323 = 0.0319 t LCE.
// The project's earlier 0.008 t assumption is kept for comparison only.
const LCE_TONNES_PER_EV_BATTERY = (0.1 * 60 * LCE_PER_T_LI) / 1000;
const LCE_TONNES_PER_EV_PROJECT = 0.008;
const GLOBAL_ANNUAL_LITHIUM_PRODUCTION_TONNES = 290_000.0 * LCE_PER_T_LI; // USGS MCS 2026, 2025 est., in t LCE

function evFeasibility(supplyLossPct: number): EvFeasibility {
  if (supplyLossPct <= 0) {
    return {
      barrels_per_day_lost: 0,
      gasoline_vehicle_years_displaced: 0,
      lithium_tonnes_required: 0,
      lithium_supply_ratio: 0,
      lce_tonnes_per_ev_used: LCE_TONNES_PER_EV_BATTERY,
      lce_tonnes_per_ev_project_assumption: LCE_TONNES_PER_EV_PROJECT,
      lithium_tonnes_required_project_assumption: 0,
      lithium_supply_ratio_project_assumption: 0,
      explanation: "No supply loss in this scenario, so there's no oil demand for EVs to displace.",
    };
  }

  const barrelsPerDayLost = DEFAULT_GLOBAL_DAILY_CRUDE_PRODUCTION_BBL * (supplyLossPct / 100);
  const barrelsTotal = barrelsPerDayLost * 365;
  const gasolineGallonsTotal = barrelsTotal * GASOLINE_YIELD_GAL_PER_BBL;
  const vehicleYears = gasolineGallonsTotal / ANNUAL_FUEL_GAL_PER_VEHICLE;
  const lithiumTonnes = vehicleYears * LCE_TONNES_PER_EV_BATTERY;
  const lithiumRatio = lithiumTonnes / GLOBAL_ANNUAL_LITHIUM_PRODUCTION_TONNES;
  const lithiumTonnesProject = vehicleYears * LCE_TONNES_PER_EV_PROJECT;

  const lithiumClause =
    lithiumRatio >= 1
      ? `${lithiumRatio.toFixed(1)}x the world's entire annual lithium production, so full EV substitution isn't realistic within a single year at this scale.`
      : `about ${(lithiumRatio * 100).toFixed(1)}% of the world's annual lithium production.`;

  return {
    barrels_per_day_lost: Math.round(barrelsPerDayLost),
    gasoline_vehicle_years_displaced: Math.round(vehicleYears),
    lithium_tonnes_required: Math.round(lithiumTonnes),
    lithium_supply_ratio: Math.round(lithiumRatio * 1000) / 1000,
    lce_tonnes_per_ev_used: LCE_TONNES_PER_EV_BATTERY,
    lce_tonnes_per_ev_project_assumption: LCE_TONNES_PER_EV_PROJECT,
    lithium_tonnes_required_project_assumption: Math.round(lithiumTonnesProject),
    lithium_supply_ratio_project_assumption:
      Math.round((lithiumTonnesProject / GLOBAL_ANNUAL_LITHIUM_PRODUCTION_TONNES) * 1000) / 1000,
    explanation:
      `A ${supplyLossPct.toFixed(1)}% loss of global crude supply removes about ` +
      `${Math.round(barrelsPerDayLost).toLocaleString()} barrels/day. Over 1.0 year(s), that's ` +
      `${Math.round(gasolineGallonsTotal).toLocaleString()} gallons of gasoline that won't get ` +
      `refined -- roughly the annual fuel needs of ${Math.round(vehicleYears).toLocaleString()} ` +
      `gasoline vehicles. Replacing that many vehicles with EVs instead would need about ` +
      `${Math.round(lithiumTonnes).toLocaleString()} tonnes of lithium (as LCE) -- ${lithiumClause} ` +
      `(Basis: ${LCE_TONNES_PER_EV_BATTERY.toFixed(4)} t LCE per EV; the project's earlier ` +
      `${LCE_TONNES_PER_EV_PROJECT} t assumption would give ${Math.round(lithiumTonnesProject).toLocaleString()} t.)`,
  };
}

export function localSimulate(req: SimulateRequest): SimulateResponse {
  const predictedPct = req.supply_loss_pct / ELASTICITY;
  const parts: string[] = [];

  if (req.supply_loss_pct > 0) {
    parts.push(
      `A ${req.supply_loss_pct.toFixed(1)}% loss of global supply, under standard short-run ` +
        `demand inelasticity (Ed = -${ELASTICITY}), implies roughly a ${predictedPct.toFixed(1)}% price increase.`
    );
  } else if (req.supply_loss_pct < 0) {
    parts.push(
      `A ${Math.abs(req.supply_loss_pct).toFixed(1)}% increase in supply implies roughly a ` +
        `${Math.abs(predictedPct).toFixed(1)}% price decrease.`
    );
  } else {
    parts.push("No direct supply change specified.");
  }

  if (req.demand_change_pct !== 0) {
    parts.push(
      `Note: this scenario also involves a ${req.demand_change_pct.toFixed(1)}% demand change. ` +
        `Demand-driven events (like 2020 COVID or 2008) behave differently from pure supply ` +
        `shocks, and this formula does not yet account for that -- treat this estimate as ` +
        `less reliable when demand_change_pct is far from zero.`
    );
  }

  if (req.conflict_intensity >= 7 && req.supply_loss_pct < 2) {
    parts.push(
      `Conflict intensity is high (${req.conflict_intensity}) but modeled supply loss is low -- ` +
        `historically (e.g. the 2025 Israel-Iran war), this pattern produces a real but ` +
        `short-lived price spike that fades once markets confirm no physical disruption occurred.`
    );
  }

  return {
    predicted_price_change_pct: Math.round(predictedPct * 100) / 100,
    explanation: parts.join(" "),
    model_used: "elasticity_formula_baseline (local preview copy)",
    ev_feasibility: evFeasibility(req.supply_loss_pct),
  };
}
