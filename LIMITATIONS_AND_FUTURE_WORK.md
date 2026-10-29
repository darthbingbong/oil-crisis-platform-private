# Limitations and future work

Started in Milestone 5 and extended as later milestones land. Everything here was observed or measured in this project, not assumed.
Items marked **(to do)** are not built yet.

## 1. Route news (GDELT)

| Limitation | What was observed | Effect | What would improve it |
|---|---|---|---|
| **Low recall: only headlines that name the route** | The headline itself must mention the route (or a broad term such as "Houthi" next to a shipping or oil word). On a real Hormuz query GDELT returned 75 raw records, 12 named the route in the headline and 2 survived de-duplication; Bab el-Mandeb went from 22 loosely related headlines to 2. | A relevant story whose headline does not name the route ("Tanker hit off Yemen") is dropped. The panel can show few or no headlines even when there is news. | A better relevance model that reads more than the headline (needs article text, which the project deliberately does not store), or a licensed news feed with entity tagging. |
| **Negation is invisible to the tagger** | "Egypt will **not** attack Yemen" is tagged `attack`. A keyword classifier cannot see negation. It is recorded as a strict expected failure in `backend/tests/test_news_real_headlines.py`, so the suite tells us if it ever starts passing. About 31 of 34 real headlines reviewed by eye were tagged sensibly; "fighting threatens key shipping routes" is `shipping` where `disruption` is arguable. | Occasional wrong tags, always in the direction of over-alarming. | A small language model or a dependency parser for the tag; keep the keyword tagger as the fallback so the panel still works offline. |
| **GDELT latency and rate limits** | From this machine the TLS handshake alone takes about 10 s and a full answer 12 to 15 s. A **cold** first request measured 44.5 s (Bab el-Mandeb) and 68.8 s (a Hormuz request that exhausted its retries); a **warm** one 0.017 to 0.024 s. GDELT answers HTTP 429 ("Please limit requests to one every 5 seconds") often, even when requests are spaced further apart. | The first news view of a route can wait most of a minute, or fail. Mitigations built: generous timeouts, a 15 s wait after a 429, a 60 s retry budget, requests kept at least 6 s apart, a 20 minute cache with a disk copy, stale-while-revalidate (an expired result is shown at once, marked stale, while a refresh runs), and a startup warm-up that fills the cache one route at a time. | A server closer to GDELT, or GDELT's bulk files (GKG) loaded on a schedule instead of live queries. |
| **NewsAPI Developer plan is development-only** | NewsAPI's free plan "may be used for development and testing in a development environment only" and "cannot be used in a staging or production environment (including internally)". It is also limited to 100 requests per day, with a 24 hour article delay and one month of history. | Route news deliberately does **not** use NewsAPI. **The older news-classification pipeline (`backend/news/`) does use a NewsAPI Developer key**; review that before any public or production demo, because it falls outside the plan's terms. | A paid NewsAPI plan, GNews, or remove the older pipeline's live polling and keep its fixtures. |

## 2. Price model

- **Small sample.** The elasticity formula was tested against 21 daily-resolution events (24 in the table; 3 pre-1986 events are annual averages and were excluded). A trained model did not beat it (formula MAE 13.09 pp, model 13.80 pp).
- **`conflict_intensity` is hand-scored** and several `supply_loss_pct` values in `events.csv` are informed estimates. The largest one, the 2026 Iran war (8%), is marked "ROUGH ESTIMATE, still unfolding" in the file, so the top of the validated range is itself soft.
- **The elasticity (-0.15) is a borrowed textbook value**, not estimated from this project's data.
- **The formula is linear and was validated only up to 8% supply loss.** A full Hormuz blockade is a 15.5% supply loss and the formula implies about +103%. The Results page marks that part of the curve as beyond the validated range, hides the plus or minus 13.09 pp band ("not validated at this magnitude"), and shows the largest validated event for comparison (+57.8% at 8%). No cap or nonlinear model is applied, by decision.
- **The 180 day trajectory shape is an assumption**: the price is held at its peak while the disruption lasts, then decays exponentially with a half-life of half the duration, clamped to 7 to 60 days.

## 3. Route data

