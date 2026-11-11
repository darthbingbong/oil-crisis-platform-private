# Maritime Oil Crisis & EV/Lithium Transition Platform

A terminal-style web app for exploring what a maritime oil disruption would do. Pick a route (a chokepoint such as Suez or Hormuz, or a pipeline) on a 3D globe, blockade it or force a detour, and see the **price impact**, the **barrels displaced**, the **electric vehicles** that would be needed to offset them, the **extra lithium** that implies, and indicative **economy and market effects**. Every number is traceable to a source, a formula or a labelled assumption.

**Version 2.0.** `v1.0` and `v2.0` are tagged; `v2.0` was tagged after the final AIS snapshot taken on 2026-11-11 (08:32 UTC), before the provider key expires on 2026-11-13. It is a student project for presenting to a professor: *credibility beats flash*. Nothing is labelled live that is not, simulated things are labelled simulated, and the places where the evidence is thin are written down (see [What is verified and what is not](#what-is-verified-and-what-is-not) and `LIMITATIONS_AND_FUTURE_WORK.md`).

- Walkthrough for presenting: **`DEMO_SCRIPT.md`** (7 minutes, with the arithmetic and a demo-day fallback plan).
- Known limits: **`LIMITATIONS_AND_FUTURE_WORK.md`**.
- Build instructions it was written to: `MASTER_PROMPT.md`. Phase 1 modelling decisions: `backend/PHASE1_SUMMARY.md`.

**Live site:** <https://oil-crisis-platform-final.pages.dev> (frontend on Cloudflare Pages, API on Render: <https://oil-crisis-api.onrender.com>). Deploy settings: [`DEPLOY.md`](DEPLOY.md). The first visit after a quiet period can take up to a minute while the free API host wakes up.

## Run it yourself

You need Python 3.13 and Node 22. No API key is needed: with none, the app runs on the data in the repository and says so on screen (see [With no API keys at all](#with-no-api-keys-at-all)).

```powershell
git clone https://github.com/darthbingbong/oil-crisis-platform-final
cd oil-crisis-platform-final\backend
python -m venv venv ; .\venv\Scripts\Activate.ps1 ; pip install -r requirements.txt
python -m uvicorn main:app --port 8000
# second terminal
cd ..\frontend ; npm install ; npm run dev      # open http://localhost:5173
```

This public copy has no real vessel positions (only simulated vessels, labelled SIMULATED) and uses the earlier estimated voyage distances; why is in [Hosted mode](#hosted-mode-m16) and `docs/DECISIONS.md`. Optional keys (EIA for the live price, Anthropic for Claude classification) go in `backend/.env`, copied from `backend/.env.example`, which has no values.

## Disclaimer

**Educational project. Figures are model estimates, not forecasts or financial advice.** Nothing here is investment, trading or policy advice. Every number is either sourced (with the source shown) or labelled as an assumption or estimate; the only validated claim is the 30-day price move for supply losses up to 8% (see [What is verified and what is not](#what-is-verified-and-what-is-not)). Market tables are third-party widgets; headlines are links to their publishers. The code is under the MIT licence (`LICENSE`); the data files keep the licences and terms of their sources (see [Data sources](#data-sources)).

## Contents
1. [Quick start (Windows)](#quick-start-windows) · 2. [Architecture](#architecture) · 3. [Environment variables](#environment-variables) · 4. [API endpoints](#api-endpoints) · 5. [Data sources](#data-sources) · 6. [Methodology](#methodology) · 7. [The calculation chain](#the-calculation-chain) · 8. [Every assumption](#every-assumption) · 9. [What is verified and what is not](#what-is-verified-and-what-is-not) · 10. [Changelog / corrected values](#changelog--corrected-values) · 11. [Feature notes](#feature-notes) · 12. [Limitations](#limitations) · 13. [Tests](#tests) · 14. [Repo hygiene and secrets](#repo-hygiene-and-secrets)

## Quick start (Windows)

Tested with Python 3.13 and Node 22 on Windows 11, using PowerShell. You need two terminals.

**Terminal 1: the backend (one-time setup, then run)**

```powershell
cd C:\oil-crisis-platform\backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn main:app --port 8000
```

**Terminal 2: the frontend**

```powershell
cd C:\oil-crisis-platform\frontend
npm install
npm run dev
```

Open <http://localhost:5173>. The frontend proxies `/api` and `/ws` to the backend on port 8000.

### With no API keys at all

Do exactly the above. The app runs fully on local data and says so on screen:

| Feature | With no key |
|---|---|
| Price ticker | `OFFLINE_FALLBACK`: the last row of `backend/data/oil_daily_prices.csv` (**2026-08-18**, stale, with its age shown) |
| Vessels | `SIMULATED VESSELS` badge; the "AIS feed" toggle explains that no key is configured |
| Route news | Works without a key (GDELT is free). Slow and sometimes refused: see "Before a demo" below |
| Older news pipeline | Rule-based classifier and fixtures only |
| Everything else (simulation, Results page, routes, lithium, economy) | Fully working |

### With API keys

```powershell
cd C:\oil-crisis-platform\backend
copy .env.example .env
notepad .env          # add EIA_API_KEY=..., optionally AISSTREAM_API_KEY=...
```

Restart the backend (keys are read at startup; `Ctrl+C`, then run the `uvicorn` line again). Check what is live and what is fallback at <http://127.0.0.1:8000/api/v1/health>. Keys stay on the server and never reach the browser.

### Before a demo, and other commands

```powershell
# fill the route-news cache and refresh the demo snapshot (5 to 15 minutes; do not run while the backend is also warming up)
cd C:\oil-crisis-platform\backend ; python tools\prewarm_news.py --snapshot

# run the backend tests. Always use the backend virtual environment: the system Python has no
# `anthropic` package, so a bare `python -m pytest` fails at test_news.py with ModuleNotFoundError.
cd C:\oil-crisis-platform\backend ; .\venv\Scripts\python.exe -m pytest

# type-check, lint and build the frontend (from frontend\)
npx tsc -b ; npx oxlint ; npm run build

# serve the production build (proxies /api and /ws to :8000 like the dev server)
npm run preview        # http://localhost:4173
```

The browser checks in `frontend/e2e/` drive a real Chromium and save screenshots; see `frontend/e2e/README.md`. The `window.__globe` / `window.__vessels` test bridges exist only in dev builds.

The 31 MB source workbook `backend/data/globalEnergyOwnership.xlsx` is **not in git**. It is the Global Energy Monitor *Global Energy Ownership Tracker, March 2026 release* (CC BY 4.0). Download it from <https://globalenergymonitor.org/projects/global-energy-ownership-tracker/> and place it at `backend/data/globalEnergyOwnership.xlsx` **only if you want to re-derive the pipeline capacities**; the committed `routes.json` already holds the extracted values and the app does not read the workbook at runtime.

## Architecture

```
 Browser  (React 19, Vite, TypeScript, Tailwind 4, three.js globe via react-three-fiber, deck.gl 2D map, Recharts)
   |  HTTP /api/v1/*                      WebSocket /ws/vessels
   v  (Vite dev server / preview proxies both to :8000)
 FastAPI backend (uvicorn, :8000)
   routers/    routes . report . price . vessels . health      (main.py: /simulate, /conflicts, /refineries, news stream)
   services/   calc_engine (pure functions) . config (every constant, with its source) . report . route_data
               price_feed . news_feed . ais_feed (AISStream, unverified) . shipfinder (the provider client: quota guard, breaker, call log)
               ais_watchlist (saved real tankers, tracks, samples) . route_planning . cache . news_classifier
   data/       routes.json . importers.json . lithium_usgs.json . events.csv . oil_daily_prices.csv . refineries.csv ...
   news/       the older pipeline: NewsAPI -> classifier -> a SIMULATED price and alert deltas (SQLite; the price is no longer shown)
   |
   +-- EIA API v2 (key)            price ticker .............. fallback: local CSV, labelled OFFLINE_FALLBACK
   +-- GDELT DOC 2.0 (no key)      route headlines ........... fallback: disk cache -> labelled DEMO SNAPSHOT
   +-- ShipFinder AIS (key, to 2026-11-13)  12 saved real tankers, tracks, search .... fallback: the saved snapshot, then SIMULATED vessels
   +-- AISStream.io (key)          tanker positions (never run live) ... fallback: SIMULATED vessels (drawn in the browser)
   +-- TradingView widget          Markets panel: loaded by the BROWSER from TradingView, no key, no server call ... fallback: "Widget unavailable"
   +-- NewsAPI, Anthropic (keys)   older classification pipeline, optional
```

Design rules (from `MASTER_PROMPT.md`): the price formula stays `%dP = %dS / |Ed|`; the calculation engine is pure (`services/calc_engine.py` takes a `CalcConfig`); every external feed has a timeout, retry with backoff, a cache and a labelled fallback; keys live only in `backend/.env`.

## Environment variables

All optional. Set them in `backend/.env` (copy `backend/.env.example`). Never put a real value in `.env.example`.

| Variable | Default | What it does |
|---|---|---|
| `EIA_API_KEY` | none | EIA Open Data key for the WTI/Brent ticker. Without it: `OFFLINE_FALLBACK` |
| `AIS_API_KEY` | none | ShipFinder Open Platform key (server-side only; never printed, logged or sent to the browser). Without it, or after it expires on 2026-11-13, the app shows the saved snapshot and makes no call |
| `AIS_ENABLED` | `1` | `0` is the kill switch: no provider call is ever made |
| `AIS_TODAY` | unset | **Testing only**: `YYYY-MM-DD` fakes today's date so the expired-key behaviour can be checked (for example `2026-11-13`) |
| `HOSTED_MODE` | unset (local) | `1` = public deployment (see [Hosted mode](#hosted-mode-m16)): visitors are served from caches filled by one scheduled refresh, rate limits and friendly errors are on, developer endpoints are closed, CORS allows only `FRONTEND_ORIGIN` |
| `HOSTED_ENABLE_<SOURCE>` | the safe side | One flag per source, read only in hosted mode. `EIA`, `GDELT`, `TRADINGVIEW`, `GEM`, `ANTHROPIC`, `SHIPFINDER_SNAPSHOT` (show the saved 2026-11-11 tankers, read-only) and `SHIPFINDER_DISTANCES` (route-planned voyage days) default **on**; `SHIPFINDER` (live calls), `AISSTREAM`, `NEWSAPI`, `ALPHAVANTAGE` default **off** |
| `FRONTEND_ORIGIN` | none | The one web address allowed to call the API from a browser in hosted mode |
| `PUBLIC_REPO_URL` | the project repository | The footer's repository link |
| `REFRESH_INTERVAL_HOURS` | `24` | Hours between scheduled refreshes in hosted mode |
| `CLAUDE_DAILY_CALL_CAP` | `50` | Most Claude classification calls per UTC day; after it the rule-based classifier answers |
| `CLAUDE_MONTHLY_USD_CAP` | `5.00` | Most dollars per UTC month, counted from the token usage the API reports |
| `CLAUDE_INPUT_USD_PER_MTOK`, `CLAUDE_OUTPUT_USD_PER_MTOK` | `5`, `25` | **Assumed** prices per million tokens for that count (the highest of the model family, so the cap stops early) |
| `CLAUDE_CLASSIFIER_MODEL` | the model named in `news/classifier_claude.py` | Which Claude model classifies headlines |
| `AISSTREAM_API_KEY` | none | AISStream.io key for the tanker feed. Without it: simulated vessels. Adapter is **unverified against the live feed** |
| `ANTHROPIC_API_KEY` | none | Lets the older news pipeline classify headlines with Claude; otherwise a rule-based classifier |
| `NEWSAPI_API_KEY` | none | NewsAPI key for the older pipeline's polling (the free plan is dev/test only, see Limitations) |
| `NEWS_POLL_INTERVAL_SECONDS` | `1200` | NewsAPI poll interval (20 min = 72 calls/day, under the 100/day free cap) |
| `NEWS_WARMUP` | `1` | Fill the route-news cache at startup. `0`, `false`, `off`, `no` turn it off. Tests set it to `0` |
| `NEWS_WARMUP_GAP` | `6.0` | Seconds between warm-up fetches |
| `NEWS_MIN_REQUEST_INTERVAL` | `6.0` | Minimum seconds between any two GDELT requests |
| `NEWS_GDELT_URL` | GDELT's endpoint | Only for testing against a stand-in |
| `EIA_BASE_URL` + `PRICE_DEV_ALLOW_CUSTOM_EIA_URL=1` | unset | **Dev only**: point the price feed at the mock EIA server. Both must be set, otherwise `EIA_BASE_URL` is ignored |

`ALPHA_VANTAGE_API_KEY` appears in an old `.env` and a comment in `main.py`, but nothing reads it; it can be deleted.

## API endpoints

| Method | Path | Status | Notes |
|---|---|---|---|
| POST | `/api/v1/simulate` | unchanged shape; **values corrected** | Phase 1 elasticity formula. Lithium and supply values were corrected and the sourced per-EV lithium case is now used (see the changelog) |
| GET | `/api/v1/conflicts` | **default changed in M8** | Returns the **24 real historical events**. `?include_simulated=true` adds the news-derived rows tagged `[SIMULATED, ...]` (the old behaviour; they drowned the history chart) |
| GET | `/api/v1/refineries`, `/api/v1/refineries/at-risk/{chokepoint}` | unchanged | |
| GET | `/api/v1/routes` | new | All 14 routes with illustrative geometry and summary stats |
| GET | `/api/v1/routes/{id}` | **superset of the old endpoint** | Old bypass keys (`chokepoint`, `capacity_at_risk_bpd`, `affected_hubs`, `bypass_options`, `fast_bypass_capacity_bpd`, `uncovered_capacity_bpd`, `explanation`) keep the same key, value and type; route stats are added alongside. Accepts old spellings (`hormuz`, `Hormuz`, `bab%20el-mandeb`) and new ids (`bab_el_mandeb`) |
| GET | `/api/v1/routes/{id}/bypass` | new | The original bypass payload only |
| POST | `/api/v1/simulate/report` | new | Full scenario report for the Results page: KPIs, six sections each with chart data, a templated 2-4 sentence summary, a one-line takeaway and cited assumptions. Rejects (422, plain message) pipelines, routes with no sourced figure and the Cape alternate lane |
| GET | `/api/v1/routes/{id}/news` | new | Tagged headlines (title, source, date, link only) from GDELT; cached 20 min; `stale` / `refreshing` / `snapshot` states |
| GET | `/api/v1/price/live` | new | Latest WTI and Brent (USD per barrel), change, `as_of`, `age_days`, `status` = `DAILY_CLOSE` (EIA answered) or `OFFLINE_FALLBACK` (last CSV row). Never `LIVE` |
| GET | `/api/v1/price/history?days=30` | new | Merged CSV + EIA daily series for the sparkline: no duplicate dates, blank holiday rows skipped |
| WS | `/ws/vessels` | new | Tanker updates from the AIS provider (server-side key). First frame is a status frame; **UNVERIFIED against the live feed**. With no key it sends the status and closes |
| GET | `/api/v1/vessels/status` | new | The AIS feed status as JSON |
| GET | `/api/v1/health` | new | State of each external feed (`price`, `news`, `ais`) as `ok` / `degraded` / `fallback` / `unknown`, with a plain sentence each, and an `overall` |
| GET | `/api/v1/vessels/watchlist` | new (M11) | The saved real-tanker snapshot with the AIS key's state (`key`, `key_expired`, `key_line`). Never calls the provider |
| GET | `/api/v1/ais/budget` | new (M12) | Calls used and left per ShipFinder service, counted from our own `logs/ais_calls.jsonl`, with holds, breakers and the key's expiry |
| GET | `/api/v1/ais/search?q=` | new (M12) | Searches the **saved** watchlist only (name, MMSI, IMO) |
| POST | `/api/v1/ais/search/provider` | new (M12) | ONE ShipFinder Vessel Search, only from an explicit button press; status 31 is `NO_MATCH`; limits and breaker respected; from 2026-11-13 it makes no call (`KEY_EXPIRED`) |
| GET | `/api/v1/vessels/{mmsi}/track` | new (M12) | The saved past track (`past track, fetched at <time>`) or `no saved track`; the headline is the one that travelled furthest |
| GET | `/api/v1/vessels/{mmsi}/near` | new (M12) | The saved Vessels Nearby sample that contains the vessel, with its seed and time. Never a live Nearby call |
| GET | `/api/v1/hosted` | new (M16) | Facts about the deployment for the footer and the vessel layer: hosted or local, which sources are on, their attributions, the disclaimer, the privacy note, the repository link. Never a key |
| GET | `/api/v1/ping` | new (M17) | Keep-warm and health-check target: `{"ok": true}`. Calls nothing external, reads no file, returns no key |
| GET | `/api/v1/news/headlines` | new (M17) | The public site's news feed: the newest cached GDELT route headlines (publisher, time, keyword tag, route) with when each cache was fetched. Reads the cache only; no price effect |
| POST | `/api/v1/dev/news-feed`, `/api/v1/news/test-inject` | DEV-ONLY | Simulate a feed failure or an empty feed; inject a test headline |
| GET | `/api/v1/news/stream`, `/api/v1/news/alerts`, `/api/v1/news/recent`, `/api/v1/news/price` (older pipeline) | unchanged | SSE alert stream, the alerts that moved the simulated price, the audit log of every classified article, the SIMULATED model-baseline price (never a quote) |
| POST | `/api/v1/news/poll-now` | DEV-ONLY | Runs one poll cycle of the older NewsAPI pipeline (NewsAPI key needed; outside the plan's terms for public use) |

**Route-collision decision: Option A.** `/api/v1/routes/{id}` returns a superset of what `/api/v1/routes/{chokepoint}` returned before. `backend/tests/test_routes_api.py` checks it against snapshots of the original responses (`backend/tests/snapshots/*_before.json`), key by key, for all four chokepoints and several URL spellings. Option B (`/route-data/{id}`) was not needed: no new field clashes with an old key.

## Data sources

Every data record in `routes.json` carries `source`, `source_url`, `data_year` and `is_estimate`. The distinct sources:

| Source | Used for | Year | URL |
|---|---|---|---|
| EIA, *World Oil Transit Chokepoints* (Table 1; last updated 2026-03-03) | Chokepoint flows (Hormuz, Malacca, Turkish and Danish straits: **2024**; Suez/SUMED, Bab el-Mandeb, Cape: **2023**, the last normal year before the Red Sea attacks), world oil supply 103.3 Mb/d, world maritime trade 79.7 Mb/d, importer group shares, Hormuz bypass capacity (4.7 Mb/d, with 2.6 Mb/d as a sensitivity) | 2023 / 2024 | <https://www.eia.gov/international/content/analysis/special_topics/World_Oil_Transit_Chokepoints> |
| EIA, *Today in Energy* (2025-06 Hormuz; 2023 Hormuz) and EIA press release 7 Apr 2026 | Route notes; the "current conditions" note (Hormuz effectively closed since early 2026) | 2023 to 2026 | linked from the route panel and Results header |
| EIA Open Data API v2, route `petroleum/pri/spt`, series `RWTC` (WTI) and `RBRTE` (Brent) | The price ticker (daily closes, published in a weekly release) | live | <https://www.eia.gov/opendata/> |
| EIA daily WTI/Brent, 1986 to 2026 (`oil_daily_prices.csv`) | Phase 1 analysis; the offline-fallback ticker row (last row **2026-08-18**) | 1986-2026 | <https://www.eia.gov/dnav/pet/pet_pri_spt_s1_d.htm> |
| Energy Institute *Statistical Review of World Energy 2026* via Our World in Data (`crude-oil-prices.csv`, annual 1861-2025, downloaded 2026-08-24) | Phase 1: price changes for the three pre-1986 events | 2025 | <https://ourworldindata.org/grapher/crude-oil-prices> |
| Global Energy Monitor, *Global Energy Ownership Tracker* (Mar 2026; Oil Infrastructure Tracker, Mar 2025), CC BY 4.0 | Pipeline nameplate capacities (East-West, Habshan-Fujairah, SUMED, BTC, CPC, TAPS); Druzhba deliberately not extracted | 2025 | <https://globalenergymonitor.org/projects/global-oil-infrastructure-tracker/> |
| USGS, *Mineral Commodity Summaries 2026: Lithium* (Feb 2026) | World lithium mine production (290,000 t Li in 2025, estimate) and reserves (37 Mt), consumption (263,000 t), the lithium-availability anchor | 2024-2025 | <https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-lithium.pdf> |
| ICCT, *EV supply chain* report (Feb 2024) | 0.10 kg lithium per kWh for NMC-811 cathodes | 2024 | <https://theicct.org/wp-content/uploads/2024/02/ID-85-%E2%80%93-EV-supply-chain-Report-Letter-70112-v3.pdf> |
| IEA, *Global EV Outlook 2026* | EV sales above 20 million and about 22 million produced in 2025; average battery sizes (China below 60 kWh, EU close to 70, US 90) | 2025 | <https://www.iea.org/reports/global-ev-outlook-2026> |
| IMF Managing Director K. Georgieva, speech of 9 Mar 2026; IMF Working Paper 17/196 | The only two macro coefficients with a verified primary source: +0.4 pp global inflation and -0.1 to -0.2% global output per +10% oil, if it lasts most of a year | 2026, 2017 | <https://www.imf.org/en/news/articles/2026/03/09/sp030926-coping-and-thriving-in-a-fluid-world> and <https://www.imf.org/en/publications/wp/issues/2017/09/05/oil-prices-and-inflation-dynamics-evidence-from-advanced-and-developing-economies-45180> |
| ShipFinder Open Platform (Starter plan key `AIS-vessel-tracker`, valid to 2026-11-13) | Planned sea distances for the voyage days (M10, stored in `routes.json`); the 12 saved real tankers, their positions, three saved 7-day tracks and two Vessels Nearby samples (M12), shown on the public site as a **read-only SNAPSHOT dated 2026-11-11** from `backend/data/ais_display/` (only the fields the interface shows). **ShipFinder allowed public display for a non-commercial project that does not sell the data** (DECISIONS D38); raw responses are kept out of git and no ShipFinder call is made by the hosted site. Chokepoint traffic is simulated | 2026-11 | <https://docs.shipfinder.com> |
| Natural Earth 1:50m admin-0 countries (public domain) | The 2D map's country outlines (bundled, simplified at three zoom levels; no tile server) | 2026 | <https://www.naturalearthdata.com/> |
| GDELT Project, DOC 2.0 API | Route headlines (headline, source, date, link only). Attribution link shown in the panel | live | <https://www.gdeltproject.org/> |
| AISStream.io | Tanker positions (live mode, unverified) | live | <https://aisstream.io/documentation> |
| TradingView free **Market Overview** widget (an iframe loaded from TradingView in the visitor's browser) | The Markets panel: indices, natural gas, gold, silver, copper, FX. We never receive these prices (no key, no server call). TradingView states stock data is delayed and forex is real time; the chip says "Via TradingView widget, delay set by TradingView" and no time is shown. Attribution stays visible. TradingView's pages do not say whether commercial use is allowed (DECISIONS D26) | live (their delay) | <https://www.tradingview.com/widget-docs/> |
| `events.csv` (24 events, 1973-2026), `refineries.csv`, `bypass_routes.csv`, `oil_production_statistics.csv`, `electric-car-sales-share.csv` | Phase 1 model inputs and the refinery/bypass layer. The events were hand-compiled from news and agency sources; several `supply_loss_pct` and `conflict_intensity` values are **informed estimates**; refinery capacities and bypass capacities are marked "Estimate" in their notes | 1973-2026 | OWID/IEA files carry their citation in `*.metadata.json` |

Route geometry (the lines on the globe) is **illustrative**, hand-placed for drawing, not surveyed shipping-lane or pipeline coordinates.

## Methodology

**Phase 1: can a trained model beat the textbook formula?** The price predictor is the elasticity formula `%dP = %dS / |Ed|` with `Ed = -0.15`. A trained model was tested against it using leave-one-out cross-validation, because there are very few labelled events: `events.csv` has **24** events, of which **21** have daily-resolution prices (the three pre-1986 events are annual averages and were excluded). The score is the mean absolute error of the 30-day price move, in percentage points:

| Approach | MAE (pp) |
|---|---|
| **Formula alone** | **13.09** |
| Ridge, unscaled features | 24.41 |
| Ridge, scaled and tuned | 13.77 |
| Formula + learned per-feature correction | **13.80** |
| Formula + a single constant correction | 13.62 |
| 90-day horizon: formula / model | 18.01 / 18.15 |

**Why the formula was kept.** Nothing beat it, and with 21 events and four features there is not enough signal to justify replacing theory with a fitted model. It is also transparent: a professor can check `5% supply loss / 0.15 = 33.3%` by hand. The one thing that did survive: when a model could learn anything, `demand_change_pct` was the strongest feature (demand-driven events such as 2008 and COVID behave differently), so the app warns when `demand_change_pct` is far from zero. The trained model is kept in `price_surge_experimental.joblib`, inactive. The ±13.09 pp band drawn on the price chart is exactly that leave-one-out error. (The first row and the fourth row's headline, 13.09 and 13.80, were reproduced by re-running `phase1_analysis.py` on 29 Oct 2026; the other rows are quoted from `backend/PHASE1_SUMMARY.md`, written in the Phase 1 session, and were not re-run.) Details: `backend/PHASE1_SUMMARY.md`, reproduced by `backend/phase1_analysis.py`.

**Where the formula is and is not validated.** It was measured on events up to **8% supply loss** (the largest was the 2026 Iran war, itself a soft estimate). Beyond that, the app still shows the formula's number, but marks it as an extrapolation: a dashed line on a shaded zone, the ±13.09 pp band hidden ("not validated at this magnitude"), and the 2026 event shown as a reference. A full Hormuz blockade is a 15.5% supply loss and the linear formula implies about +103%; the app says that is outside the validated range and does not cap or bend it, by decision.

## The calculation chain

All of it is in `backend/services/calc_engine.py` as pure functions, driven by `backend/services/config.py` (every constant with its source or an `ASSUMPTION` flag). `/simulate` and `/simulate/report` share them. Worked example, a **20-day detour of Suez** for 60 days (these figures are produced by the API and re-checked by `backend/tools/check_claims.py`):

| # | Step | Formula | Suez 20-day detour |
|---|---|---|---|
| 1 | Route flow (EIA, 2023 baseline) | from `routes.json` | 8,800,000 bpd (8.8 Mb/d) |
| 2 | Voyage length T | planned sea distance Ras Tanura to Rotterdam (ShipFinder route planning, 6,540.2 nm, retrieved 2026-11-02) / 14 knots | 19.5 days |
| 3 | Delivery factor with a fixed tanker fleet | `T / (T + detour)` | 19.5 / 39.5 = 0.4937 |
| 4 | Barrels displaced per day | `flow x (1 - delivery factor)` (blockade: `max(0, flow x blocked share - bypass)`) | 4,455,696 bpd |
| 5 | Supply loss | `displaced / 103.3 Mb/d` | 4.313% of world supply |
| 6 | Price impact (the validated formula) | `supply loss / 0.15` | **+28.8%** (±13.09 pp) |
| 7 | The 30-day outlook (M14: one value) | the step-6 value at day 30, drawn as one marker with its error bar; no path, no decay, and the length of the disruption does not change it | 1 point, day 30 = +28.8% |
| 8 | EVs needed to offset the lost fuel | `displaced x 19.5 gal gasoline/bbl x 365 / 500 gal per vehicle-year x EV share` | 63,426,835 EVs |
| 9 | Lithium per EV (sourced case) | `0.10 kg Li/kWh x 60 kWh x 5.323 (LCE per Li) / 1000` | 0.0319 t LCE (the project's own 0.008 is shown for comparison) |
| 10 | Lithium required | `EVs x t LCE per EV` | 2,025,726 t LCE (2.03 to 3.04 Mt across 60/70/90 kWh packs) |
| 11 | Supply cap and deficit | cap = `availability x 1,543,670 t LCE (2025 world production) x years`; deficit = `max(0, required - cap)` | 10% x 1,543,670 x 5 = 771,835 t; deficit **1,253,891 t** |
| 12 | Importer shortfall | displaced x each group's share of route flow (EIA group shares only) | not available for Suez (EIA gives no breakdown) |
| 13 | Economy (indicative) | IMF coefficients x price move per 10% x min(duration, 365)/365 | +0.19 pp inflation, -0.09 to -0.05% output |
| 14 | Tanker tonne-miles (derived) | `detour / T` | +102.6% |
| 15 | One-time transit gap | `flow x detour days` | 176,000,000 barrels |

## Every assumption

Everything below is either borrowed, chosen, or estimated, and is flagged in the app ("estimate / assumption" tags, "Assumptions and sources" blocks). Nothing here is hidden in the code.

1. **Elasticity Ed = -0.15** is a borrowed textbook short-run value, not estimated from this project's data.
2. **The ±13.09 pp band** is the leave-one-out MAE of 21 events and is applied as a constant width; it is not a statistical confidence interval.
3. **The formula is linear** and validated only up to 8% supply loss (see Methodology).
4. **There is no price path.** Since M14 the app shows one price horizon, 30 days, as a single value with its error bar (the earlier hold-then-decay path over 180 days, and a straight line that briefly replaced it, were removed because nothing validated them; DECISIONS D33, D34).
5. **Tanker fleet is fixed** for a detour (worst case): delivery scales by `T/(T+detour)`. `fleet=0` on the Results page lets the fleet expand (zero displaced).
6. **Voyage days** are a planned sea distance from ShipFinder route planning (5 Port-to-Port calls, retrieved 2026-11-02, 2 Point-to-Point cross-checks within 0.6%) divided by 14 knots. The distance is sourced; the 14-knot speed is the project's assumption. The default Suez detour (14 days) is the Cape plan minus the Suez plan, 11,239.4 and 6,540.2 nm. The globe lines are still illustrative.
7. **Baseline flows** are the last normal year (2023 for Suez, Bab el-Mandeb and the Cape, 2024 elsewhere). Real conditions in 2026 differ (Hormuz effectively closed); results are a what-if from a normal baseline.
8. **Hormuz bypass capacity** changed between EIA estimates (4.7, 3.5, 2.6 Mb/d); the headline uses 4.7 and the Results page shows 2.6 as a labelled sensitivity.
9. **Importer shares** are group-level (EIA publishes nothing finer for most routes) and some are derived by subtraction; reserve cover days are not available.
10. **Pipelines carry nameplate capacity, never flow**, and cannot be simulated. Druzhba is n/a. CPC capacity is an estimate.
11. **EV substitution**: 19.5 gal of gasoline per barrel, **500 gal per vehicle-year (a US-style figure; the global average is lower, so the true EV count would be higher)**, and a default of 100% of the lost demand replaced by EVs.
12. **Lithium per EV**: 0.10 kg Li/kWh is for NMC-811 only (LFP, which dominates in China, is not covered); the **60 kWh pack is a choice** (IEA gives regional averages, no global one); 5.323 is stoichiometry. The project's original 0.008 t LCE per EV is unsourced and about 4 times lower than the published figure, kept for comparison only.
13. **Lithium availability (default 10%)** is a scenario input, anchored on USGS showing 2025 production (290,000 t Li) above consumption (263,000 t Li) by 27,000 t, about 9% of production. It is not a forecast of what could be redirected.
14. **Macro effects**: only two coefficients have a verified primary source (IMF); they assume the oil price rise lasts most of a year and are scaled linearly to the price move and to `min(duration, 365)/365`, which is an assumption. Sector effects (airlines, equities, tanker rates) are qualitative with no coefficient, except the derived tonne-mile figure.
15. **`conflict_intensity`** is hand-scored for the 24 historical events. It is an input to the scenario but does not change the price formula.
16. **Model baseline price** (header): a hand-set seed of $82.50, nudged by up to 2% per classified news headline and drifting back to the seed. It is a simulation, not a market price.
17. **Simulated vessels** are invented for illustration (14 knots, time compressed 6 simulated hours per second, counts per lane cosmetic) and are never used in any result or statistic.
18. **Route geometry** is illustrative.

## What is verified and what is not

| Item | Status |
|---|---|
| Elasticity formula, Phase 1 comparison (24 events, 21 used, MAE 13.09 vs 13.80) | Reproduced by re-running `phase1_analysis.py` (29 Oct 2026). The other experiment rows are quoted from `PHASE1_SUMMARY.md`, not re-run |
| Calculation chain, worked numbers, report summaries | Unit and consistency tests (every number in a summary matches the payload); worked example re-checked against the running API |
| EIA price path (`DAILY_CLOSE`) | **Verified against the real EIA API** on 29 Oct 2026 with a real key (WTI 103.37, Brent 123.10 as of 2026-10-27; 1.7 to 2.1 s). The failure paths (rejected key, timeout, server error, rate limit) were exercised against a mock server and mocked transports, not by breaking the real service |
| GDELT route news | Verified against the live service (slow, often rate-limited); quality filters tested on real headlines; fallbacks proven by simulated failures |
| **Live AIS feed** | **UNVERIFIED.** No AISStream key was available. Built from the provider's documentation and tested against a mock transport only. Every status says so |
| AISStream terms of service | **Not confirmed**: the provider's terms page could not be found. Check before any public deployment |
| USGS lithium cells (Argentina and Chile 2024 production, Australia reserves) | Read from a PDF whose text extraction glued a footnote digit on; the stored values were corrected by hand and cross-checked by sums. See `LIMITATIONS_AND_FUTURE_WORK.md` for the exact values to compare with the PDF |
| Keyboard use of vessels | Routes are reachable by keyboard (Tab to the hidden route list); individual simulated vessels are not |
| Real-GPU frame rate | **Not measured.** All fps figures are from software rendering (a lower bound) |

## Changelog / corrected values

### Changed in M11 to M15 (what you can see)

- **M11, 2D map** beside the globe, with shared URL state (see the feature note above).
- **M12, real vessels:** twelve saved real tankers (two sample areas: Huelva and the Strait of Malacca) on both views with one shared vessel panel, search (saved watchlist while typing, the provider only on a button press), three saved past tracks (MUHUT SILVER is the headline), two saved "vessels near this vessel" samples, the AIS budget endpoint and the expired-key behaviour (DECISIONS D21 to D24). Real vessels are never counted as traffic, and chokepoint traffic stays `SIMULATED`.
- **M13, Markets panel** replaces the historical-events chart (removed from the dashboard): Indices, Commodities, FX; WTI and Brent are our own EIA cards with the WTI 30-day scenario toggle; the rest is TradingView's free widget with the chip "Via TradingView widget, delay set by TradingView" (DECISIONS D26).
- **M14, 30-day outlook:** one price horizon. The headline was and is `supply loss / 0.15`; the hold-then-decay path over 180 days was removed, then the straight line that replaced it, leaving a single day-30 value with its error bar. `half_life_days` is gone from the report API; `horizon_days`, `validation_badge` and `price_horizon_days` were added. The barrels series now ends with the disruption length entered. `docs/outlook_validation.md`, `docs/m14_before_after.md`, DECISIONS D33 and D34.
- **M15, polish:** map drag 6.5 to about 30 to 45 fps; nothing under 11 px; both lint warnings fixed (lint is clean); larger tap targets; a compact phone layout (taller map, compact ticker, folded snapshot note); documentation and tests brought up to the final state.

### Changed in M10 (numbers that moved)

- **Voyage days now come from real planned sea distances** (ShipFinder route planning, retrieved 2026-11-02) instead of great-circle sums over hand-placed waypoints. Suez and Bab el-Mandeb 21.2 to **19.5** days, Hormuz and Malacca 17.2 to **17.5**, Turkish Straits 5.1 to **5.0**, Danish Straits 4.2 (unchanged), the Cape voyage 33.9 to 33.5, and the **default Suez detour 12.7 to 14.0 days**. The old estimates stay in `routes.json` as `voyage_derivation.previous_hand_estimate`. Full table: `docs/m10_route_planning_before_after.md`.
- **The Suez 20-day example changed**: price impact +27.6% to **+28.8%**, barrels displaced 4,271,845 to 4,455,696 bpd, EVs 60.8 M to 63.4 M, extra lithium 1.94 to 2.03 Mt LCE, deficit 1.17 to 1.25 Mt. Only the voyage length T changed (21.2 to 19.5 days, so the delivery factor moved from 0.5146 to 0.4937); the formula, flows and factors did not. DEMO_SCRIPT was regenerated from the API.
- The provider-sourced voyage lengths are no longer flagged as estimates (`is_estimate: false` on the derivation). Malacca stays an estimate route because its bypass capacity is.
- Raw provider responses are kept only in git-ignored folders; the committed file `backend/data/ais_route_plans.json` holds derived values with source and retrieval date.

### Changed in M6 to M8 (behaviour you can see)

- **`GET /api/v1/conflicts` now returns only the 24 real historical events by default** (a deliberate change to an endpoint that was otherwise unchanged). It used to be unioned with every news-derived event that moved the simulated price; after a few days that was over 300 rows, the "Historical events" chart read "335 events" with an unreadable axis, and derived numbers sat in a chart titled history. `?include_simulated=true` restores the old union. Test: `test_conflicts_default_is_only_the_real_historical_record`.
- **Labels no longer imply live market data.** `LIVE BACKEND` is now `BACKEND CONNECTED`; `SIM CRUDE` became `MODEL BASELINE`, and in the M15 follow-up the header price became **`WTI BASELINE`, the latest sourced EIA WTI close** (the news-driven simulated price is no longer shown as a price; DECISIONS D36); the scenario panel's `LIVE` is `SCENARIO (simulated)`; the alert stream's `LIVE` is `NEWS STREAM CONNECTED`; "Live Alert Feed" is "News Alert Feed". "Predicted price change" is now "Modelled price change", and the `/simulate` explanation text says "estimate" instead of "prediction" (the JSON field `predicted_price_change_pct` keeps its name for compatibility).
- **One number format.** Flow rates are written `x.xx Mb/d` (trailing zeros dropped) everywhere; the dashboard price change shows one decimal like the Results page; colours come from one token set (`lib/constants.ts` and `index.css`, kept in step by a test).
- **Wording fix found by the claims audit.** The text "2025 production exceeded consumption by only about 9%" was imprecise: the headroom is 27,000 t (290,000 minus 263,000), which is about 9% of production but 10.3% of consumption. It now says "by 27,000 t, about 9% of production".
- **Layout and access.** The route panel's footer no longer lets scrolled text show through the Blockade/Detour buttons; text is at least 11 px; the globe is taller at tablet width; routes are reachable by keyboard (Tab to a hidden list that appears on focus, then Enter).
- **Price history is faster**: the CSV is parsed once and cached by modification time (it was re-parsed on every request).
- **New endpoints** (all additive): `/price/live`, `/price/history`, `/ws/vessels`, `/vessels/status`, `/health`, `/routes/{id}/news`, `/simulate/report`.

### Earlier changes (M1 to M3): corrected `/simulate` values

#### Corrected: `POST /api/v1/simulate` lithium and supply values (deliberate exception to backward compatibility)

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
At that point `/simulate` still used the 0.008 project assumption; it was switched to the sourced case in the next entry.

#### Changed: `POST /api/v1/simulate` now uses the sourced per-EV lithium case

Both endpoints now agree: `/simulate` and `/simulate/report` use **0.0319 t LCE per EV** (0.10 kg Li/kWh, ICCT 2024, NMC-811,
x 60 kWh pack, IEA Global EV Outlook 2026, x 5.323 LCE per Li) instead of the project's unsourced 0.008 t. Every existing key
and the response shape are unchanged; four keys were **added** inside `ev_feasibility`: `lce_tonnes_per_ev_used`,
`lce_tonnes_per_ev_project_assumption`, `lithium_tonnes_required_project_assumption`, `lithium_supply_ratio_project_assumption`.
The `explanation` text now ends with a "Basis" clause stating the per-EV figure and what 0.008 t would have given.
Barrels lost, vehicle-years and the price figure are untouched. Before/after (news lithium index pinned to 1.0;
snapshot of the old output in `backend/tests/snapshots/simulate_before_sourced_switch.json`):

| supply_loss_pct | lithium t LCE | `lithium_supply_ratio` | project-case keys (unchanged from before) |
|---|---|---|---|
| 0.5 | 58,819 to 234,820 | 0.038 to **0.152** | 58,819 t, 0.038 |
| 2 | 235,276 to 939,281 | 0.152 to **0.608** | 235,276 t, 0.152 |
| 5 | 588,190 to 2,348,202 | 0.381 to **1.521** | 588,190 t, 0.381 |
| 8 | 941,104 to 3,757,124 | 0.610 to **2.434** | 941,104 t, 0.610 |

So with the sourced battery figure a 5% supply loss needs about 1.5 times a year of world lithium output, not 0.38. The old
0.008 t figure is about 4 times lower than the published battery intensity, which is why the project case is kept only as a comparison.
The frontend offline-fallback mirror (`localFormula.ts`) and TypeScript types were updated to match. Regression tests:
`backend/tests/test_simulate_sourced_switch.py` and `test_simulate_corrected.py`.

## Feature notes

Detail on each part of the app, written as it was built.

### Route layer

The three.js globe draws all 14 routes from `GET /api/v1/routes`: sea lanes and chokepoints in blue with animated dashes (width scales with flow),
pipelines in amber and thinner (width scales with **nameplate capacity**, never flow), and a route under a scenario in pulsing crimson, elevated.
Hover shows a tooltip, click flies the camera to the route and opens its panel (flow or capacity, importers by region/group, exporters, bypass,
"if closed" stat, current-conditions note with EIA links), and "Simulate disruption on this route" pre-fills the scenario controls.
Route geometry is illustrative. Druzhba shows n/a. Routes with no sourced importer data say "not available" rather than showing an empty chart.
Screenshots from a real browser run are in `docs/m3_screenshots/`; the scripts that produced them are in `frontend/e2e/`.

### 2D map (M11)

A `GLOBE | MAP` switch in the top bar. The map is deck.gl in Web Mercator with **bundled Natural Earth outlines** (public domain; no tile server, so it works offline), a graticule, sea and chokepoint labels, lanes (blue), pipelines (amber) and disrupted routes (crimson), pulsing rings on chokepoints scaled by conflict intensity, antimeridian-safe lines, hover tooltips, click for the same side panel as the globe, "Reset view", and a collapsible **Layers** panel (routes, chokepoints, hubs and cities, real tankers, simulated traffic, scenario overlay), each with a count and a status chip. **One state for both views, kept in the address**: `?view=map|globe&lat=&lon=&zoom=&layers=routes,chokepoints,...&selected=<route or place>&vessel=<MMSI>`; every parameter is validated and a bad one falls back to its default (`lib/viewState.ts`, 48 plain-node checks). Switching view keeps the selection.

**Speed (software WebGL, 1440 x 900, all layers, 2,000 simulated vessels):** about 70 to 120 fps idle; **dragging was 6.5 fps until M15** because every pointer move redrew the country outlines on a second canvas. Since M15 that canvas keeps its picture during a drag or zoom and is moved by a CSS transform (derived from the camera and checked against deck.gl's own projection), then redrawn once when the interaction ends: about 30 to 45 fps while dragging, with a brief dark strip where new area is exposed. `frontend/e2e/m15_drag.mjs` asserts it.

### Route news

`GET /api/v1/routes/{id}/news` returns recent headlines for one route: **headline, source, published time, link and a tag** (`attack`,
`sanctions`, `disruption`, `shipping`, `general`). No article text is requested, stored or shown. The route panel's "Recent news" section
shows them, with the feed's honest state: normal, **STALE** (live feed down, last cached result with its original time), empty, or unavailable.

**Source and terms.** GDELT DOC 2.0 (free, no key). GDELT's terms allow unrestricted academic and commercial use and redistribution *if* the
GDELT Project is cited with a link to https://www.gdeltproject.org/ (the panel shows that attribution as a link). **NewsAPI is not used for route news:**
its free Developer plan is "for development and testing in a development environment only" and "cannot be used in a staging or production
environment (including internally)", is limited to 100 requests/day with a 24-hour article delay and one month of history, and shares a quota with
the existing classification pipeline. (That existing pipeline does use the Developer key, which is worth reviewing before any public demo.)

**What the live API is really like** (measured, not assumed): from this machine the TLS handshake alone takes about 10 s and a full answer 12 to 15 s,
so timeouts are generous and the panel says "this feed can take 10 to 20 seconds". GDELT answers HTTP 429 ("Please limit requests to one every
5 seconds") often, even when requests are spaced further apart, so the client waits 15 s after a 429, retries twice within a 60 s budget,
and keeps requests at least 6 s apart. A result is cached for 20 minutes (memory plus `backend/data/cache/`, git-ignored).

**Quality controls** (GDELT keyword search is noisy; on a real Hormuz query 75 raw records became 2 headlines):
per-route queries (name and aliases AND context words, English only); the **headline itself must name the route**; broad terms such as "Houthi"
count only with a shipping or oil word beside them (otherwise Yemen war stories flood the Red Sea route); near-duplicate (syndicated) headlines
are removed; titles are cleaned of trailing publisher names and tokenizer spacing; newest first, at most 12.

**Classifier.** `services/news_classifier.py`, a pure function (priority attack, sanctions, disruption, shipping, general; whole-word matching).
I inspected the existing NewsAPI classifier first and did **not** reuse it: its tag set (`chokepoint_disruption`, `supply_outage`, `opec_decision`,
`sanctions`, `ev_lithium_supply`, `conflict_escalation`, `other`) has no "attack" or "shipping" tag, it logs every call, and its public entry point can
call the Claude API. Nothing else is shared with that pipeline (own cache, own code, no API key, no quota).
Checked against 34 real headlines by eye (`backend/tests/test_news_real_headlines.py` pins 22 of them): about 31 are tagged sensibly. Known
limits: a keyword tagger cannot see negation ("Egypt will **not** attack Yemen" is tagged `attack`, recorded as a strict expected failure), and
recall is deliberately low because the headline must name the route.

**Failure handling, proven.** `POST /api/v1/dev/news-feed` (DEV-ONLY) simulates a feed failure (`fail`) or an empty feed (`empty`) and can age the cache.
With `fail` and an aged cache the backend returned the same 2 headlines with `stale: true` and the original 07:02 UTC time; with nothing cached it
said so; with `empty` it showed the empty message. Screenshots: `docs/m4_screenshots/` (`11_news_normal`, `12_news_stale`,
`13_news_unavailable_nothing_cached`, `14_news_empty`), produced by `frontend/e2e/news_states.mjs`.

### Results page

`/results` is the full report for one scenario. **The whole scenario is in the address**, so a refresh or a shared link restores the same page:

`/results?route=suez&type=detour&detour=20&dur=60&conf=5&dem=0&ev=100&li=10&horizon=5`

| Param | Meaning | Allowed |
|---|---|---|
| `route` | route id (required) | any simulatable route; `bab el-mandeb`, `Bab-el-Mandeb` and `bab_el_mandeb` are the same |
| `type` | `blockade` or `detour` | default `blockade` |
| `share` | % of the route blocked (blockade) | 0 to 100, default 100 |
| `detour` | extra voyage days (detour) | 0 to 120; **omit it to use the route's derived default**, and the page then says so |
| `dur` | disruption length in days | above 0 up to 730, default 30 |
| `conf`, `dem` | conflict intensity, demand change % | 0 to 10, -50 to 50 |
| `ev` | % of lost fuel demand replaced by EVs | 0 to 100, default 100 |
| `li` | % of world lithium production available (the supply cap) | 0 to 100, default 10 |
| `horizon` | years for the headline EV and lithium numbers | 1 to 10, default 5 |
| `fleet`, `by` | `0` = tanker fleet can expand; baseline-year override | optional |

A bad value gets a plain list of what is wrong and a way back to the map (no crash, no request). Pipelines, routes with no sourced figure and the Cape
of Good Hope alternate lane are explained, not errored. "Back to map" returns to the globe; "Edit scenario" returns to the map with every control restored.

Page layout: header (route, baseline year, the user's detour days next to the route's derived default, the current-conditions note with the EIA links),
a KPI strip (price impact, barrels per day displaced, EVs required, extra lithium, lithium deficit; the "outside the validated range" warning sits here when it
applies), then six sections, each with a chart, a 2-4 sentence summary written by the backend from computed numbers, a one-line takeaway and a collapsible
"Assumptions and sources" block. The price section (M14) shows **one 30-day value** as a single marker with its plus or minus 13.09 pp error bar and the badge `VALIDATED 30 DAYS (≤ 8% supply loss)`; beyond 8% supply loss the marker turns red, the bar is replaced by "not validated at this magnitude" and the badge reads `OUTSIDE VALIDATED RANGE`. There is no path before day 30, and a note says the validated formula uses supply loss only, not duration. The chart also shows the reference event (the 2026 Iran war,
labelled a soft figure, still unfolding) and the Hormuz bypass sensitivity (4.7 vs 2.6 Mb/d). The barrels chart ends with the disruption length you entered; the 1, 3 and 5 year EV horizons are labelled "if the displacement lasted this long (arithmetic, not a forecast)". The economy section shows an effect only where a coefficient has a cited primary source.

**Tests.** `backend/tests/test_report_consistency.py` checks that every number quoted in a summary, takeaway or warning matches a value in the report payload
(across nine scenarios, with a guard test proving it catches a wrong number) and that every summary is 2 to 4 sentences. Browser checks are in
`frontend/e2e/results_page.mjs` and `m5_flow.mjs`; screenshots are in `docs/m5_screenshots/`. Known limitations: `LIMITATIONS_AND_FUTURE_WORK.md`.

**News warm-up.** At startup the backend fetches route news one route at a time, at least 6 s apart (with the 429 back-off), so the first click in a demo does not wait
10 to 20 s or more. Set `NEWS_WARMUP=0` to disable it. Measured: with an empty cache the first request took 44.5 s (Bab el-Mandeb) and 68.8 s then 17.6 s (Hormuz, whose first attempt failed); once cached, 0.017 s. A full warm-up pass over 14 routes fetched 5, found 2 already fresh and **7 failed** (GDELT answered 429 or timed out on every retry), so a route can still start cold; afterwards cached clicks took 14 to 24 ms, and an expired entry was shown at once (about 0.5 s, marked stale and refreshing) while a refresh ran in the background.

### Before a demo: news warm-up and the demo snapshot

GDELT, the free news feed, is slow (10 to 60 s per answer here) and often refuses requests (HTTP 429), and that is outside our control. Three layers keep the
route-news panel from stalling or going blank on the day. **Run the pre-warm script a few minutes before presenting.**

**1. Startup warm-up (automatic).** When the backend starts it fetches route news one route at a time, at least 6 s apart (respecting the 429 back-off),
skipping routes whose cache is still fresh. It cannot be hurried and some routes fail: a full pass fetched 5 of 14. Set `NEWS_WARMUP=0` to turn it off.

**2. The on-disk cache (automatic).** Every fetched result is saved to `backend/data/cache/route_news/` (git-ignored) with its fetched-at time, so it
**survives a backend restart**. A result is fresh for 20 minutes; after that the panel shows it at once, marked STALE with its original time, while a refresh runs in the background.

**3. The pre-warm script (run it yourself before a demo).**

```
cd backend
python tools/prewarm_news.py --snapshot        # fetch every route (3 attempts each, 20 s apart), then save the demo snapshot
```

It prints a table of what is ready, how many headlines each route has and when they were fetched. Useful variations: `--attempts 5 --gap 30` for a bad day,
`--only hormuz,suez` for the routes you will click, `--force` to refetch fresh routes, and `--snapshot-only` to rebuild the snapshot with no network.
Expect 5 to 15 minutes. If a route still fails, run it again later. **Do not start the backend and the script at the same moment**, as both would hit GDELT and trip its rate limit.

**The demo snapshot** (`backend/data/news_demo_snapshot.json`, committed) is a saved copy of *real* headlines with the date they were fetched. It is used only when the
live feed fails and the cache has nothing better, so a route does not show blank in a presentation. The panel then shows an amber **DEMO SNAPSHOT** badge,
"fetched <date>" and the sentence "this is a saved copy of real headlines ... It is not live". It is never shown as live or fresh, and a live or cached result always takes precedence over it.
It is built only from real fetched results by the script (never edited by hand). **Today it holds 4 of 14 routes** (Hormuz, Bab el-Mandeb, Suez, East-West pipeline), the only ones GDELT has
returned headlines for; the other routes show the plain "empty" or "unavailable" message. Re-run the pre-warm script with `--snapshot` to refresh it, and commit the file if you want the new copy kept.


#### The `NEWS_WARMUP` setting

`NEWS_WARMUP` (in `backend/.env` or the environment) controls whether the server fills the route-news cache at startup. **On by default** (`1`); `0`, `false`, `off` or `no` turns it off. The test suite sets it to `0` (`backend/tests/conftest.py`) so tests never call GDELT.
Turn it off for cold-start measurements or when working offline; leave it on before a demo (see "Before a demo" above).

### Live oil price

The ticker at the top of every page shows WTI and Brent with coloured change, a 30-day sparkline, the as-of date **and how old it is**, and a status badge.

**Where the data comes from.** EIA Open Data API v2, route `petroleum/pri/spt` (daily spot prices), series **RWTC** (WTI, Cushing) and **RBRTE** (Brent, Europe), both USD per barrel.
The key goes in the request URL (EIA does not accept a header), so it is read on the server only. Set it in `backend/.env` (see `.env.example`); register free at https://www.eia.gov/opendata/register.php.

**What the numbers really are (read this before presenting).** EIA's spot prices are *daily closes* but are **published in a weekly release** (release dates on EIA's page were
21 Oct and 28 Oct 2026, seven days apart). On 25 Oct 2026 the newest published close was **20 Oct**: 5 days old, and it is never fresher than the last Wednesday release. So nothing here is a live quote, and **nothing is ever labelled LIVE**.

| Status | Meaning |
|---|---|
| `DAILY_CLOSE` | The EIA API call succeeded (or a success from the last 24 hours is being reused after EIA failed). The age is always shown; over 3 days old it turns orange and carries a warning. |
| `OFFLINE_FALLBACK` | EIA could not be used (no key, rejected key, timeout, server error, rate limit, unreadable reply). Shows the **last row of `data/oil_daily_prices.csv`, with its real date (2026-08-18, 68 days old)** and the reason. |

Without a key the app runs fully: the ticker shows `OFFLINE_FALLBACK` and says why. Measured on this machine: a real authenticated EIA call takes about **1.7 to 2.1 s** (a keyless call, which returns HTTP 403, took 0.74 to 0.78 s); the timeout is 5 s with one retry (worst case about 10.5 s before falling back); results are cached 15 minutes; the browser polls every 10 minutes and backs off 30 s, 60 s ... up to 10 minutes after an error.

**History and holidays.** `/price/history` merges the CSV with EIA data by date (EIA wins when both have a date), never returns a date twice, and drops dates where both prices are blank. EIA leaves a blank value on market holidays; blanks are treated as "no price" and skipped when computing the latest value and the change.

**Keeping the key private.** The key is never in a response, a log line, an exception message or the frontend. `httpx` logs full request URLs at INFO (which would include `api_key=...`), so that logging is switched off and a log-record
filter redacts any `api_key=` value and the key itself from every record. `backend/tests/test_price_feed.py` checks all of this, including a test that proves the leak is real when the protections are removed.

**Demo and screenshots without a key.** `backend/tools/mock_eia_server.py` stands in for EIA (modes: `ok`, `invalid_key`, `error`, `slow`). It is **not EIA and not live**: it serves the six closes (13 to 20 Oct 2026) that EIA's public table showed, so the real adapter can be exercised over real HTTP.
It is **dev-only**: the app ignores a custom `EIA_BASE_URL` unless `PRICE_DEV_ALLOW_CUSTOM_EIA_URL=1` is also set, and then labels the price source "DEV STAND-IN for EIA (mock server, NOT EIA DATA)". Start it, then run the backend with `EIA_BASE_URL=http://127.0.0.1:8765/v2 PRICE_DEV_ALLOW_CUSTOM_EIA_URL=1 EIA_API_KEY=any-dummy-value`. Screenshots of every ticker state are in `docs/m6_screenshots/`, produced by `frontend/e2e/price_ticker.mjs`.


### Vessels on the globe

The globe shows tankers in one of two modes. **Simulated mode is the default and the fallback** (no key, feed down, or the AIS toggle off). A **SIMULATED VESSELS** badge sits over the globe and cannot be hidden. In AIS mode it reads **AIS FEED · UNVERIFIED**.

**Simulated vessels (always labelled).** About 2,000 invented tankers move along the drawn route lines at 14 knots, the project's tanker speed. Real speed would look frozen, so time is compressed (1 second = 6 simulated hours); this is stated in the info tooltip.
Vessels are spread by lane length so every lane looks evenly populated, which says nothing about real traffic. **No simulated count, flow or density is shown in any panel or on the Results page**, and a test (`backend/tests/test_ais_feed.py`) scans the route panel, Results page and report code to keep it that way.
When a scenario disrupts a route that has an alternate lane (for example a Suez detour), its simulated vessels glide onto that lane and turn amber. With no alternate lane (a blockade) they are held in place (red). Every field a simulated vessel lacks reads "simulated".

**Using it.** Zoom in and click a vessel for its panel (name, MMSI, flag, speed, course, destination, draught, and the line "cargo type not confirmed by AIS"). At the default zoom a click picks the route as before; **Shift-click** picks a vessel at any zoom and **Alt-click** always picks the route underneath, because vessels sit on the route lines.

**Live AIS mode (UNVERIFIED).** `backend/services/ais_feed.py` connects server-side to AISStream.io (`wss://stream.aisstream.io/v0/stream`) and the browser receives vessels from `WS /ws/vessels`. Set `AISSTREAM_API_KEY` in `backend/.env` (free key, sign in with GitHub at https://aisstream.io). The key is sent inside the subscription message, never in a URL, never to the browser, and is redacted from logs.

**It has not been run against the live feed**: no key was available. It is built from the provider's published documentation and a mock transport, and every status frame says "UNVERIFIED against the live feed" until `VERIFIED_AGAINST_LIVE_FEED` in `ais_feed.py` is changed on purpose after a real run. What it does, per the docs:
- subscribes to one bounding box per sea route (padded 1.5 degrees);
- keeps **tankers only (AIS ship types 80 to 89)**. Position reports do not carry the ship type, so a vessel only appears after its `ShipStaticData` message (sent every few minutes) shows it is a tanker, which can take minutes after startup;
- dedupes by MMSI and forwards at most **one update per vessel per 10 s**;
- turns AIS "not available" values (speed 102.3, course 360, heading 511) into "not reported", and derives the flag from the MMSI prefix (it is what the transponder claims, not a verified fact);
- reconnects with backoff (5 s up to 5 minutes); with no key the socket sends one status frame and closes, and the browser stays on simulated vessels, saying so.

`GET /api/v1/vessels/status` returns the same status as JSON.

#### What AIS can and cannot tell you
- **Coverage has gaps.** Free feeds rely on receivers near coasts; open-ocean stretches can be empty.
- **Vessels can switch their transponder off**, especially around the Gulf and in sanctioned trades ("dark fleet"). A missing ship is not an absent ship, and counts from AIS are lower bounds.
- **Destination is typed in by the crew** and is often stale, abbreviated or wrong. The panel labels it "self-reported, unreliable".
- **Free tiers are limited.** AISStream allows 3 subscribed connections per account (and 3 per IP), one subscription change per second, and states it has no SLA or uptime guarantee. It documents bandwidth limits for uncompressed connections from September 2026.
- **AIS does not say what a tanker carries**, or whether it is loaded. Types 80 to 89 only mean "tanker". Draught is self-reported.

#### Performance (software WebGL, so a lower bound)
Measured with `frontend/e2e/vessels_fps.mjs` in headless Chromium on the CPU (SwiftShader), three rounds, 8 seconds each:

| Setup | fps, M7 run | fps, final v1.0 run |
|---|---|---|
| No routes, no vessels | 34.7 to 39.2 | 33.0 to 39.8 |
| All routes, no vessels | 31.1 to 34.2 | 31.0 to 34.3 |
| **All routes + 2,000 vessels** | 31.0 to 34.0 | **30.2 to 34.0** |

The first version (cones, updated every frame) measured **19.3 fps**, under the 20 fps line, so it was fixed before moving on: one-triangle arrowheads, vessels on the far side of the globe are not drawn, and the simulation updates at 20 Hz (motion is about 6 px per second, so this is not visible). Earlier baselines were 33.6 fps without routes and 30.3 with routes.
The drawing is a single `InstancedMesh` plus one `LineSegments` for the trails.

**Results page load** (navigation to the KPI strip, production build, fresh browser context, median of 5 runs, `frontend/e2e/results_load.mjs`): M5 about 500 ms; v1.0 about 560 ms (+60 ms, about 12%, the price ticker's extra requests). On the Vite dev server: about 1.0 to 1.1 s at M5 against about 1.2 s now. The JS bundle grew from 1,630 KB to 1,657 KB (+1.7%). The report API itself answers in about 20 ms.

## Limitations

The full list, with what was observed, is in **`LIMITATIONS_AND_FUTURE_WORK.md`**. The ones to say out loud:

- **A small, partly estimated sample.** 21 events, hand-scored `conflict_intensity`, several estimated `supply_loss_pct` values, a borrowed elasticity. The ±13.09 pp band is the formula's honest error on those events.
- **The formula is linear and validated to 8% supply loss.** Bigger shocks (a Hormuz blockade is 15.5%) are extrapolations and are marked as such.
- **Baselines are pre-crisis years**, so results are what-ifs from a normal year, not forecasts of 2026 conditions.
- **EIA prices are weekly-released daily closes**, never live. Without a key the ticker shows a 2026-08-18 row.
- **The live AIS feed is unverified**, its provider's terms are unconfirmed, and AIS itself cannot show dark vessels, destinations you can trust, or cargo.
- **Lithium per EV is NMC-811 only** and uses a chosen 60 kWh pack; the project's original 0.008 t per EV is unsourced.
- **The older news pipeline uses a NewsAPI Developer key**, which is outside that plan's terms for production use.
- **Frame rates are from software rendering** (a lower bound); a real GPU was not measured.

### Real tankers on both views (M12)

Twelve **real** tankers from a saved ShipFinder snapshot (first found on 2026-11-03: eight near Huelva, Spain and four in the Strait of Malacca; all twelve positions refreshed one by one in the final snapshot on 2026-11-11 08:32 UTC, so they have since sailed on) are drawn in teal on the globe and on the 2D map, always labelled **SNAPSHOT** with their seen-at time. They are two samples of where tankers were first found, not coverage of any area; chokepoint traffic stays **SIMULATED**.

- **One vessel panel on both views:** name, MMSI, IMO, flag, type, length, speed, course, destination, draught, AIS status, position, how the position was confirmed, the SNAPSHOT badge with its time, and "cargo type not confirmed by AIS". The selected vessel is in the address (`vessel=<MMSI>`), so switching Globe/Map, reloading or sharing the link keeps it.
- **Saved past track:** drawn on the surface of the globe and on the map, labelled "past track, fetched at <time>", or "no saved track". MUHUT SILVER is the headline track (it sailed 846 nm in the week, 659 nm start to end); CAPE ANN is kept and labelled "stationary during this window".
- **Vessels near this vessel (10 nm):** the saved Nearby sample only, labelled with its seed and time. No live Nearby call is ever made (that service is on hold).
- **Search box:** typing searches the saved vessels; the provider is asked only when you press "Search the provider" (one search per press; "no match" for status 31; limits and breaker respected).
- **The key expires on 2026-11-13.** From that date the app makes no AIS call and every view says "AIS key expired, showing data saved on <date>"; there is no error screen. To check this without waiting, start a backend with `AIS_TODAY=2026-11-13` (testing only). `GET /api/v1/health` carries "AIS key expires in N days".

### Markets panel (M13)

- **Replaces the historical-events chart**, which is gone from the dashboard (component, styles and mentions removed; `events.csv` and `GET /api/v1/conflicts` stay in the backend because the validation and the location panels use them).
- **Tabs Indices, Commodities, FX.** WTI and Brent are our own cards from the EIA feed (`DAILY_CLOSE`, or `OFFLINE_FALLBACK` with its date, never LIVE). Everything else is one TradingView widget per tab, mounted only after the panel is scrolled into view, so a visitor who never looks at it never contacts TradingView.
- **Chips and tooltips:** "Via TradingView widget, delay set by TradingView", no "as of" time; the "?" quotes TradingView's own delay wording. If TradingView cannot be reached the tab says "Widget unavailable" and shows no number.
- **Rows marked CFD are broker quotes** (FOREXCOM, OANDA, CAPITALCOM) that track the index or commodity closely; they are not the official level. **Not available in the free widget:** Nasdaq Composite and Nifty 50 (the Nasdaq 100 and the Sensex stand in); lithium has no free source.
- **WTI scenario toggle:** the last EIA WTI close times the same 30-day formula the Crisis Scenario panel uses (supply loss / 0.15). Up to 8% supply loss it shows VALIDATED 30 DAYS and the measured +/- 13.09 pp; above 8% it shows OUTSIDE VALIDATED RANGE with no band. It switches itself off when the EIA price is a stale fallback. No other card has a scenario number and there are no cross-asset estimates.
- **No key, no server cache** for these quotes: the browser contacts TradingView directly (a one-line note says so). Alpha Vantage is not used (its free terms say "personal, non-commercial use" and nothing about public display; DECISIONS D26).

## Hosted mode (M16)

`HOSTED_MODE=1` turns the same code into a public deployment. Local mode (the default) is unchanged. Decisions: `docs/DECISIONS.md` D25 to D32 and D37 to D40.

| Source | Hosted default | What visitors get |
|---|---|---|
| EIA | **on** | WTI and Brent from the scheduled refresh, with the EIA date; the dated CSV only until the first refresh has run |
| GDELT | **on** | Route headlines from the scheduled refresh (cache labelled with its age), with the GDELT citation |
| TradingView | **on** | The Markets widgets, with the attribution and a note that the visitor's browser contacts TradingView |
| Global Energy Monitor | **on** | Refinery and pipeline values with the exact citation and the note "licence unconfirmed" |
| Anthropic (Claude) | **on by default, OFF at launch** | When on: each headline classified once and cached; a daily call cap, a monthly dollar cap, and a rule-based fallback. The launch deployment sets `HOSTED_ENABLE_ANTHROPIC=0` and no key, so headlines are tagged by rules (how to switch it on: `DEPLOY.md`) |
| ShipFinder snapshot | **on, read-only** | The 12 saved real tankers, 3 saved tracks and 2 "vessels within 10 nm" samples from 2026-11-11, every one badged SNAPSHOT with its seen-at time. Footer: "Real tanker positions: ShipFinder snapshot (2026-11-11, non-commercial use). Chokepoint traffic is simulated." From 2026-11-13 the banner reads "showing data saved on 2026-11-11" |
| ShipFinder live calls | **off** | The hosted site makes no ShipFinder call; the key expires 2026-11-13 and is not set on the host |
| AISStream | **off** | Not set up |
| NewsAPI | **off** | The "News Alert Feed" panel lists the cached GDELT route headlines instead (publisher, time, rule-based tag, route, and when the cache was fetched); they move no price. `GET /api/v1/news/headlines` |
| Alpha Vantage | **off** | Not used on the public site (its free terms say personal, non-commercial use) |
| ShipFinder route-planned voyage distances | **on** | The same voyage days as the local copy (Suez 19.5 days, default detour 14.0). `HOSTED_ENABLE_SHIPFINDER_DISTANCES=0` switches back to the earlier estimates |

What else changes when hosted: a visitor request never causes an EIA or GDELT call (one scheduled refresh a day and one at start-up do), a sliding one-minute rate limit per client (120 requests, 30 for the calculator) answers 429 with a plain sentence and `Retry-After`, the developer and test endpoints answer 404, CORS allows only `FRONTEND_ORIGIN`, an unexpected failure is one friendly sentence (never a traceback), and the footer shows the disclaimer, an attribution for every enabled source, the TradingView note, a privacy note (no cookies, no analytics) and the repository link.

The public site and the author's local copy now use the same voyage distances (ShipFinder route planning, DECISIONS D38), so the same scenario gives the same numbers in both. The earlier estimated set (Suez 21.2 days, default detour 12.7) stays in the code behind `HOSTED_ENABLE_SHIPFINDER_DISTANCES=0` and in `docs/m10_voyage_before.json`.

**Permission and condition.** ShipFinder replied (2026-11-11) that public display of its data on a hosted site is allowed as long as the project is non-commercial and the data is not sold. This project is non-commercial and sells nothing; if that changes, switch the two ShipFinder flags off and remove `backend/data/ais_display/`.

## Tests

| What | Command | Result |
|---|---|---|
| Backend (pytest): calculation engine, golden values, report consistency, route API snapshots, news, price feed, AIS adapter, frontend consistency, repo hygiene | `cd backend ; .\venv\Scripts\python.exe -m pytest` (the venv, not the system Python) | **319 passed, 1 expected failure** (the recorded negation case in `test_news_real_headlines.py`) |
| Frontend type-check, lint, production build | `cd frontend ; npx tsc -b ; npx oxlint ; npm run build` | tsc clean; lint 1 warning (a pre-existing `set-state-in-effect` note in `ChokepointPanel.tsx`); build OK |
| M11 and M12 (2D map, real vessels): plain-node unit checks, then two real-Chromium walkthroughs | `cd backend ; .\venv\Scripts\python.exe -m pytest tests	est_viewstate_unit.py` ; `cd frontend ; SHOT_DIR=..\docs\m12_screenshots node e2e\m12_view.mjs` (needs the backend on :8000, `npm run dev`, and a second backend on :8001 started with `AIS_TODAY=2026-11-13`) ; `node e2e\map_view.mjs` | at M12: backend **447 passed, 1 expected failure**; 43 unit checks; `m12_view.mjs` **64 checks pass**, `map_view.mjs` **51 pass**, 0 console errors; frames per second on software rendering with all layers on: 78 (zoom 2) and 114 (zoom 5.5) |
| M13 (Markets panel): 18 plain-node checks (symbols, chip wording, WTI scenario number), then a real-Chromium walkthrough with the real TradingView widget | `cd backend ; .\venv\Scripts\python.exe -m pytest tests\test_markets_unit.py` ; `cd frontend ; SHOT_DIR=..\docs\m13_screenshots node e2e\m13_view.mjs` (backend on :8000, `npm run dev`, network access to TradingView) | at M13: `m13_view.mjs` **43 checks pass**, 0 console errors; frames per second on software rendering (zoom 2 / 5.5): about 85 to 101 / 119 to 125 with the panel not scrolled to, about 87 to 103 / 117 to 124 with all three widgets mounted (M12: 78 / 114; the figure varies by about 20 percent between runs on this machine) |
| M14 (30-day outlook): backend tests for one horizon, the plain formula for every duration, no decay; a real-Chromium walkthrough of the Results page at laptop and phone width | `cd backend ; .\venv\Scripts\python.exe -m pytest tests\test_routes_api.py tests\test_calc_engine.py tests\test_report_consistency.py` ; `cd frontend ; SHOT_DIR=..\docs\m14_screenshots node e2e\m14_view.mjs` ; `python tools\m14_examples.py out.json` (before and after table in `docs/m14_before_after.md`) | at M14: backend **450 passed, 1 expected failure**; `m14_view.mjs` **37 checks pass**, 0 console errors; claims audit 50 of 50 |
| M15 (polish and QA): the end-to-end run of DEMO_SCRIPT.md, the first-time-user walk at 1440, 820 and 390 px, the drag speed | `cd frontend ; SHOT_DIR=..\docs\m15_screenshots node e2e\m15_demo_run.mjs` ; `node e2e\m15_walk.mjs` ; `node e2e\m15_drag.mjs` (ZOOM=2 or 5.5) | at M15: `m15_demo_run.mjs` **66 checks pass**, 0 console errors; drag speed **27 to 45 fps** (was 6.5), outlines redrawn only after release; idle fps 91 to 126 with all layers on (zoom 2 and 5.5); `map_view` 51, `m12` 64, `m13` 43, `m13_phone` 29, `m14` 60 browser checks pass; lint clean |
| v2.0 release check (2026-11-11, after the final AIS snapshot): backend suite here, backend suite on a clean `git archive` export, three browser suites | `cd backend ; .\venv\Scripts\python.exe -m pytest` ; `cd frontend ; node e2e\m12_view.mjs` ; `node e2e\map_view.mjs` ; `node e2e\m15_demo_run.mjs` | here **451 passed, 1 expected failure**; clean export **448 passed, 3 skipped (the tests that need the git-ignored AIS data), 1 expected failure**; `m12_view` **64**, `map_view` **51**, `m15_demo_run` **66** checks pass, 0 console errors; lint clean, build ok |
| M16 (hosted mode): 29 backend tests (flags, disabled sources, cache-only serving, the Claude caps with a counting fake, guards, estimated distances, the schedule), then a real-Chromium run of a hosted backend and a production build on separate origins, and a scan of the bundle for keys | `cd backend ; .\venv\Scripts\python.exe -m pytest tests\test_hosted_m16.py` ; `cd frontend ; VITE_API_ORIGIN=http://127.0.0.1:8002 npm run build ; node e2e\m16_bundle_scan.mjs ; SHOT_DIR=..\docs\m16_screenshots node e2e\m16_hosted.mjs` (needs a backend with `HOSTED_MODE=1` and `FRONTEND_ORIGIN=http://127.0.0.1:4173` on :8002 and `npx vite preview --port 4173 --host 127.0.0.1`) | backend **480 passed, 1 expected failure**; `m16_hosted.mjs` **70 checks pass**, 0 console errors at 1440, 820 and 390 px; bundle scan **all clear** (4 key values from `.env`, `sk-ant-`, `ghp_`, `AKIA`, `?key=` URLs, 32+ character tokens: none); lint and type-check clean |
| Claims audit: every number in the README, DEMO_SCRIPT and LIMITATIONS rebuilt from the running app | `cd backend ; python tools\check_claims.py` | **91 of 91 claims match** (also run inside the pytest suite) |
| Browser walkthroughs (real Chromium, software WebGL), screenshots in `docs/` | `frontend/e2e/*.mjs` (see its README) | Run per milestone; M8 and M9 runs had 0 console errors (the "backend down" state shows 10 browser-logged 502s, which is expected) |

The backend suite includes tests that read the frontend source (colour tokens, units, minimum text size, no vessel statistics on route or Results code, no key in the bundle) and the repo (every environment variable listed in `.env.example`, no key value in tracked files or in git history).

## Repo hygiene and secrets

- `backend/.env` holds real keys and is **git-ignored and untracked**. `backend/.env.example` lists every variable the code reads (checked by a test) with **no values**.
- The 31.8 MB `backend/data/globalEnergyOwnership.xlsx` is **git-ignored and untracked**; its download source is in the quick start above.
- Searched on 30 Oct 2026: none of the key values in the local `.env` appears in any tracked file or in any of the repository's commits on any branch (a `git log -S` search per value). The check is repeatable: `python -m pytest tests/test_repo_hygiene.py`.
- Keys are read on the server only. `httpx` logs full request URLs at INFO, which would write `api_key=` into logs, so that logging is off and a log filter redacts the EIA and AIS keys (a test proves the leak is real without it).
- Generated or dev-only files are labelled: `tools/mock_eia_server.py` is dev-only and the app cannot reach it without two explicit settings; `docs/*_screenshots/` are evidence from real browser runs.

