# MASTER PROMPT 2 — Final Stage (v1.0 → v2.0)

You are the lead engineer extending a finished, tagged (v1.0) project. Read this whole file before writing code. Work through the milestones in order, in **small commits**, and **prove every milestone works (run it, show real output and screenshots) before moving on.**

All rules in `MASTER_PROMPT.md` section 2 still apply (no fabricated data, no fake "live", secrets server-side, graceful degradation, no article text, commit per milestone). The additions in section 3 apply on top.

---

## 0. What this stage adds

1. A **2D map view** beside the existing 3D globe, in the style of the World Monitor dashboard (a free, Bloomberg-style monitor): easier to read and navigate.
2. **Vessel intelligence from the ShipFinder AIS API**, limited to what the user's key actually allows (section 2): live tankers near key chokepoints and ports, vessel search and details, on-demand vessel tracks, and real sea distances from route planning.
3. The **"Historical events" chart is removed completely** from the dashboard and replaced by a **Markets panel**: commodities, global stock indices and FX, with honest freshness badges.
4. The simulation's price outlook is limited to the **30-day horizon, the only horizon the formula has been validated for**. Nothing beyond 30 days is shown as an estimate.

---

## 1. Read first (existing work)

- `MASTER_PROMPT.md`, `README.md`, `LIMITATIONS_AND_FUTURE_WORK.md`, `DEMO_SCRIPT.md`, `PHASE1_SUMMARY.md`. The git tag `v1.0` is the baseline.
- Current state to build on: FastAPI backend (`backend/`), React + TypeScript + three.js globe (react-three-fiber), the Results page (6 sections), EIA price ticker, GDELT route news, simulated vessels, and an AIS adapter written for AISStream that was **never verified against a live feed**.
- **The price predictor stays the validated elasticity formula** (`%ΔP = %ΔS / 0.15`; Phase 1: formula MAE 13.09 pp at 30 days on 21 events, with the ±13 pp band valid only up to about 8% supply loss). Do not introduce a new ML model.
- **Reference screenshots** are in `docs/reference/` (if missing, ask the user to add them): `ref_worldmonitor_panels.png`, `ref_ais_services.png`, `ref_historical_events_to_remove.png`.
- Existing backend endpoints stay backward compatible. New fields are added only additively.

**Milestone 10 starts with an audit:** check out v1.0, run the tests and both servers, and report the actual state (test count, what runs).

---

## 2. AIS provider: ShipFinder, and what this key can actually do

The user's key was created in the ShipFinder Open Platform console (`https://open.shipfinder.com`); the public API docs are at `https://docs.shipfinder.com`. The key is in `backend/.env` as `AIS_API_KEY` (confirm the name used). Check the line exists **without printing it**. Never print it, log it, commit it or send it to the browser.

### 2.1 Key permissions (read from the user's console on 2026-10-30)

Plan: Starter. Key name: `AIS-vessel-tracker`. **The key and every enabled service expire on 2026-11-13.** The user reports there is **no IP restriction**. 1 of 2 key slots is used.

| Service | Status | Quota |
|---|---|---|
| Vessels Nearby | Enabled | Unmetered |
| Vessel Search | Enabled | Unmetered |
| Vessel Flag Information | Enabled | Unmetered |
| Port Information | Enabled | Unmetered |
| Vessel Position | Enabled | 50 calls |
| Fleet Position | Enabled | 50 calls |
| Vessel History Track | Enabled | **10 calls** |
| Point-to-Point Route Planning | Enabled | **10 routes** |
| Port-to-Port Route Planning | Enabled | **10 routes** |
| **Vessels in Zone** | **Disabled** | – |
| **Berthed Vessels in Port** | **Disabled** | – |
| **Anchored Vessels in Port** | **Disabled** | – |
| **Expected Arrivals** | **Disabled** | – |
| **Vessel Port Call Records, at Specific Port, Current Port Call, Port Calls Records for Port** | **Disabled** | – |
| **Global Marine Weather, Global Tropical Cyclones, Global Port Tides, China Region Navigational Warnings, Ship-to-Ship (STS) Events** | **Disabled** | – |

