# Demo script: 7 minutes for a professor

> **Generated, not typed.** Every number below was produced by the running API on 2026-11-04 by `backend/tools/make_demo_script.py` (it calls `/api/v1/simulate/report`, `/api/v1/price/live`, `/api/v1/vessels/watchlist` and the saved track endpoint, and reads `backend/services/config.py`). Re-run it if you change anything: `cd backend ; python tools\make_demo_script.py`. Two things change on their own: the ticker figures (daily) and the AIS key line (it counts down to the expiry); say the dates aloud on the day. The TradingView rows are not in this script because this app never sees those prices.

**The one-sentence pitch.** "You pick a route on a map or a globe, blockade it or force a detour, and the app gives the 30-day price impact from a formula I can do by hand, then how many electric cars and how much lithium it would take to replace the lost oil, with every assumption on the page."

## Before you start (3 minutes, an hour before)

1. Start both servers (see the README quick start). Open <http://127.0.0.1:8000/api/v1/health> and read it: `price` should be `ok` (EIA answered) or you will present `OFFLINE_FALLBACK` knowingly; the AIS line should say `AIS key expires in N days` or `AIS key expired, showing data saved on <date>`; either is correct.
2. Warm the news cache: `cd backend ; python tools\prewarm_news.py --snapshot` (5 to 15 minutes). Do not start the backend and this script at the same moment.
3. Open <http://localhost:5173> in a full-screen window, laptop width or wider, with internet access (the Markets panel loads from TradingView). Have the Results page for Suez ready in a second tab: `http://localhost:5173/results?route=suez&type=detour&detour=20&dur=60&conf=5&dem=0&ev=100&li=10&horizon=5`.
4. Backup: `docs/m15_screenshots/` holds a screenshot of every step below. If everything fails, present from those.

## The 7 minutes

### 0:00 to 0:45. The dashboard and what is real on it

- **Say:** "Top bar: WTI and Brent from the EIA API. The badge says DAILY_CLOSE. WTI 103.37 and Brent 123.10 dollars a barrel, as of 2026-10-27, 8 days old (figures at the time this script was generated). It is a daily close published weekly, so I never call it live."
- **Point at** the amber **SIMULATED VESSELS** badge and the **WTI BASELINE** price in the header: "Those tankers are not real ships; the badge says so. The baseline is the same EIA close as the ticker, with its date: it is the starting price of the WTI scenario card, and hovering shows its source."
- **Point at** the **Markets** panel (right column, scroll down) but do not dwell yet: "I come back to this."

### 0:45 to 1:45. Globe to map, a route and its evidence

- **Do:** press **MAP** in the top bar. "Same data, same selection, easier to read: Natural Earth outlines bundled with the app, no map server." Open the **Layers** panel and show the counts and the status chips. Drag the map and zoom with the wheel.
- **Do:** click the Suez route (or Tab to the route list and press Enter). **Say:** "Suez and SUMED carried 8.8 Mb/d in 2023, from the EIA. I use 2023 because 2024 was halved by the Red Sea attacks." Show the **Current conditions** note: "Real 2026 conditions differ, so these are what-ifs from a normal year, not forecasts."
- **Show** "Recent news": headline, source, date, link, nothing else. If it says STALE or DEMO SNAPSHOT, say so: "That badge is the app being honest that the feed is slow or down."
- **Mention:** the address now carries the view, camera, layers and selection, so a link restores exactly this screen.

### 1:45 to 2:45. One real vessel, with its saved track

- **Do:** type **muhut** in the search box (it searches the saved vessels only; the provider is asked only if you press the button) and open **MUHUT SILVER**.
- **Point at** the badge: "SNAPSHOT 2026-11-03 15:58 UTC · 12 REAL TANKERS. It is a snapshot, not live: AIS key expires in 9 days (2026-11-13). After that date the app says so and makes no AIS calls." Point at the vessel panel: name, MMSI, flag, type, speed, course, destination, draught, "last seen", and **"cargo type not confirmed by AIS"**.
- **Point at** the teal line: "past track, fetched at 2026-11-03 16:11 UTC", **HEADLINE TRACK**, 846.5 nm sailed, 658.9 nm start to end. "It shows where one ship was last week. It does not say what it carries."
- **Say:** "The twelve real tankers are two samples, near Huelva and in the Strait of Malacca. I could not place a tanker at Hormuz. The 'vessels near this vessel' list is a saved 10-nautical-mile sample around one ship, not traffic at a chokepoint, and chokepoint traffic stays simulated and labelled." Switch **GLOBE** and **MAP**: same panel, same track.

