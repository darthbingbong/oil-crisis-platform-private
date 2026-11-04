# Limitations and future work

Final state at **v1.0** (30 Oct 2026). Everything here was observed or measured in this project, not assumed. Items marked **(to do)** are not built yet.

## 0. What is verified and what is not (one table)

| Item | Status |
|---|---|
| Price formula and the Phase 1 comparison (24 events, 21 used, MAE 13.09 vs 13.80) | **Verified**: `phase1_analysis.py` re-run on 29 Oct 2026. The other experiment rows in `PHASE1_SUMMARY.md` (24.41, 13.77, 13.62, 18.01/18.15) are quoted from the Phase 1 session and were **not re-run** |
| Calculation chain, report numbers, the worked examples | **Verified**: unit and golden tests, a consistency test that every number in a summary matches the payload, and `tools/check_claims.py` (every number in the README, DEMO_SCRIPT and this file rebuilt from the running app) |
| EIA price path, `DAILY_CLOSE` | **Verified live** on 29 Oct 2026 with a real key |
| EIA failure paths (`OFFLINE_FALLBACK`: rejected key, timeout, server error, rate limit) | **Mock only**: exercised against a mock server and mocked transports, not by breaking the real service |
| GDELT route news | **Verified live** (slow, often rate-limited); quality filters tested on real headlines; fallbacks proven by simulated failures |
| **Live AIS feed** | **UNVERIFIED**: no key was available; built from the provider's documentation and tested against a mock transport |
| AISStream terms of service | **Unconfirmed**: the terms page could not be found |
| Three USGS lithium cells (see section 8) | Read from the PDF's text layer and its footnotes on 30 Oct 2026; a person should still compare them with the rendered PDF |
| Frame rates | **Software rendering only** (a lower bound); a real GPU was not measured |
| Keyboard use | Routes yes (hidden list); individual simulated vessels no |

## 1. Route news (GDELT)

| Limitation | What was observed | Effect | What would improve it |
|---|---|---|---|
| **Low recall: only headlines that name the route** | The headline itself must mention the route (or a broad term such as "Houthi" next to a shipping or oil word). On a real Hormuz query GDELT returned 75 raw records, 12 named the route in the headline and 2 survived de-duplication; Bab el-Mandeb went from 22 loosely related headlines to 2. | A relevant story whose headline does not name the route ("Tanker hit off Yemen") is dropped. The panel can show few or no headlines even when there is news. | A better relevance model that reads more than the headline (needs article text, which the project deliberately does not store), or a licensed news feed with entity tagging. |
| **Negation is invisible to the tagger** | "Egypt will **not** attack Yemen" is tagged `attack`. A keyword classifier cannot see negation. It is recorded as a strict expected failure in `backend/tests/test_news_real_headlines.py`, so the suite tells us if it ever starts passing. About 31 of 34 real headlines reviewed by eye were tagged sensibly; "fighting threatens key shipping routes" is `shipping` where `disruption` is arguable. | Occasional wrong tags, always in the direction of over-alarming. | A small language model or a dependency parser for the tag; keep the keyword tagger as the fallback so the panel still works offline. |
| **GDELT latency and rate limits** | From this machine the TLS handshake alone takes about 10 s and a full answer 12 to 15 s. A **cold** first request measured 44.5 s (Bab el-Mandeb) and 68.8 s (a Hormuz request that exhausted its retries); a **warm** one 0.017 to 0.024 s. GDELT answers HTTP 429 ("Please limit requests to one every 5 seconds") often, even when requests are spaced further apart. | The first news view of a route can wait most of a minute, or fail. Mitigations built: generous timeouts, a 15 s wait after a 429, a 60 s retry budget, requests kept at least 6 s apart, a 20 minute cache with a disk copy, stale-while-revalidate (an expired result is shown at once, marked stale, while a refresh runs), and a startup warm-up that fills the cache one route at a time. | A server closer to GDELT, or GDELT's bulk files (GKG) loaded on a schedule instead of live queries. |
| **NewsAPI Developer plan is development-only** | NewsAPI's free plan "may be used for development and testing in a development environment only" and "cannot be used in a staging or production environment (including internally)". It is also limited to 100 requests per day, with a 24 hour article delay and one month of history. | Route news deliberately does **not** use NewsAPI. **The older news-classification pipeline (`backend/news/`) does use a NewsAPI Developer key**; review that before any public or production demo, because it falls outside the plan's terms. | A paid NewsAPI plan, GNews, or remove the older pipeline's live polling and keep its fixtures. |