**Rules that follow from this table:**
- **Do not implement any Disabled service**, and do not call it. The UI hides those features. Record them in `LIMITATIONS_AND_FUTURE_WORK.md` as "not available on the current key".
- "Unmetered" does not mean unlimited. Read the docs for rate limits, maximum radius and maximum results per call, and stay well inside them.
- The "0 / 50" and "0 / 10" counters appear to be totals for the key's life, not per day. Treat them as lifetime until the docs or the console after your first metered call show otherwise, and report what you observe.

### 2.2 Things reported in the public docs that you must verify yourself with the current docs and one real call

- The docs examples show `GET https://api.elaneglobal.com/v1/AIS/<Service>` with the key as a `key=` query parameter. The provider's marketing page instead shows `https://api.shipfinder.com/v1/...` with an `Authorization: Bearer` header. Work out which host and authentication the user's key uses.
- Polygon and coordinate parameters in the docs appear to put **longitude first**. Confirm the order for the services you use.
- Position records carry `last_time` (Unix seconds), `sog`, `cog` and `hdg`; a heading of 511 is the AIS code for "not available". Treat it as missing. Check whether records include an AIS navigational status field (for example "at anchor" or "moored").
- The provider may return a limited number of vessels per call. Find out the cap, and never show a count as a total if a call can be truncated.
- **The docs contain a sample key that belongs to the provider. Never use it, never copy it into code, config, tests or logs.** Only the user's own key from `.env` is ever used.
- If the key goes in the URL, httpx and other libraries can log it. Apply the same protections as the EIA key (disable URL logging, redact in log records) and add tests proving the key never appears in responses, logs, exceptions, the frontend source or the build.
- Read the provider's terms and report whether showing the data in a presentation is allowed and whether results may be stored or cached (this matters for snapshots, section 4.2).
- If an auth error mentions an IP address, report it to the user. Do not try to bypass it.

---

## 3. Additional non-negotiables

1. **Respect the quota, in code.** One backend poller talks to the provider; browsers never do. Many open tabs must not multiply provider calls.
   - Keep a persistent counter per service (on disk) and log every real provider call (service, time, status, never the key) to `logs/ais_calls.jsonl` so the user can compare with the console.
   - **Never exceed a metered quota.** Keep a reserve for demo preparation and final QA: at most 60% of each metered quota may be used during development. Going beyond requires the user's explicit approval.
   - Add a kill switch (`AIS_ENABLED=0`) and a status endpoint. When a quota is used up or the key has expired, degrade to saved data, then to simulated vessels, and say so on screen.
2. **Tests and development never spend real quota.** Record each provider response once into redacted fixtures (check the terms first) and replay them in tests and development. Tests use a mock transport. Only the documented M10 verification calls, snapshot captures and approved route-planning calls hit the real service.
3. **"LIVE" must be earned.** A layer may show `LIVE AIS` only if the last poll succeeded within two poll intervals **and** the median position age is under 10 minutes. Otherwise it shows `DELAYED` or `STALE` with the age. Every vessel shows "last seen N min ago". Saved data shows `SNAPSHOT <date time>`. Simulated data always carries `SIMULATED`. Live, snapshot and simulated vessels never appear together unlabelled.
4. **Real counts need caveats.** Counts from the provider are statistics only with a timestamp, the radius used, and the note "vessels seen by the provider within this circle; at most N returned per call; coverage gaps and AIS-off vessels are not included". Simulated counts are never shown as statistics.
5. **Nothing beyond 30 days is an estimate.** The only price estimate in the product is the 30-day oil outlook from the validated formula. Market cards show quotes, not forecasts. Add the visible note "Quotes for information only, not investment advice."
6. **World Monitor is a reference, not a source.** Take layout and interaction ideas only. Do not copy its code, assets, branding, data or text, and do not scrape it.
7. **Tankers carry crude and products; AIS does not say which.** Never label a vessel "crude carrier" on AIS evidence alone. Never label vessels "sanctioned" or "dark fleet" unless a cited data source says so.
8. **Existing rules for estimates stay.** Anything unverified gets `is_estimate: true` and a visible tag.