### 2:45 to 3:30. The Markets panel

- **Do:** open **Commodities**. **Say:** "WTI and Brent are my own cards from the EIA feed: `DAILY_CLOSE`, with the date and its age. Everything else here, indices, gold, silver, natural gas, copper and FX, is TradingView's free widget, and the chip says so: *Via TradingView widget, delay set by TradingView*. I never see those prices, so I cannot put a time on them, and I never call them live." Hover the **?** to read TradingView's own delay wording.
- **Do:** tick **Show the 30-day scenario on the WTI card**. "Only the WTI card has a scenario number: the last EIA close times the same 30-day formula. With the dashboard's default 5% supply loss that is **$137.82** (+33.3%), range $124.29 to $151.35, badge `VALIDATED 30 DAYS`." Drag the supply-loss slider past 8%: "the badge flips to `OUTSIDE VALIDATED RANGE` and the range disappears."
- **Say if asked:** rows marked CFD are broker quotes that track the index closely, not the official level; Nasdaq Composite, Nifty and lithium prices are not shown because no free source gave them. There are no cross-asset estimates anywhere in this app.

### 3:30 to 4:30. The worked example: a 20-day Suez detour

- **Do:** choose **Detour**, press **Simulate disruption on this route**, set **20 days** and a **60-day** duration, then **Run full simulation**. (Or open the prepared tab.)
- **Say:** "Ships avoid the canal and go round the Cape. With a fixed tanker fleet, a longer trip means fewer deliveries."
- **If you notice the URL says `conf=6`:** the dashboard's conflict-intensity slider defaults to 6 and the prepared link uses 5. It changes **no number** here, because the price formula uses supply loss only. Say that if asked.
- **KPIs on screen:** 30-day price impact **+28.8%** with the badge **VALIDATED 30 DAYS (≤ 8% supply loss)**, barrels displaced **4,455,696**, EVs required **63.4 million**, extra lithium **2.03 Mt**, deficit **1.25 Mt**.
- **Point at the price chart:** "One value, the 30-day move, with its ±13.09 percentage point error bar. The formula gives one number at one horizon, so I draw no path and no other horizon. And note the sentence beside it: the validated formula uses supply loss only, not duration. A 10-day and a 60-day disruption with the same supply loss give the same +28.8%."

### 4:30 to 5:30. The arithmetic, by hand (this is the credibility moment)

| Step | Working | Result |
|---|---|---|
| Flow through Suez + SUMED (EIA, 2023) | given | **8,800,000 bpd** |
| Normal voyage length T | distance of the drawn route / 14 knots | **19.5 days** |
| Delivery factor with a fixed fleet | T / (T + detour) = 19.5 / (19.5 + 20) | **0.493671** |
| Barrels displaced per day | 8,800,000 x (1 - 0.493671) | **4,455,696 bpd** |
| Supply loss | 4,455,696 / 103,300,000 world supply | **4.313%** |
| Price impact over 30 days | supply loss / 0.15 (elasticity) = 4.313 / 0.15 | **+28.8%** (± 13.09 pp) |
| EVs to offset the lost fuel | 4,455,696 x 19.5 gal/bbl x 365 / 500 gal per vehicle-year | **63,426,835** |
| Lithium per EV | 0.10 kg Li/kWh x 60 kWh x 5.323 (LCE per Li) / 1000 | **0.031938 t LCE** |
| Lithium required | 63,426,835 x 0.031938 | **2,025,726 t LCE** |
| Supply cap over 5 years | 10% x 1,543,670 t LCE (2025 world output) x 5 years | **771,835 t** |
| Deficit | required - cap = 2,025,726 - 771,835 | **1,253,891 t LCE** |
| One-time transit gap | flow x detour days = 8,800,000 x 20 | **176,000,000 barrels** |

*Rounding note: the app carries unrounded values (barrels displaced is 4,455,696.20), so a hand calculation from the rounded figures above can differ in the last digits (for example 63,426,833 EVs by hand against 63,426,835 on screen). Say so if someone checks.*

- **Say:** "Every row is either a source, a formula, or an assumption the page flags. The price is the one number I validated, against 21 historical events, 30 days after each: the formula's average error is 13.09 percentage points."
- **If asked about the EV horizons and the economy section:** "The 1, 3 and 5 year EV figures are labelled 'if the displacement lasted this long (arithmetic, not a forecast)'. The economy section scales a cited IMF rule of thumb and is labelled a sourced estimate."

### 5:30 to 6:15. Hormuz: where the formula stops being validated

