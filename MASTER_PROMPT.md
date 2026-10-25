# MASTER PROMPT — Final Build: Maritime Oil Crisis & EV/Lithium Transition Platform

You are the lead engineer finishing a nearly complete project. Read this whole file before writing any code. Work autonomously through the milestones in order, but **prove every milestone works (run it, show real output) before moving on.**

---

## 0. Mission

A Bloomberg Terminal–style web platform where a user simulates a maritime oil crisis (blockade, detour, supply loss) and sees:

1. The **global price impact** with a plain-language explanation of why.
2. A **3D globe** with clearly highlighted oil shipping lanes and pipelines. Clicking one shows its stats and recent news.
3. A **full results page** after pressing Simulate: barrels displaced, EVs required to offset them, extra lithium to mine, and economy/market impact, each chart with a written summary.
4. A **live oil price** display.
5. **Real-time tanker movement** on the map.

The end user is a student presenting this to a professor. **Credibility beats flash**: every number must be traceable to a source, a formula, or a clearly labelled assumption.

---

## 1. Read these first (existing work — do not discard)

- `PHASE1_SUMMARY.md` — modeling decisions. **The elasticity formula `%ΔP = %ΔS / |Ed|` with `Ed = -0.15` stays the price predictor.** A trained Ridge model was tested against it on 21 historical events and did not beat it (formula MAE ≈ 13.1 pp vs model ≈ 13.8 pp). Do not swap in another model. If you believe a change is justified, stop and show a real leave-one-out comparison first.
- `backend/main.py` — FastAPI with `POST /api/v1/simulate` and `GET /api/v1/conflicts`. **Keep both endpoints working and backward compatible.**
- `backend/data/events.csv` (24 real events), `backend/data/price_surge_baseline.joblib`, `oil_daily_prices.csv` (EIA daily WTI/Brent, 1986–2026), `electric-car-sales-share.csv` (IEA via OWID), `oil_production_statistics.csv`, `globalEnergyOwnership.xlsx`.
- Existing frontend (React + TypeScript + Tailwind + react-globe.gl). Inspect it and build on it; do not rewrite from scratch unless it is unsalvageable, and if so, say why first.

**Milestone 0 (before anything else):** audit the repo, start the backend and frontend, hit every existing endpoint, run any existing tests, and report what works, what is broken, and the actual folder layout. Note that the FastAPI/Pydantic layer was never verified end to end in an earlier session.

---

## 2. Non-negotiable rules

1. **No fabricated data.** Route volumes, importer shares, reserves, and prices must come from a cited source (EIA, IEA, USGS, UN Comtrade, OPEC, Energy Institute). Every data record carries `source`, `source_url`, `data_year`, and `is_estimate`. Anything you cannot verify gets `is_estimate: true` and a visible "estimate" tag in the UI. Search the web for current figures; do not rely on memory.
2. **No fake "live".** Delayed or daily data is labelled `DELAYED` or `DAILY CLOSE` with an "as of" timestamp. Simulated vessels carry a prominent `SIMULATED` badge. Never present one as the other.
3. **Secrets stay server-side.** All API keys live in `backend/.env` (provide `.env.example`; add `.env` to `.gitignore`). The browser never sees a key.
4. **Graceful degradation.** Every external feed (price, news, AIS) has a timeout, retry with backoff, caching, and a fallback. The app must run fully with zero API keys, falling back to local data and simulated vessels, with the UI saying so.
5. **Verify before verifying again.** Before integrating any third-party API, read its current docs and terms of use, and tell me anything that limits use (rate limits, paid tiers, redistribution rules).
6. **Commit per milestone** with a clear message. Do not rewrite git history.
7. **Explain as you go in plain terms.** I am comfortable in a terminal but new to backend and ML. Keep explanations short. Flag every assumption.
8. **Do not reproduce news article text.** Show headline, source, date, and a link only.

---

## 3. Target architecture

```
oil-crisis-platform/
├── MASTER_PROMPT.md
├── PHASE1_SUMMARY.md
├── README.md                  # methodology, assumptions, limitations, how to run
├── backend/
│   ├── main.py                # keep; mount routers
│   ├── routers/ (routes.py, report.py, price.py, vessels.py)
│   ├── services/ (calc_engine.py, price_feed.py, news_feed.py, ais_feed.py, cache.py)
│   ├── data/ (events.csv, routes.json, importers.json, lithium_usgs.json, ...)
│   ├── tests/
│   ├── .env.example
│   └── requirements.txt
└── frontend/
    └── src/ (pages/Dashboard, pages/Results, components/, hooks/, lib/api.ts, types/)
```