---

## 4. Feature specs

### 4.1 2D map view (World Monitor style)

**Toggle.** A `GLOBE | MAP` switch in the top bar. Both views share one state store (selected route, vessel or port, active layers, scenario, time range) so switching keeps the selection. The existing globe must keep working.

**Engine.** Use deck.gl with a Web Mercator `MapView` and **bundled Natural Earth country polygons** (public domain; cite in README). No external tile server, so there are no tile terms to worry about and the demo works offline. Dark style, subtle graticule, labels for seas, chokepoints and ports. Handle routes that cross the antimeridian without drawing a line across the whole map.

**Layers panel** (collapsible, grouped, each toggle shows a count and a status chip):
- Routes and pipelines (same styling as the globe: lane blue, pipeline amber, disrupted crimson)
- Chokepoints with pulsing rings scaled by `conflict_intensity`
- Tankers near watch points (live or snapshot)
- Ports
- Scenario overlay (disrupted route and affected zone)
- Route news markers

Defaults on: routes, chokepoints, tankers.

**Interactions.** Hover tooltip, click opens the same right-hand panel as the globe, fly-to, "Reset view".

**Shareable URL state** like the reference: `?view=map|globe&lat=&lon=&zoom=&layers=a,b,c&selected=<id>`. Validate every param and fall back gracefully on bad input.

**Patterns to take from the reference screenshots** (view them first): dark panel grid, a freshness chip on every data panel (for example `LIVE`, `Stale 5m`), a "?" help tooltip on each panel explaining source and limits, tabbed panels, small price cards with a sparkline and coloured change, source chips on news items, and layer toggles.

**Performance.** With all layers on and about 5,000 markers (use simulated markers for this test only), report fps in the same software-rendering setup as before and keep at least 25 fps. If it is lower, fix it before moving on.

### 4.2 AIS integration and vessel layers (ShipFinder, within the key's limits)

**Architecture.** Define an `AISProvider` interface. Implement only the methods the key allows; a method the key doesn't allow raises `NotSupported` and the UI hides that feature:
`vessels_nearby`, `vessel_search`, `vessel_flag`, `port_info`, `vessel_position`, `vessel_track`, `route_plan` (point-to-point and port-to-port).

Implementations: ShipFinder (default when a valid key exists), the simulated provider (fallback), a mock transport for tests, and the existing AISStream adapter (kept as optional, still marked unverified). Do not delete working tests unless they are replaced.

**Verification (first thing in M10).** Use an **unmetered** service for the first test (Port Information or Vessels Nearby). Report: host, authentication method, status, latency, response shape, the maximum radius and result cap, and any rate limit. Then test coverage at each chokepoint watch point: how many tankers returned, whether the result was truncated, and the distribution of "last seen" ages. Save results to `docs/ais_verification.md`. Show only status, never the key. If the key is invalid, expired or out of quota, say exactly what is wrong and carry on with the simulated path.

**Budget table (pause point).** Before building pollers or spending any metered call, show the user a table: each enabled service, its quota, what you will use it for, the planned number of calls (with a reserve), the polling interval for unmetered services, and the **list of route pairs you propose for route planning** (at most 8 per service, leaving 2 spare each). Wait for approval.

**Live tankers (no Vessels in Zone on this key).**
- Define curated **watch points**: chokepoint centres (Hormuz, Bab el-Mandeb, Suez, Malacca, Turkish Straits, Danish Straits, Cape of Good Hope approach) and major oil-port approaches, each with a radius within the provider's maximum.
- A central poller calls `vessels_nearby` for each watch point at a conservative interval (stay far inside the rate limit; report the interval and calls per hour), keeps tanker ship types, dedupes by MMSI and fans out over `WS /ws/vessels`.
- Oriented markers, coloured by speed or status. Click shows name, MMSI/IMO, flag (`vessel_flag`, unmetered), speed, course, destination, draught, last seen, and the line "cargo type not confirmed by AIS".
- **Port areas:** with the port-status services disabled, do not show "berthed", "anchored" or "expected arrivals". If the position records include an AIS navigational status, a port panel may show "AIS-reported status: at anchor / moored" counts for vessels near the port, labelled as AIS-reported (crew-set, often wrong), with the circle radius, truncation note and timestamp. If the field is missing, the port panel shows Port Information only.