- **Do:** open `http://localhost:5173/results?route=hormuz&type=blockade&share=100&dur=30&conf=8&dem=0&ev=100&li=10&horizon=5` (or use the Hormuz route with a **blockade**, 100% blocked, 30 days).
- **Say:** "A full blockade removes 20.7 Mb/d, less 4.7 Mb/d that can go round by pipeline, so 16 Mb/d: 15.5% of world supply."
- **Point at the red badge and warning.** "The badge says `OUTSIDE VALIDATED RANGE`. The linear formula says **+103%**. But I only validated it up to 8% supply loss, where the formula gave +53.3%. Past that the marker is red, the error bar is gone ('not validated at this magnitude'), and the green dashed line is the 2026 war, **+57.8%** actual, itself a soft figure still unfolding. I show the number because the formula gives it; I do not claim it is a forecast."
- **Point at** the bypass sensitivity: "EIA's bypass capacity estimate moved from 4.7 to 2.6 Mb/d; the shaded band shows both."

### 6:15 to 7:00. The close

- **Do:** back on the dashboard with the Suez scenario active, show the **SIMULATED** vessels on the Suez lane glide onto the Cape lane (amber). Click one (zoom in first): every field it lacks says "simulated", and the panel ends "cargo type not confirmed by AIS".
- **Say:** "AIS has real limits whatever the provider: coverage gaps, ships that switch the transponder off, destinations typed by the crew, and it never says what a tanker carries."
- **Close:** "What I would trust: the chain of arithmetic and the sources. What I would not: any single price number at extreme shocks, or the lithium figure beyond NMC batteries. All of it is in the Limitations file."

## Questions you may be asked, and honest answers

**"Twenty-one events is a tiny sample. Why believe the formula?"** I do not claim it is accurate; I claim it is **transparent and not beaten**. I tested a trained model with leave-one-out validation against it: formula error 13.09 pp, model 13.80 pp. With 21 events and four features there is not enough signal to justify replacing theory. The ±13.09 pp bar on the chart is that error, so the chart shows how wrong it has been, not a guess.

**"Does the price change if the disruption lasts longer?"** Not in this model, and the Results page says so next to the price. The validated formula uses **supply loss only, not duration**: it was tested on the price 30 days after each event, against that event's supply loss. A 10-day and a 60-day Suez detour with the same supply loss both give **+28.8%**. Duration does change the barrels lost, the totals and the economy scaling, but not the price figure. That is a limitation of the evidence (21 events, not split by duration), not a claim that duration is irrelevant in the real world.

**"Why only 30 days?"** Because that is the only horizon I tested. I also looked at 90 days and the formula was worse (error 18.01 pp), and I never tested a week or a year, so the app shows no price for those. An earlier version drew a decaying path over 180 days; nothing validated it, so I removed it.

**"Where does -0.15 come from?"** It is a **borrowed textbook short-run demand elasticity**, not estimated from my data. It is the biggest single assumption in the price number: if the true value were -0.10 the price effects would be 1.5 times larger, and at -0.30 half as large.

**"How was `conflict_intensity` scored?"** By hand, 0 to 10, for the 24 historical events, and several `supply_loss_pct` values are informed estimates too (the 2026 war is marked a rough estimate, still unfolding). `conflict_intensity` is an input I keep for context; it **does not change the price formula** (supply loss alone does). That is a limitation of the dataset.

**"What happens at extreme shocks?"** The formula is linear, validated to 8% supply loss. A Hormuz blockade is 15.5% and the linear answer is +103%. Real prices would likely behave non-linearly (demand destruction, reserve releases, rerouting), so the app flags it as outside the validated range and does not cap it; capping would be invented precision in the other direction.

**"Is that vessel data real?"** The twelve tankers in the 'real' layer are **real positions saved from the provider on 2026-11-03**, labelled SNAPSHOT with their time, never live, and never counted as traffic. The traffic on the lanes is **simulated** and carries a permanent badge. The provider's key expires on 2026-11-13; afterwards the app makes no AIS call and says "AIS key expired, showing data saved on <date>". An older adapter for the AISStream feed was written to its documentation and never run live. AIS limits: coverage gaps away from coasts, vessels that turn their transponder off (especially around the Gulf), destination fields typed in by the crew, tiny provider quotas (the console did not count the unmetered calls, so our own call log is the record), and no cargo information at all.

**"Why are some market rows marked CFD, and where is the Nasdaq Composite?"** Those rows are broker quotes (FOREXCOM, OANDA, CAPITALCOM) delivered by TradingView's free widget; they track the index or commodity closely but are not the official level. TradingView's free widget returned no data for the Nasdaq Composite and the Nifty 50, so they are not shown (the Nasdaq 100 and the Sensex stand in), and lithium has no free price source. I do not make any estimate for indices, commodities or FX.