- **Route geometry is illustrative**, hand-placed for drawing, not surveyed shipping-lane or pipeline coordinates.
- **Voyage days are estimates**: great-circle distance over those illustrative waypoints at 14 knots, so they are lower bounds. They set the detour result (delivery factor T / (T + detour)), and the default Suez detour (12.7 days) is derived the same way.
- **Importers are known only at region or group level.** EIA publishes destination shares by group (and per country only for China via Malacca and the Cape), so the importer chart is "by region/group", derived shares are marked, several routes have none at all, and reserve cover days are not available. UN Comtrade could give bilateral crude imports but still not by chokepoint.
- **Pipelines carry nameplate capacity, never flow.** No sourced throughput exists, so pipelines cannot be simulated. Druzhba is n/a (about 30 segments, no sourced figure). The CPC capacity is an estimate: the second GEM record is a separate +16 Mt/yr increment (67 + 16 = 83 Mt/yr), but the corroboration is secondary.
- **Hormuz bypass capacity changed between EIA estimates** (4.7, 3.5 and 2.6 Mb/d). The headline uses 4.7 and the Results page shows 2.6 as a labelled sensitivity.
- **Baselines are pre-crisis years.** Suez, Bab el-Mandeb and the Cape use 2023 (the Red Sea attacks halved 2024 flows); everything else uses 2024. EIA reports Hormuz effectively closed in 2026, so results are a what-if from a normal baseline, not a forecast of current flows.

## 4. EVs and lithium

- The sourced lithium case is **NMC-811 only** (0.10 kg Li per kWh, ICCT 2024). LFP, which dominates in China, is not covered by a sourced figure. The page states this caveat beside the lithium chart.
- **The 60 kWh pack is a choice** made from IEA's regional averages (China below 60, EU close to 70, US 90); there is no published global average. The 60 to 90 kWh range is shown.
- The project's own **0.008 t LCE per EV has no source** and is about 4 times lower than the published figure; it is shown for comparison only.
- **500 gallons of gasoline per vehicle-year is a US-style figure**; the global average is lower, so the true EV count would be higher.
- **Lithium availability (default 10%) is a scenario input**, anchored on USGS showing 2025 production only about 9% above consumption, not a forecast of what could be redirected.
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
- The header's **"SIM CRUDE" price is a simulation driven by classified news** and is unrelated to the EIA series next to it (it read about $93 while EIA's latest close was $107.89). Both are labelled, but they can look contradictory side by side.
- **WTI and Brent change** is computed between the two newest published closes, which can be several days apart across a weekend or a holiday.

## 7. Vessels and AIS (M7)

- **Simulated vessels are an illustration, not data.** They run at a constant 14 knots on illustrative route lines, with time compressed to 6 simulated hours per second, and the number per lane is cosmetic. They are never used in any result or route statistic.
- **The AIS adapter is unverified against the live feed.** No AISStream key was available. It follows the provider's documentation and the field names of its published OpenAPI definition, and is tested against a mock transport only. The `ShipStaticData` field names (`Type`, `Destination`, `MaximumStaticDraught`, `Name`) are not on the documentation page itself; they come from the provider's model repository. The first run with a real key should be checked, and `VERIFIED_AGAINST_LIVE_FEED` flipped only afterwards.
- **A vessel appears only after its static message is seen**, because position reports carry no ship type. Right after startup the map can be empty for several minutes.
- **AIS limits** (coverage gaps, transponders off, unreliable destination, free-tier limits, no cargo information) are listed in the README and the in-app info tooltip. AISStream states there is no SLA or uptime guarantee. Its terms of service page could not be found (a request to `/terms` returned 404), so the permitted uses (for example redistribution on a public site) are **not confirmed**.
- **Flags come from the MMSI prefix** using a short table of common tanker registries; other prefixes show "not reported". This is the claimed registry, not a verified one.
- **Clicking a vessel needs zoom or Shift**, because vessels sit on route lines that are also clickable. Alt-click selects the route.
- **Performance numbers are from software rendering.** A real GPU should do better, but that has not been measured.

## 8. Not built yet

- **(to do)** A print-friendly or PDF version of the Results page.