**Vessel search and details.** A search box (name, MMSI, IMO) using `vessel_search` (unmetered) that flies to the result on either view. If getting a position needs the metered `vessel_position` (50 calls), do it only when the user selects a result, and show "provider calls left: N" in the panel.

**Past routes (10 track calls in total).** A "Load track" button on the vessel panel calls `vessel_track` on demand only. Show the remaining count next to the button (for example "7 of 10 left"). Cache each track, and never fetch automatically. Keep at least 3 calls in reserve for the demo snapshot. If no calls remain, show saved tracks or hide the button.

**Snapshots (demo safety, and the key expires 2026-11-13).**
- Persist the last successful poll for each watch point, the Port Information results, the route-planning results and any fetched tracks to disk with timestamps, if the terms allow storing.
- When the provider is unreachable, the quota is used up or the key has expired, show the saved data with a `SNAPSHOT <date time>` badge. Never present it as live.
- Add `tools/prewarm_ais.py` to refresh snapshots within the budget. Run it once in M10 and again in M15, **before the key expires**. Show "key expires in N days" in `/api/v1/health` and in the vessel panel.

**Scenario exposure.** When a scenario is active, show "tankers within R nm of this chokepoint: N (provider coverage, seen at HH:MM, at most M returned)" in the route panel and on the Results page. **Real vessels are never animated as if rerouted.** The reroute animation exists only for simulated vessels, labelled `SIMULATED`. With live or snapshot AIS active, simulated vessels are off by default.

**Route planning for voyage days (permanent value).** Use `route_plan` (the approved pairs only) to get real sea distances for each route's baseline voyage at the project's 14-knot speed. Store distance, provider and retrieval date in `routes.json`, set `is_estimate: false` for those that come from the provider, and store the results immediately in M10 so they remain after the key expires (if the terms allow). This changes numbers, so snapshot first, show a before/after table, update the golden tests and the README changelog, and regenerate the DEMO_SCRIPT arithmetic from the API.

### 4.3 Remove "Historical events" completely, add the Markets panel

**Remove completely** the chart titled "HISTORICAL EVENTS — SUPPLY LOSS VS CONFLICT INTENSITY" and everything dedicated to it: the React component, its styles, its data hook and fetch, the "24 events, 1973–2026" label, its tests, and every mention in the README, DEMO_SCRIPT and screenshot lists (see `ref_historical_events_to_remove.png`). Take before and after screenshots, and confirm nothing on the dashboard still shows historical events.

**What stays, and why.** `events.csv` and `GET /api/v1/conflicts` remain in the backend because Phase 1, the 30-day validation and the Results page's validated-range reference line depend on them, and existing endpoints must stay backward compatible. The frontend no longer shows them on the dashboard. If removing something would break a test or a feature, report it instead of guessing. The "Capacity at risk" and "News alert feed" panels stay.

**Markets panel** (in the freed space, laid out like `ref_worldmonitor_panels.png`): tabs **Indices | Commodities | FX**, cards with price, change, a 30-day sparkline, a freshness chip, an "as of" time and a "?" tooltip stating the source and its limits.
- Indices: Dow Jones, S&P 500, Nasdaq Composite, FTSE 100, DAX, Nikkei 225, Hang Seng, Nifty 50, Sensex, plus VIX if a source has it.
- Commodities: WTI, Brent (from the existing EIA adapter), natural gas, gold, silver, copper, and others a chosen source supports.
- FX: EUR/USD, USD/JPY, USD/CNY, USD/INR, and a dollar index if available.