New endpoints (existing ones unchanged):

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/routes` | All routes/pipelines with geometry + summary stats |
| GET | `/api/v1/routes/{id}` | Full stats for one route |
| GET | `/api/v1/routes/{id}/news` | Recent headlines for that route (cached) |
| POST | `/api/v1/simulate/report` | Full scenario report for the Results page |
| GET | `/api/v1/price/live` | Latest WTI + Brent with status badge |
| GET | `/api/v1/price/history` | Recent series for sparkline (from local CSV + feed) |
| WS | `/ws/vessels` | Streamed tanker positions |
| GET | `/api/v1/health` | Status of each external feed (ok / degraded / fallback) |

---

## 4. Feature specs

### 4.1 Realistic UI (applies everywhere)

- Layout: top **ticker bar** (WTI, Brent, change, status badge, UTC clock) · left **scenario controls** · center **globe** · right **context panel** (route/vessel/country details) · bottom **status bar** (feed health, last update).
- Style: `bg-slate-950` base, glassmorphic cards, cyan / amber / crimson status colors, monospace tabular numerals for all figures (e.g. JetBrains Mono / IBM Plex Mono) with a clean sans for text. Dense but legible. Consistent spacing scale and design tokens.
- Globe: dark earth texture, subtle bump map, atmosphere glow, soft night lights. Target 60 fps on a mid-range laptop; cap rendered vessels (~2,000) and throttle updates.
- Real loading skeletons, error states, empty states, keyboard-focusable controls, responsive down to tablet width.
- Motion should carry meaning (e.g. pulsing rings scale with `conflict_intensity`), not decoration.

### 4.2 Highlighted routes and pipelines with click-through stats

**Rendering.** Use `pathsData` (not straight `arcsData`) so shipping lanes follow real sea paths using ordered waypoints. Distinguish three types visually:
- Sea lanes: cyan glow, animated dash flow showing direction.
- Pipelines: amber, thinner, solid.
- Detour or disrupted routes: pulsing crimson, elevated.

Line width scales with annual flow. Hover shows a tooltip (name, flow). Click flies the camera to the route, highlights it, dims the others, and opens the right-hand panel.

**Minimum route set** (verify each against EIA's World Oil Transit Chokepoints and similar sources, and add others if well documented):
- Chokepoints and lanes: Strait of Hormuz, Bab el-Mandeb / Red Sea, Suez Canal, Strait of Malacca, Turkish Straits (Bosphorus), Danish Straits, Cape of Good Hope detour lane.
- Pipelines: Saudi East–West (Petroline), Habshan–Fujairah, SUMED, Druzhba, Baku–Tbilisi–Ceyhan, CPC, Trans-Alaska.

**Data record** (`routes.json`):

```json
{
  "id": "hormuz",
  "name": "Strait of Hormuz",
  "type": "chokepoint | sea_lane | pipeline",
  "path": [[lat, lng], ...],
  "annual_flow_bpd": 0,
  "share_of_global_seaborne_oil_pct": 0,
  "top_importers": [{"country": "", "iso3": "", "share_of_route_flow_pct": 0}],
  "top_exporters": [{"country": "", "share_pct": 0}],
  "bypass_capacity_bpd": 0,
  "baseline_voyage_days": 0,
  "alt_route_id": "cape_good_hope",
  "source": "", "source_url": "", "data_year": 0, "is_estimate": false
}
```

**Click panel shows:** annual flow (barrels/day and barrels/year), share of global seaborne oil, a bar chart of top importing countries, top exporters, bypass options and capacity, the "if closed" quick stat (barrels/day displaced net of bypass), and a **Recent news** section (4.2.1). Include a "Simulate disruption on this route" button that pre-fills the scenario controls.

#### 4.2.1 Route news

- `GET /api/v1/routes/{id}/news` queries a news source by route keywords (default: GDELT DOC 2.0 API, no key needed; optional NewsAPI or GNews if a key is set — check current terms).
- Return `title`, `source`, `published_at`, `url`, and a `tag` (e.g. `disruption`, `attack`, `sanctions`, `shipping`) from a simple keyword classifier. No article body text.
- Cache 15–30 minutes. If the feed fails, return the last cached result with `stale: true`. The panel shows "last updated" time and a clear message if empty.

### 4.3 Simulate → Results page

Pressing **Simulate** navigates to `/results` (React Router). Encode the scenario in URL query params so the page is shareable and survives refresh. Include a "Back to map" button and "Edit scenario". Call `POST /api/v1/simulate/report`.

**Scenario inputs:** `route_id`, `disruption_type` (`blockade` | `detour`), `blocked_share_pct`, `detour_days`, `duration_days`, `conflict_intensity`, `demand_change_pct`, `ev_substitution_rate_pct`, `lithium_availability_pct`.

**Calculation methodology** (implement in `services/calc_engine.py`, pure functions, fully unit-tested; every constant is configurable and documented):

1. **Barrels displaced per day.**
   - Blockade: `displaced_bpd = max(0, route_flow_bpd × blocked_share − bypass_capacity_bpd)`.
   - Detour: with a fixed tanker fleet, voyage time `T` becomes `T + Δt`, so delivery rate scales by `T / (T + Δt)`. `displaced_bpd = route_flow_bpd × (1 − T / (T + Δt))`. Also report the one-time transit gap `route_flow_bpd × Δt` barrels. Expose `fleet_constrained` (default true = worst case); state this assumption on the page.
2. **Supply loss %** `= displaced_bpd / GLOBAL_SUPPLY_BPD × 100`. Source `GLOBAL_SUPPLY_BPD` from EIA, cited in config.
3. **Price impact** `= supply_loss_pct / 0.15` (the validated Phase 1 formula). Build a 180-day trajectory by applying exponential decay toward baseline with a configurable half-life (default short when `duration_days` is short; sustained while the disruption lasts). Label the decay as an assumption. Show an **uncertainty band of ±13 percentage points** (Phase 1 leave-one-out MAE) and say where the number comes from. Keep the existing demand-shock and high-conflict/low-supply-loss caveats from `main.py`.
4. **EVs required.** `1 bbl = 42 gal crude ≈ 19.5 gal gasoline`; `1 gasoline car ≈ 500 gal/yr`. `vehicles_offset = displaced_bpd × 19.5 × 365 / 500`. For 1, 3 and 5-year horizons report total EVs needed and EVs per year, compared with current global EV sales (IEA Global EV Outlook; cite). Make `GAL_PER_VEHICLE_YEAR` configurable and note that the global average differs from the US figure.
5. **Extra lithium.** `lithium_t_LCE = EVs × 0.008`. Compare to current annual global lithium production and reserves by country (USGS Mineral Commodity Summaries; cite year) and show the extra mining required as a % of current production. Apply `lithium_availability_pct` as a supply cap and compute the **deficit** in tonnes LCE.
6. **Importer shortfall.** Using `top_importers`, allocate the displaced barrels by each country's reliance on the route; show the shortfall per country and, where data exists, days of strategic reserve cover.
7. **Economy and markets.** Use cited rules of thumb (IMF, Federal Reserve, EIA or academic studies on oil-price shocks) for indicative effects on global GDP growth, inflation, freight rates and affected sectors (airlines, tanker rates, energy equities). Present them as **ranges labelled "indicative"**, with the source of each coefficient in config. Never show single-point precision for macro effects.

**Golden unit test (synthetic numbers, for tests only):** route flow 10,000,000 bpd, baseline voyage 20 days, detour 20 days, global supply 100,000,000 bpd, 500 gal/yr/vehicle → delivery factor 0.5, displaced 5,000,000 bpd, supply loss 5%, price impact 33.3%, EVs offset 71,175,000, lithium 569,400 t LCE. Add edge cases: zero detour, negative supply (oversupply), blocked share above bypass, `lithium_availability_pct = 0`.

**Results page layout:** KPI strip at top (price impact, barrels/day displaced, EVs required, extra lithium, deficit). Then these sections, each with a chart, a **2–4 sentence summary**, a collapsible "Assumptions and sources", and a one-line key takeaway:

1. Barrels displaced (daily + cumulative over time)
2. Oil price trajectory over 180 days with uncertainty band
3. EVs required (1 / 3 / 5-year horizons vs current EV production)
4. Lithium required vs supply cap and country reserves (deficit highlighted)
5. Importer country shortfall (bar chart)
6. Global economy and market impact (indicative ranges)

Summaries are generated by the backend from templates filled with computed numbers, so they are deterministic and never contradict the chart. Use Recharts. Add a "Download report (PDF)" or print-friendly stylesheet if time allows.

### 4.4 Live oil price

- `GET /api/v1/price/live` returns `{wti, brent, change, change_pct, as_of, status}` where `status` ∈ `LIVE | DELAYED | DAILY_CLOSE | OFFLINE_FALLBACK`.
- Build a provider abstraction with adapters. Default adapter: EIA API v2 (free key; daily spot, so status `DAILY_CLOSE`). Optionally support a lower-latency provider if a key exists. Research current free options and their terms, and tell me the trade-offs. Do not scrape sites that forbid it.
- Fallback: last row of the local `oil_daily_prices.csv`, status `OFFLINE_FALLBACK`.
- Frontend: persistent ticker with WTI and Brent, colored change, a 30-day sparkline, and the honest status badge. Poll at a sensible interval (respect rate limits) with backoff.

### 4.5 Real-time tanker tracking

Clarification: crude oil moves in **tankers**, not containers. Track tankers.

- Backend `services/ais_feed.py` connects to an AIS data provider server-side (default candidate: AISStream.io WebSocket, needs a free key; verify current terms and coverage). Subscribe to bounding boxes around the key chokepoints and lanes. Keep only tanker ship types (AIS type codes 80–89).
- Dedupe by MMSI, keep the latest position plus a short trail, throttle to at most one update per vessel per ~10 s, and broadcast to the frontend over `WS /ws/vessels`.
- Frontend renders vessels as oriented markers (heading) colored by speed or status, with trails. Click shows name, MMSI, flag, speed, course, destination and draught where available, plus a **"cargo type not confirmed by AIS"** note.
- **Fallback simulated mode** when no key or the feed is down: vessels travel along the route polylines at ~14 knots (the project's tanker speed), with a permanent `SIMULATED` badge.
- When a scenario is active, vessels on a disrupted route should visibly reroute along the alternate lane in simulated mode. This is clearly labelled as simulation.
- **Show these limits in the README and in a UI info tooltip:** AIS coverage has gaps, "dark fleet" vessels switch transponders off (especially around the Gulf), destination fields are unreliable, free tiers can be limited, and AIS does not say what cargo a tanker carries.

---

## 5. Milestones and acceptance criteria

| # | Milestone | Done when |
|---|---|---|
| M0 | Audit and verify existing | Backend and frontend run; existing endpoints return correct output; layout reported |
| M1 | Data layer | `routes.json`, `importers.json`, `lithium_usgs.json` populated with sources; schema validation test passes |
| M2 | Calc engine + `/simulate/report` | All unit tests incl. the golden test pass; endpoint tested with real requests |
| M3 | Route layer and click panel | Routes render, highlight and open stats; "Simulate on this route" works |
| M4 | News | Endpoint returns tagged headlines; cache and stale fallback tested by simulating a failure |
| M5 | Results page | All six sections render from a live API response; URL params restore state on refresh |
| M6 | Live price | Ticker shows correct status badge; fallback verified with keys removed |
| M7 | Vessel tracking | Live mode works with a key; simulated mode works without; performance holds with ~2,000 markers |
| M8 | UI polish and performance | Consistent design across pages; loading/error states; no console errors |
| M9 | Docs and final QA | README complete; full end-to-end run-through recorded |

After each milestone: run the tests, show the actual output, commit, and give me a 3–5 line plain-language summary. Continue automatically unless blocked (missing key, ambiguous decision, or something that conflicts with section 2). When blocked, ask one specific question.

---

## 6. Final deliverables

1. Working app: `uvicorn main:app --reload` (backend) and `npm run dev` (frontend) with a documented one-command-per-side start.
2. `README.md` with: architecture diagram, how to run with and without API keys, data sources table, full methodology (including the Phase 1 result and why the formula was kept), every assumption, and a **Limitations** section.
3. Test suite for the calc engine and endpoints, with a short report of results.
4. A `DEMO_SCRIPT.md`: a 5-minute walkthrough of the app for presenting to a professor, including a worked example (e.g. a 20-day detour on the Red Sea / Suez route) with the numbers the app produces.
5. A `LIMITATIONS_AND_FUTURE_WORK.md`: small event sample (24 events), hand-scored `conflict_intensity`, the borrowed elasticity value, linear price assumption at extreme shocks, AIS caveats, and what data would improve the model next.

---

## 7. Definition of done

- Every number on screen is traceable to a source, a formula, or a labelled assumption.
- No feed is mislabelled (live vs delayed vs simulated).
- The app starts and is usable with no API keys.
- Existing endpoints still work; Phase 1 findings are respected.
- All tests pass, and the final run-through was actually executed, not described.

**Begin with Milestone 0 and report what you find.**