## 2. Price model

- **Small sample.** The elasticity formula was tested against 21 daily-resolution events (24 in the table; 3 pre-1986 events are annual averages and were excluded). A trained model did not beat it (formula MAE 13.09 pp, model 13.80 pp).
- **`conflict_intensity` is hand-scored and does not enter the price formula** (only supply loss does; intensity is used for the high-intensity caveat and the pulsing ring), and several `supply_loss_pct` values in `events.csv` are informed estimates. The largest one, the 2026 Iran war (8%), is marked "ROUGH ESTIMATE, still unfolding" in the file, so the top of the validated range is itself soft.
- **The elasticity (-0.15) is a borrowed textbook value**, not estimated from this project's data.
- **The formula is linear and was validated only up to 8% supply loss.** A full Hormuz blockade is a 15.5% supply loss and the formula implies about +103%. The Results page marks that part of the curve as beyond the validated range, hides the plus or minus 13.09 pp band ("not validated at this magnitude"), and shows the largest validated event for comparison (+57.8% at 8%). No cap or nonlinear model is applied, by decision.
- **One horizon only (M14).** The price outlook is the 30-day move, `supply loss / 0.15`, because that is the only horizon Phase 1 tested (price 5 days before the event against 30 days after, 21 events; the 90-day formula error was worse, 18.01 pp). The days between 0 and 30 were not measured, so the Results page draws **one marker at day 30 with its error bar and no path**. The earlier hold-then-decay path over 180 days, and the straight line that replaced it for a day, were unvalidated and have been removed; `docs/outlook_validation.md` and `docs/m14_before_after.md` have the record.
- **The price result does not depend on how long the disruption lasts.** The validated formula uses supply loss only, not duration: a 10-day and a 60-day disruption with the same supply loss both give +28.76%. That is a limit of the formula (the 21 events were not split by duration), and the Results page says so next to the number. The duration still drives the barrels displaced, the one-time totals and the economy scaling.
- **Arithmetic and sourced scalings that are not price estimates:** the barrels-displaced chart now ends with the disruption length the user entered; the 1, 3 and 5 year EV horizons are labelled "if the displacement lasted this long (arithmetic, not a forecast)"; the economy section scales the 30-day move, assumed sustained for the days entered, by the IMF rule of thumb and is labelled "sourced estimate" with its source.

## 3. Route data

- **Route geometry is illustrative**, hand-placed for drawing, not surveyed shipping-lane or pipeline coordinates.
- **Voyage days come from a planner, at an assumed speed**: each is a ShipFinder planned sea distance (retrieved 2026-11-02, a one-off snapshot) divided by 14 knots, the project's tanker speed. The distance is sourced, a planned route is not a measured voyage, and real speeds vary. They set the detour result (delivery factor T / (T + detour)); the default Suez detour (14.0 days) is the Cape plan minus the Suez plan. The line geometry on the globe is still illustrative.
- **Importers are known only at region or group level.** EIA publishes destination shares by group (and per country only for China via Malacca and the Cape), so the importer chart is "by region/group", derived shares are marked, several routes have none at all, and reserve cover days are not available. UN Comtrade could give bilateral crude imports but still not by chokepoint.
- **Pipelines carry nameplate capacity, never flow.** No sourced throughput exists, so pipelines cannot be simulated. Druzhba is n/a (about 30 segments, no sourced figure). The CPC capacity is an estimate: the second GEM record is a separate +16 Mt/yr increment (67 + 16 = 83 Mt/yr), but the corroboration is secondary.
- **Hormuz bypass capacity changed between EIA estimates** (4.7, 3.5 and 2.6 Mb/d). The headline uses 4.7 and the Results page shows 2.6 as a labelled sensitivity.
- **Baselines are pre-crisis years.** Suez, Bab el-Mandeb and the Cape use 2023 (the Red Sea attacks halved 2024 flows); everything else uses 2024. EIA reports Hormuz effectively closed in 2026, so results are a what-if from a normal baseline, not a forecast of current flows.