**Data sources (pause point).** No free source is both real-time and unrestricted. Research current options and report their quotas, latency, history depth and terms. Candidates to check include the existing Alpha Vantage key, FRED, Stooq and the free tiers of Twelve Data and Finnhub. Do not scrape sites that forbid it, and do not use unofficial endpoints without telling the user what the terms say. **Show the user a comparison and wait for a choice** before wiring any source. Use a provider abstraction (like the price adapter) with statuses `DELAYED`, `DAILY_CLOSE` and `OFFLINE_FALLBACK` (a dated saved snapshot). Use `LIVE` only if the provider guarantees real-time data and its terms allow display. Cache to respect quotas and never request from the browser.

**Link to the simulation.** Only the **WTI card** shows a scenario number: after a simulation, a toggle adds the 30-day scenario estimate with the same validation badge as the Results page. No other card shows a scenario number.

### 4.4 30-day outlook (validated horizon only)

**Scope.** The price outlook covers 30 days and nothing else. There are no 1-week, 90-day or 1-year estimates anywhere (7-day and 365-day were never tested, and the 90-day formula error in Phase 1 was worse: 18.01 pp).

**Headline = the validated predictor.** The 30-day headline figure is exactly `supply_loss_pct / 0.15`. Check how the existing engine builds the trajectory: if its day-30 value includes a decay, a duration effect or anything else that the Phase 1 test did not use, then it is not the validated number. Make the headline the plain formula, label any shape within days 0–30 as "illustrative path", and report any discrepancy together with the updated tests and a README changelog entry.

**Uncertainty.** Show ±13.09 pp (from the actual `phase1_analysis.py` output on 21 events) only inside the validated supply-loss range (up to 8%), and keep the existing "outside the validated range" behaviour, the reference-event line and the Hormuz bypass sensitivity.

**Results page changes.**
- Limit the price chart to days 0–30. Remove days 31–180 from the chart, the KPI text and the summaries. Add a visible validation badge: `VALIDATED 30 DAYS (≤ 8% supply loss)` or `OUTSIDE VALIDATED RANGE`.
- Other sections (barrels displaced, EVs, lithium, importer shortfall, economy) stay as they are. Arithmetic over a longer `duration_days` is not a price estimate.
- Update the template summaries and the consistency test so every number in a summary still matches the payload.

**Validation record.** Re-run `phase1_analysis.py` unmodified from `backend/data/` and save the output in `docs/outlook_validation.md` (events used, formula MAE, model MAE, verdict), together with a plain statement of what is and is not validated.

---

## 5. API additions (all additive; names are suggestions)

| Method | Path | Purpose |
|---|---|---|
| WS | `/ws/vessels` | Extend with status, last-seen age and snapshot flag |
| GET | `/api/v1/watchpoints/{id}/vessels` | Tankers near a watch point (live or snapshot, with radius and truncation info) |
| GET | `/api/v1/ports`, `/ports/{id}` | Curated ports; Port Information; AIS-reported status counts if the field exists |
| GET | `/api/v1/vessels/search?q=` | Search by name, MMSI or IMO |
| GET | `/api/v1/vessels/{id}`, `/vessels/{id}/track` | Details; track (metered, guarded, cached) |
| GET | `/api/v1/ais/budget` | Per-service calls used and left, reserve, key expiry, provider status |
| GET | `/api/v1/markets/quotes?group=` | Cards for the Markets panel |
| GET | `/api/v1/markets/history?symbol=&range=` | Sparklines |

Update the README endpoint table and `/api/v1/health` so it lists every new feed with its status.

---

## 6. Out of scope for v2.0 (do not build)

- **Push services** (position push, arrival and departure push, any TCP/Kafka receiver).
- **Services disabled on this key:** Vessels in Zone, Berthed and Anchored Vessels in Port, Expected Arrivals, all port call record services, and Global Marine Weather, Tropical Cyclones, Port Tides, Navigational Warnings and STS Events. The user also decided that weather and cyclone features are not useful for this project. If the user later gets services enabled and wants them, they can be added as a separate stage.
- **Price estimates for 1 week, 90 days, 1 year** or any horizon beyond 30 days.
- **Cross-asset effects**: no regressions, sensitivities or scenario estimates for indices, commodities or FX. The Markets panel shows quotes only.
- Any new ML model, and any new macro coefficient without a verified primary source.

