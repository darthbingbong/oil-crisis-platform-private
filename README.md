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
| POST | `/api/v1/simulate/report` | new | Full scenario report for the Results page: KPIs, six sections each with chart data, a templated 2-4 sentence summary, a one-line takeaway and cited assumptions. Rejects (422, with a plain message) pipelines, routes with no sourced figure and the Cape alternate lane |
| GET | `/api/v1/routes/{id}/news` | new (M4) | Tagged headlines (title, source, date, link only) from GDELT; cached 20 min; `stale` / `refreshing` when the live feed is down or being refreshed |
| POST | `/api/v1/dev/news-feed` | new, DEV-ONLY | Simulate a feed failure, an empty feed, or an aged cache |
| GET | `/api/v1/price/live` | new (M6) | Latest WTI and Brent (USD per barrel), change, `as_of`, `age_days` and `status` = `DAILY_CLOSE` (EIA answered) or `OFFLINE_FALLBACK` (last row of the local CSV). Never `LIVE` |
| GET | `/api/v1/price/history?days=30` | new (M6) | Merged CSV + EIA daily series for the sparkline: no duplicate dates, blank holiday rows skipped |
| GET | `/api/v1/health`, WS `/ws/vessels` | planned | Milestone M7 |

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
At that point `/simulate` still used the 0.008 project assumption; it was switched to the sourced case in the next entry.

### Changed: `POST /api/v1/simulate` now uses the sourced per-EV lithium case

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

## Route layer (Milestone 3)

The three.js globe draws all 14 routes from `GET /api/v1/routes`: sea lanes and chokepoints in blue with animated dashes (width scales with flow),
pipelines in amber and thinner (width scales with **nameplate capacity**, never flow), and a route under a scenario in pulsing crimson, elevated.
Hover shows a tooltip, click flies the camera to the route and opens its panel (flow or capacity, importers by region/group, exporters, bypass,
"if closed" stat, current-conditions note with EIA links), and "Simulate disruption on this route" pre-fills the scenario controls.
Route geometry is illustrative. Druzhba shows n/a. Routes with no sourced importer data say "not available" rather than showing an empty chart.
Screenshots from a real browser run are in `docs/m3_screenshots/`; the scripts that produced them are in `frontend/e2e/`.

## Route news (Milestone 4)

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

## Results page (Milestone 5)

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
"Assumptions and sources" block. The price chart draws the part beyond the validated range dashed on a shaded zone, shows the reference event (the 2026 Iran war,
labelled a soft figure, still unfolding), shows the Hormuz bypass sensitivity (4.7 vs 2.6 Mb/d), and replaces the plus or minus 13.09 pp band with
"not validated at this magnitude" beyond 8% supply loss. The economy section shows an effect only where a coefficient has a cited primary source.

**Tests.** `backend/tests/test_report_consistency.py` checks that every number quoted in a summary, takeaway or warning matches a value in the report payload
(across nine scenarios, with a guard test proving it catches a wrong number) and that every summary is 2 to 4 sentences. Browser checks are in
`frontend/e2e/results_page.mjs` and `m5_flow.mjs`; screenshots are in `docs/m5_screenshots/`. Known limitations: `LIMITATIONS_AND_FUTURE_WORK.md`.

**News warm-up.** At startup the backend fetches route news one route at a time, at least 6 s apart (with the 429 back-off), so the first click in a demo does not wait
10 to 20 s or more. Set `NEWS_WARMUP=0` to disable it. Measured: with an empty cache the first request took 44.5 s (Bab el-Mandeb) and 68.8 s then 17.6 s (Hormuz, whose first attempt failed); once cached, 0.017 s. A full warm-up pass over 14 routes fetched 5, found 2 already fresh and **7 failed** (GDELT answered 429 or timed out on every retry), so a route can still start cold; afterwards cached clicks took 14 to 24 ms, and an expired entry was shown at once (about 0.5 s, marked stale and refreshing) while a refresh ran in the background.

## Before a demo: news warm-up and the demo snapshot

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


## Live oil price (Milestone 6)

The ticker at the top of every page shows WTI and Brent with coloured change, a 30-day sparkline, the as-of date **and how old it is**, and a status badge.

**Where the data comes from.** EIA Open Data API v2, route `petroleum/pri/spt` (daily spot prices), series **RWTC** (WTI, Cushing) and **RBRTE** (Brent, Europe), both USD per barrel.
The key goes in the request URL (EIA does not accept a header), so it is read on the server only. Set it in `backend/.env` (see `.env.example`); register free at https://www.eia.gov/opendata/register.php.

**What the numbers really are (read this before presenting).** EIA's spot prices are *daily closes* but are **published in a weekly release** (release dates on EIA's page were
21 Oct and 28 Oct 2026, seven days apart). On 25 Oct 2026 the newest published close was **20 Oct**: 5 days old, and it is never fresher than the last Wednesday release. So nothing here is a live quote, and **nothing is ever labelled LIVE**.

| Status | Meaning |
|---|---|
| `DAILY_CLOSE` | The EIA API call succeeded (or a success from the last 24 hours is being reused after EIA failed). The age is always shown; over 3 days old it turns orange and carries a warning. |
| `OFFLINE_FALLBACK` | EIA could not be used (no key, rejected key, timeout, server error, rate limit, unreadable reply). Shows the **last row of `data/oil_daily_prices.csv`, with its real date (2026-08-18, 68 days old)** and the reason. |

Without a key the app runs fully: the ticker shows `OFFLINE_FALLBACK` and says why. Measured on this machine: an EIA call (keyless, so it returns HTTP 403) takes about **0.74 to 0.78 s**; the timeout is 5 s with one retry (worst case about 10.5 s before falling back); results are cached 15 minutes; the browser polls every 10 minutes and backs off 30 s, 60 s ... up to 10 minutes after an error.

**History and holidays.** `/price/history` merges the CSV with EIA data by date (EIA wins when both have a date), never returns a date twice, and drops dates where both prices are blank. EIA leaves a blank value on market holidays; blanks are treated as "no price" and skipped when computing the latest value and the change.

**Keeping the key private.** The key is never in a response, a log line, an exception message or the frontend. `httpx` logs full request URLs at INFO (which would include `api_key=...`), so that logging is switched off and a log-record
filter redacts any `api_key=` value and the key itself from every record. `backend/tests/test_price_feed.py` checks all of this, including a test that proves the leak is real when the protections are removed.

**Demo and screenshots without a key.** `backend/tools/mock_eia_server.py` stands in for EIA (modes: `ok`, `invalid_key`, `error`, `slow`). It is **not EIA and not live**: it serves the six closes (13 to 20 Oct 2026) that EIA's public table showed, so the real adapter can be exercised over real HTTP.
Start it, then run the backend with `EIA_BASE_URL=http://127.0.0.1:8765/v2 EIA_API_KEY=any-dummy-value`. Screenshots of every ticker state are in `docs/m6_screenshots/`, produced by `frontend/e2e/price_ticker.mjs`.