## 4. EVs and lithium

- The sourced lithium case is **NMC-811 only** (0.10 kg Li per kWh, ICCT 2024). LFP, which dominates in China, is not covered by a sourced figure. The page states this caveat beside the lithium chart.
- **The 60 kWh pack is a choice** made from IEA's regional averages (China below 60, EU close to 70, US 90); there is no published global average. The 60 to 90 kWh range is shown.
- The project's own **0.008 t LCE per EV has no source** and is about 4 times lower than the published figure; it is shown for comparison only.
- **500 gallons of gasoline per vehicle-year is a US-style figure**; the global average is lower, so the true EV count would be higher.
- **Lithium availability (default 10%) is a scenario input**, anchored on USGS showing 2025 production (290,000 t Li) above consumption (263,000 t Li) by 27,000 t, about 9% of production, not a forecast of what could be redirected.
- EV counts are a fleet that must be in place to replace the lost fuel permanently, divided by the horizon; a real transition would also change oil demand in other ways.

## 5. Economy and markets

- **Only two macro coefficients have a verified primary source** (IMF Managing Director's speech, 9 March 2026: +0.4 pp global headline inflation and a 0.1 to 0.2% fall in global output per +10% oil, if the rise lasts most of a year; corroborated for inflation by IMF Working Paper 17/196). The IMF gives inflation as a single figure, so no range is drawn around it.
- Oil-importer-specific (MENAP) and World Bank figures that appeared in early search results were **removed** because no primary source could be verified. Sector effects (airlines, energy equities, tanker rates) are qualitative, labelled "no sourced coefficient"; only the derived tanker tonne-mile increase is a number.
- Effects are scaled linearly to the price move and to duration over 365 days (an assumption: the source gives no figure for shorter shocks), and use the central price estimate, so true uncertainty is wider, and beyond the validated range the price itself is an extrapolation.

## 6. Oil price (M6)

- **EIA spot prices are daily closes published weekly**, so the newest point is typically several days old (5 days on 25 Oct 2026) and never fresher than the last Wednesday release. There is no free real-time source in this project, so nothing is labelled LIVE.
- **The offline fallback is 68 days old** (2026-08-18) and far below the real price at the time of writing (WTI 86.48 in the CSV against 107.89 on 20 Oct per EIA's table). The ticker always shows the age and `OFFLINE_FALLBACK`, but a presenter should not read it as a current price.
- **The success path was verified against the real EIA API on 29 Oct 2026** with a real key: HTTP 200, `DAILY_CLOSE`, WTI 103.37 and Brent 123.10 as of 2026-10-27 (2 days old). The reply matched the adapter and the mock (rows of `period`, `series`, string `value`, `units`; `frequency: daily`). Authenticated latency was 2.1 s through the app and 1.7 s for a direct fresh call (the keyless 403 earlier took 0.74 to 0.78 s). The two other statuses (`OFFLINE_FALLBACK` on a rejected key, a timeout or a server error) were only exercised against the mock server and mocked transports, not by breaking the real service.
- **EIA's rate limits are not published as numbers** in the API documentation, so the server caches for 15 minutes and the browser polls every 10.
- The header's **MODEL BASELINE price is a simulation**: a hand-set seed of $82.50 moved by up to 2% per classified news headline, drifting back to the seed. It is unrelated to the EIA series next to it (on 25 Oct 2026 it read $92.94 while EIA's latest close was WTI 107.89). It was renamed from "SIM CRUDE" and its hover text gives the source and date, but the two numbers can still look contradictory side by side.
- **WTI and Brent change** is computed between the two newest published closes, which can be several days apart across a weekend or a holiday.

## 7. Vessels and AIS (M7)

- **Simulated vessels are an illustration, not data.** They run at a constant 14 knots on illustrative route lines, with time compressed to 6 simulated hours per second, and the number per lane is cosmetic. They are never used in any result or route statistic.
- **The AIS adapter is unverified against the live feed.** No AISStream key was available. It follows the provider's documentation and the field names of its published OpenAPI definition, and is tested against a mock transport only. The `ShipStaticData` field names (`Type`, `Destination`, `MaximumStaticDraught`, `Name`) are not on the documentation page itself; they come from the provider's model repository. The first run with a real key should be checked, and `VERIFIED_AGAINST_LIVE_FEED` flipped only afterwards.
- **A vessel appears only after its static message is seen**, because position reports carry no ship type. Right after startup the map can be empty for several minutes.
- **AIS limits** (coverage gaps, transponders off, unreliable destination, free-tier limits, no cargo information) are listed in the README and the in-app info tooltip. AISStream states there is no SLA or uptime guarantee. Its terms of service page could not be found (a request to `/terms` returned 404), so the permitted uses (for example redistribution on a public site) are **not confirmed**.
- **Flags come from the MMSI prefix** using a short table of common tanker registries; other prefixes show "not reported". This is the claimed registry, not a verified one.
- **Individual vessels cannot be selected by keyboard.** (Routes can: Tab to the hidden route list and press Enter.) The simulated vessels carry no information that is not in the info tooltip.
- **Clicking a vessel needs zoom or Shift**, because vessels sit on route lines that are also clickable. Alt-click selects the route.
- **Performance numbers are from software rendering.** A real GPU should do better, but that has not been measured.

## 8. Data check: the three USGS lithium cells

`backend/data/lithium_usgs.json` was built from the USGS *Mineral Commodity Summaries 2026: Lithium* PDF. Its text layer glues each table footnote digit onto the number next to it, so three cells (and the two world totals) read wrongly if taken literally. On 30 Oct 2026 the PDF was downloaded again and its text and footnotes read directly:

| Cell | The PDF text reads | Footnote glued on | **Stored value** |
|---|---|---|---|
| Argentina, mine production 2024 | `513,800` | 5 = "Reported." | **13,800 t Li** |
| Chile, mine production 2024 | `548,900` | 5 = "Reported." | **48,900 t Li** |
| Australia, reserves | `68,400,000` | 6 = "For Australia, Joint Ore Reserves Committee-compliant or equivalent reserves were 5.1 million tons." | **8,400,000 t Li** |
| World total, 2024 and 2025 (not stored as cells) | `8222,000` and `8290,000` | 8 = "Excludes U.S. production." | 222,000 and 290,000 t Li |

The literal readings are impossible (Argentina or Chile alone would exceed the world total of 222,000 t; Australia's reserves would exceed the world's 37 Mt). Sum checks on the stored values: nine producers' 2024 production 222,970 t against the USGS rounded 222,000 t; 2025 production 288,380 t against 290,000 t; reserves 36.47 Mt against 37 Mt. Neighbouring cells stored for comparison: Argentina 2025 = 23,000; Chile 2025 = 56,000; Australia 2024 = 82,700 and 2025 = 92,000. This is a reading of the PDF's text layer, **not** a look at the rendered page: please compare these three cells with the PDF.

## 9. Corrections made by the final audits (M8 and M9)

- The historical events chart had silently become a chart of 335 events (24 real plus about 311 simulated news rows) with an unreadable axis; `/api/v1/conflicts` now returns only the real events by default.
- "2025 production exceeded consumption by only about 9%" was imprecise (27,000 t is about 9% of production but 10.3% of consumption); every occurrence now states the 27,000 t and what it is a share of.
- Price-chart labels crossed by their own reference lines, a route-panel footer that let text show through its buttons, and 9 px text were fixed.
- `/api/v1/health` (in the master prompt) was missing and was built.

## 10. Not built yet

- **(to do)** A print-friendly or PDF version of the Results page.
- **(to do)** Run the AIS adapter with a real key, check it against the provider's actual frames, confirm the provider's terms, then flip `VERIFIED_AGAINST_LIVE_FEED`.
- **(to do)** Measure frame rate on a real GPU.
- **(to do)** Replace the older NewsAPI pipeline's live polling (or move to a paid plan) before any public deployment.
- **(to do)** Break the real EIA service on purpose (a rejected key against the real endpoint) to check the fallback end to end.

## 11. The 2D map (M11): measured limits

- **Dragging the map is slow on software rendering.** With every layer on, the map holds about 71 fps (zoom 2) and 97 fps (zoom 5.5) while vessels move, but dragging it runs at about 6.5 fps with a worst frame near 0.7 s (`docs/m11_screenshots/map_fps.txt`). Every camera move redraws the country outlines; the static outlines sit on their own canvas so that moving vessels never redraw them, and the coarsest outline level is used while the camera moves. This was measured in Chromium with software WebGL (SwiftShader), which is a lower bound; a real GPU was not measured (still on the to-do list above).
- **Country outlines are simplified** at three zoom levels (Douglas-Peucker, tolerances 0.2, 0.05 and 0.01 degrees) from the bundled Natural Earth 1:50m file. At the highest zoom the coastline is the 1:50m shape, not a survey.
- **The real-tanker groups are two samples, not coverage**: eight tankers near Huelva (seen 2026-11-03 15:58 UTC) and four in the Strait of Malacca (seen 16:13 to 16:28 UTC). Three of the four Malacca positions come from the Vessels Nearby sample, not from Vessel Position. No tanker was found near Hormuz or Fujairah.
- **The slow drag goes on the M15 polish list** (owner, 2026-11-04). M12 did not change it: with a vessel selected and its track drawn on the static canvas, frame rates with all layers on were 78 fps (zoom 2) and 114 fps (zoom 5.5).

## 12. Real vessels (M12): limits

- **Saved, not live.** Every real tanker is a snapshot taken on 2026-11-03; the key expires on 2026-11-13 and the app then makes no AIS call. The final refresh of all 12 positions is planned for 2026-11-08 to 11-10 (`prewarm_ais.py final-snapshot`).
- **Provider search returns no position or ship type**, so a provider hit that is not already in the watchlist cannot be shown on a map.
- **Tracks:** three saved 7-day tracks only (OIZMENDI, MUHUT SILVER, CAPE ANN). No Malacca tanker has one: all four were stopped, so no load was spent on them.
- **The "vessels near this vessel" lists are two saved 10 nm samples** around FRONT ALTAIR (Huelva) and SINGAPORE ENERGY (Malacca). Nothing here counts vessels at a chokepoint; ports and a scenario-exposure count were not built (DECISIONS D1, D2, D24).
- **On the globe at the default zoom the 8 Huelva tankers are one dot** (they sit within a few nautical miles); the search box or a zoom separates them.

## 13. Markets panel (M13): limits

- **We never see the TradingView prices.** They are drawn by TradingView's own free widget in an iframe, so no "as of" time, no delay figure and no saved fallback number can be shown; TradingView says stock data is delayed (without naming the delay) and forex is real time. The chip says so and nothing is labelled LIVE.
- **Several rows are broker CFD quotes** (S&P 500, Dow, Nasdaq 100, FTSE 100, Nikkei 225, Hang Seng, VIX, natural gas, copper, dollar index), not official index levels or exchange prices. They are marked CFD on screen. Gold and silver (TVC), DAX (XETR) and Sensex (BSE) are TradingView's own or exchange feeds, still delayed as TradingView states.
- **Not available for free:** Nasdaq Composite and Nifty 50 returned "no data" in the widget on 2026-11-04 (the Nasdaq 100 and the Sensex stand in); **lithium prices** have no free source and are not shown. A symbol that TradingView later withdraws would show its own "no data" row.
- **WTI and Brent are EIA daily closes in a weekly release**, so they are about a week old (8 days on 2026-11-04) next to widget rows that are about a day old. The two ages are not comparable and are labelled separately.
- **The WTI scenario number is the plain formula on a stale base:** last EIA close times (1 + supply loss / 0.15 as a percentage). Inside 8% supply loss it carries the measured +/- 13.09 pp; beyond it, none. It is a model scenario, not a forecast, and it is switched off when the EIA price is the saved fallback.
- **The visitor's browser contacts TradingView** once the panel has been scrolled to. TradingView's pages say it tracks the embedding page URL and the symbol; they do not say whether commercial use is allowed. Alpha Vantage was tested (8 calls on 2026-11-04) and not used: its free key is "personal, non-commercial use" with nothing on public display, and index data needs a paid plan.
- **Frame rate:** with all three widgets mounted the 2D map still ran at 87 to 103 fps (zoom 2) on software rendering; the measurement varies by about 20 percent between runs.