If something here looks necessary to make another feature work, stop and ask.

---

## 7. Milestones

| # | Milestone | Done when |
|---|---|---|
| M10 | AIS provider: verification, budget, first snapshot | Key verified with an unmetered call, `docs/ais_verification.md`, budget table and route-pair list approved, adapter, call counter and quota guard, fixtures recorded, approved route planning stored in `routes.json`, first snapshot captured, tests pass |
| M11 | 2D map view | Toggle works, all existing layers on both views, URL state, selection preserved, 5,000 markers at 25+ fps |
| M12 | Vessel layers | Tankers near watch points (live, snapshot and simulated modes), vessel search and details, on-demand track with remaining-calls counter, ports, scenario exposure, on both views |
| M13 | Markets panel | Historical chart removed completely, data source chosen with the user, cards for indices, commodities and FX with honest chips, WTI scenario toggle |
| M14 | 30-day outlook | Headline is the validated formula, chart and summaries limited to 30 days, validation badge, `docs/outlook_validation.md`, tests updated |
| M15 | Docs, QA, v2.0 | README, DEMO_SCRIPT, LIMITATIONS updated, final snapshot captured before key expiry, honesty pass, claims audit, security check, final end-to-end run, tag `v2.0` |

After each milestone: run the tests, take real browser screenshots into `docs/m<N>_screenshots/` (0 console errors), commit, and give a 3–5 line plain-language summary. Continue automatically unless blocked or at a **pause point** (M10 budget table and route pairs, M13 data-source choice). Ask one specific question when blocked.

---

## 8. Final deliverables

1. Working app on both views, with a documented Windows start command for each server.
2. Updated `README.md`: architecture, env vars, endpoint table, data sources with terms notes, the 30-day methodology, the AIS key's permissions and quotas, how snapshots work, changelog of changed values (voyage days, any headline change), limitations.
3. Updated `DEMO_SCRIPT.md` (5–7 minutes): globe-to-map toggle, tankers near Hormuz (live or snapshot, as the badge says), a vessel search and one loaded track, the Markets panel, then a 20-day Suez detour with the 30-day outlook, its error band and validation badge. Generate the numbers from the API, not from memory. Add a demo-day fallback plan (key expired, quota used up, provider down, network down) and questions the professor may ask, with honest answers.
4. Updated `LIMITATIONS_AND_FUTURE_WORK.md`: AIS coverage gaps and AIS-off vessels, services not available on the key, per-call vessel caps, tiny quotas and the key expiry, market data delay, the price outlook validated at 30 days only, small event sample, push services and cross-asset effects deliberately out of scope, NewsAPI plan terms, and what remains unverified.
5. Honesty pass: grep the UI and docs for `LIVE`, `real-time`, `predict` and `forecast`; every use must be accurate. Re-run the claims audit (`backend/tools/check_claims.py`) against the new numbers.
6. Security: confirm no key appears in git history, `.env` is ignored, `.env.example` lists the new variables with no values, and fixtures contain no key.
7. Final QA: full test suite on a clean export, production build, one complete end-to-end run following DEMO_SCRIPT.md with screenshots (including the run with the provider disabled), then tag `v2.0`.

---

## 9. Definition of done

- Every number on screen is traceable to a source, a formula or a labelled assumption.
- No data is mislabelled (live vs delayed vs snapshot vs simulated), and counts from the provider carry their caveats.
- No price estimate appears beyond the validated 30-day horizon, and the historical events chart is gone from the dashboard.
- The app starts and is usable with no API keys, with an expired key or with the provider down, falling back to saved or simulated data with clear labels.
- No metered quota was exceeded, the reserve was kept, and the key never leaves the server.
- All tests pass, and the final run-through was actually executed, not described.

**Begin with Milestone 10: audit v1.0, then verify the ShipFinder key with one unmetered call and report what the provider returns.**
