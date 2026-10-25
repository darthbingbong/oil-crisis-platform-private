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
