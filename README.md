# Maritime Oil Crisis & EV/Lithium Transition Platform

> Work in progress. The full README (architecture, methodology, limitations) is written in Milestone 9.

## Data files not stored in git

`backend/data/globalEnergyOwnership.xlsx` (31 MB) is excluded from git. It is the Global Energy Monitor
**Global Energy Ownership Tracker, March 2026 release** (CC BY 4.0). To reproduce the project, download it from
<https://globalenergymonitor.org/projects/global-energy-ownership-tracker/> and place it at
`backend/data/globalEnergyOwnership.xlsx`. It is used for pipeline owners and nameplate capacities (Oil & NGL Pipeline Ownership sheet).

## API endpoints

| Method | Path | Status | Notes |
|---|---|---|---|
| POST | `/api/v1/simulate` | unchanged | Phase 1 elasticity formula |
| GET | `/api/v1/conflicts` | unchanged | 24 historical events plus news-derived `[SIMULATED]` rows |
| GET | `/api/v1/refineries`, `/api/v1/refineries/at-risk/{chokepoint}` | unchanged | |
| GET | `/api/v1/routes` | new | All 14 routes with illustrative geometry and summary stats |
| GET | `/api/v1/routes/{id}` | **superset of the old endpoint** | Old bypass keys (`chokepoint`, `capacity_at_risk_bpd`, `affected_hubs`, `bypass_options`, `fast_bypass_capacity_bpd`, `uncovered_capacity_bpd`, `explanation`) keep the same key, value and type; route stats are added alongside. Accepts old spellings (`hormuz`, `Hormuz`, `bab%20el-mandeb`) and new ids (`bab_el_mandeb`) |
| GET | `/api/v1/routes/{id}/bypass` | new | The original bypass payload only |
| POST | `/api/v1/simulate/report` | new | Full scenario report for the Results page |
| GET | `/api/v1/routes/{id}/news`, `/price/*`, `/health`, WS `/ws/vessels` | planned | Milestones M4, M6, M7 |

**Route-collision decision: Option A.** `/api/v1/routes/{id}` returns a superset of what `/api/v1/routes/{chokepoint}`
returned before. `backend/tests/test_routes_api.py` checks it against snapshots of the original responses
(`backend/tests/snapshots/*_before.json`), key by key, for all four chokepoints and several URL spellings.
Option B (`/route-data/{id}`) was not needed: no new field clashes with an old key.

## Changelog / corrected values

### Corrected: `POST /api/v1/simulate` lithium and supply values (deliberate exception to backward compatibility)

Key names and response shape are **unchanged**; only wrong values changed. Before/after for the same inputs
(`conflict_intensity=5`; snapshot of the old output in `backend/tests/snapshots/simulate_before.json`):

| supply_loss_pct | barrels/day lost | lithium t LCE needed | `lithium_supply_ratio` |
|---|---|---|---|
| 0.5 | 505,000 to 516,500 | 57,509 to 58,819 | 0.318 to **0.038** |
| 2 | 2,020,000 to 2,066,000 | 230,038 to 235,276 | 1.273 to **0.152** |
| 5 | 5,050,000 to 5,165,000 | 575,094 to 588,190 | 3.181 to **0.379** |
| 8 | 8,080,000 to 8,264,000 | 920,150 to 941,104 | 5.09 to **0.607** |

**What was wrong.**
1. *Unit error (the main one).* World lithium production was stored as `180,000` tonnes and labelled **LCE**
   (lithium carbonate equivalent), but USGS reports lithium **content**. LCE = content x 5.323, so the denominator
   was about 5.3 times too small and the ratio about 5.3 times too large.
2. *Stale year.* 180,000 t was USGS's 2023 figure. The USGS Mineral Commodity Summaries 2026 give 290,000 t lithium
   content for 2025 (estimate), now converted to **1,543,670 t LCE**. This accounts for another factor of about 1.6.
3. *Unsourced supply.* World oil supply was an assumed 101 Mb/d. It is now EIA's **103.3 Mb/d** (2024, World Oil Transit
   Chokepoints, Table 1), so barrels lost and the vehicle and lithium counts rise by about 2.3%.

Combined, the ratio fell by about 8.4 times. The same change moves `GET /api/v1/refineries/at-risk/{chokepoint}`'s
`pct_of_global_daily_production` (Hormuz 0.0613 to 0.0599), because it divided by the same 101 Mb/d.

**Single source of truth.** These constants now live only in `backend/services/config.py` and are shared by `/simulate`
and `/simulate/report`: world supply 103.3 Mb/d, the 5.323 conversion, and the per-EV lithium cases (project 0.008 t LCE and
the sourced 0.0319 t LCE). `ev_lithium.py` keeps its old constant names as read-only aliases of the config values.
The frontend's offline-fallback mirrors (`localFormula.ts`, `chokepointRisk.ts`) were updated to match.

**Consequence for conclusions.** The old finding "a 5% shock needs 3.2 times the world's annual lithium" does not hold for
the 0.008 t/EV project assumption: it is 38% of annual production. With the sourced 0.0319 t/EV case it is about 1.5 times.
`/simulate` still uses the 0.008 project assumption (only wrong values were changed); `/simulate/report` headlines the sourced case.