**"Why is the ticker a few days old, and the markets rows not?"** EIA's spot prices are daily closes **published in a weekly release**, so the newest point is never fresher than the last Wednesday release; I label it `DAILY_CLOSE` with its age and never call it live. The TradingView rows come from a different, delayed source that I do not see, which is why they carry a different chip and no time.

**"You used NewsAPI?"** Route news uses **GDELT**, not NewsAPI, precisely because NewsAPI's free Developer plan is for development and testing only. An *older* part of the project (the simulated model-baseline price and alert feed) still polls NewsAPI with a Developer key; that is outside the plan's terms for a public or production deployment, and it is switched off before any public hosting.

**"Why does the lithium number change so much?"** Because the per-EV figure is an assumption. The sourced case is **0.031938 t LCE per EV** (0.10 kg Li/kWh from ICCT for NMC-811 cathodes, a 60 kWh pack from IEA's regional averages, 5.323 to convert lithium to carbonate equivalent). It does not cover LFP batteries, which dominate in China. My original 0.008 t per EV had no source and is about 4.0 times lower; I kept it only as a comparison line. A larger EU or US pack raises the requirement to 3.04 Mt.

**"What is the 10% lithium availability?"** A scenario input, not a forecast. USGS shows 2025 production (290,000 t of lithium) exceeded consumption (263,000 t) by 27,000 t, about 9% of production, so very little output is spare. Change it on the Results page and the deficit moves.

**"Why does the news panel sometimes say STALE or DEMO SNAPSHOT?"** GDELT is free but slow (10 to 60 seconds here) and often refuses requests. The panel shows the last good result with its original time (STALE) or, failing that, a saved copy of real headlines with the date it was fetched (DEMO SNAPSHOT). It is never presented as live.

## If something fails on the day (fallback plan)

| What fails | What you will see | What to do |
|---|---|---|
| **The AIS key has expired** (from 2026-11-13) | A red banner "AIS key expired, showing data saved on 2026-11-03"; every real vessel is a saved position; no AIS call is made | This is the designed state, not an error. Say it plainly and present the saved vessels and the saved track |
| **The AIS quota is used up, or the provider is down or refuses a call** | The provider search says so in plain words ("no match", "limit", or a pause with its reason); the saved vessels, tracks and samples keep working | Do not press the provider search button again. Present from the saved data |
| **AIS key absent or `AIS_ENABLED=0`** | The real-tanker layer shows the saved snapshot or, with no snapshot, only the `SIMULATED VESSELS` badge | Expected; you were never relying on it |
| **GDELT is down or slow** | Route news says STALE, DEMO SNAPSHOT, or "unavailable" (only 4 of 14 routes have a snapshot: Hormuz, Bab el-Mandeb, Suez, East-West) | Say what the badge means and move on: news is context, not part of any number. Click Hormuz, Bab el-Mandeb or Suez for the best chance of headlines. Run `prewarm_news.py --snapshot` beforehand to refresh |
| **TradingView cannot load (blocked network or no internet)** | The Markets tab says "Widget unavailable" and shows no numbers; the WTI and Brent cards still work | Say that those rows come from TradingView in the browser and the venue blocks it; nothing is estimated in their place |
| **EIA is down, the key is missing, or the key is rejected** | Ticker badge `OFFLINE_FALLBACK`, red, with an age of weeks and a sentence saying why (the CSV's last row is 2026-08-18); the WTI scenario toggle switches itself off | Say it plainly: "this is the last row of a local file, not today's price." Do not read it as current. Nothing else depends on it |
| **The network is down entirely** | Ticker `OFFLINE_FALLBACK`; news from cache or snapshot; Markets rows unavailable; saved vessels still shown | The simulation, Results page, routes, saved vessels, lithium and economy sections need no network and no key. Present normally and say which panels are offline |
| **The backend crashes or is not running** | The dashboard says "OFFLINE" / "Price feed unavailable" and the Results page shows an offline message | Restart: `cd backend ; .\venv\Scripts\Activate.ps1 ; python -m uvicorn main:app --port 8000`, wait about 10 seconds, reload. Check `/api/v1/health` |
| **The globe or map is slow, or WebGL fails** | Low frame rate on integrated graphics | Close other tabs. The Results page does not use WebGL, so go there and present from the charts |
| **Everything fails** | | Present from `docs/m15_screenshots/` (one screenshot per step above) and the Results URL printed in this script; the arithmetic table above works on paper |
