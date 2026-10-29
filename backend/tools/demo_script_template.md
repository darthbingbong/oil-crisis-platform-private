# Demo script: 5 minutes for a professor

> **Generated, not typed.** Every number below was produced by the running API on @@generated_on@@ by `backend/tools/make_demo_script.py` (it calls `/api/v1/simulate/report` and reads `backend/services/config.py`). Re-run it if you change anything: `cd backend ; python tools\make_demo_script.py`. The ticker figures are the one thing that changes daily; say the as-of date aloud on the day.

**The one-sentence pitch.** "You pick a route on the globe, blockade it or force a detour, and the app gives the price impact from a formula I can do by hand, then how many electric cars and how much lithium it would take to replace the lost oil, with every assumption on the page."

## Before you start (2 minutes, an hour before)

1. Start both servers (see the README quick start). Open <http://127.0.0.1:8000/api/v1/health> and read it: `price` should be `ok` (EIA answered) or you will present `OFFLINE_FALLBACK` knowingly; `ais` will say `fallback` unless you added a key (that is correct: vessels are simulated).
2. Warm the news cache: `cd backend ; python tools\prewarm_news.py --snapshot` (5 to 15 minutes). Do not start the backend and this script at the same moment.
3. Open <http://localhost:5173> in a full-screen window, laptop width or wider. Have the Results page for Suez ready in a second tab: `@@suez_url@@`.
4. Backup: `docs/m9_screenshots/` holds a screenshot of every step below. If everything fails, present from those.

## The 5 minutes

### 0:00 to 0:45. The dashboard and what is real on it

- **Say:** "Top bar: WTI and Brent from the EIA API. The badge says @@ticker_status@@. @@ticker_say@@ It is a daily close published weekly, so I never call it live."
- **Point at** the amber **SIMULATED VESSELS** badge and the **MODEL BASELINE** price in the header: "Those tankers are not real ships and that price is a simulation. Both are labelled, and neither feeds any result."
- **Point at** the history chart: "24 real events since 1973. This is the data the price formula was tested on."

### 0:45 to 1:30. A route and its evidence

- **Do:** open the Suez route (click it zoomed in with **Alt**-click, or Tab to the route list and press Enter).
- **Say:** "Suez and SUMED carried @@suez_flow_mbd@@ Mb/d in 2023, from the EIA. I use 2023 because 2024 was halved by the Red Sea attacks." Show the **Current conditions** note: "Real 2026 conditions differ, so these are what-ifs from a normal year, not forecasts."
- **Show** "Recent news": headline, source, date, link, nothing else. If it says STALE or DEMO SNAPSHOT, say so: "That badge is the app being honest that the feed is slow or down."

### 1:30 to 2:30. The worked example: a 20-day Suez detour

- **Do:** choose **Detour**, press **Simulate disruption on this route**, set **20 days** and a **60-day** duration, then **Run full simulation**. (Or open the prepared tab.)
- **Say:** "Ships avoid the canal and go round the Cape. With a fixed tanker fleet, a longer trip means fewer deliveries."
- **If you notice the URL says `conf=6`:** the dashboard's conflict-intensity slider defaults to 6 and the prepared link uses 5. It changes **no number** here, because the price formula uses supply loss only. Say that if asked.
- **KPIs on screen:** price impact **@@s_price@@%**, barrels displaced **@@s_displaced@@**, EVs required **@@s_evs_m@@ million**, extra lithium **@@s_li_mt@@ Mt**, deficit **@@s_deficit_mt@@ Mt**.

### 2:30 to 3:30. The arithmetic, by hand (this is the credibility moment)

| Step | Working | Result |
|---|---|---|
| Flow through Suez + SUMED (EIA, 2023) | given | **@@s_flow@@ bpd** |
| Normal voyage length T | distance of the drawn route / 14 knots | **@@s_T@@ days** |
| Delivery factor with a fixed fleet | T / (T + detour) = @@s_T@@ / (@@s_T@@ + @@s_detour@@) | **@@s_factor@@** |
| Barrels displaced per day | @@s_flow@@ x (1 - @@s_factor@@) | **@@s_displaced@@ bpd** |
| Supply loss | @@s_displaced@@ / @@world_supply@@ world supply | **@@s_supply_loss@@%** |
| Price impact | supply loss / 0.15 (elasticity) = @@s_supply_loss@@ / 0.15 | **+@@s_price@@%** (± @@band@@ pp) |
| EVs to offset the lost fuel | @@s_displaced@@ x @@gal_bbl@@ gal/bbl x 365 / @@gal_veh@@ gal per vehicle-year | **@@s_evs@@** |
| Lithium per EV | 0.10 kg Li/kWh x @@pack@@ kWh x @@lce@@ (LCE per Li) / 1000 | **@@li_per_ev@@ t LCE** |
| Lithium required | @@s_evs@@ x @@li_per_ev@@ | **@@s_li@@ t LCE** |
| Supply cap over 5 years | @@avail@@% x @@world_li_lce@@ t LCE (2025 world output) x 5 years | **@@s_cap@@ t** |
| Deficit | required - cap = @@s_li@@ - @@s_cap@@ | **@@s_deficit@@ t LCE** |
| One-time transit gap | flow x detour days = @@s_flow@@ x @@s_detour@@ | **@@s_gap@@ barrels** |

*Rounding note: the app carries unrounded values (barrels displaced is 4,271,844.66), so a hand calculation from the rounded figures above can differ in the last digits (for example 60,809,714 EVs by hand against 60,809,709 on screen). Say so if someone checks.*

- **Say:** "Every row is either a source, a formula, or an assumption the page flags. The price is the one number I validated, against 21 historical events: the formula's average error is @@band@@ percentage points."

### 3:30 to 4:15. Hormuz: where the formula stops being validated

- **Do:** open `@@hormuz_url@@` (or use the Hormuz route with a **blockade**, 100% blocked, 30 days).
- **Say:** "A full blockade removes @@h_flow_mbd@@ Mb/d, less @@h_bypass_mbd@@ Mb/d that can go round by pipeline, so @@h_displaced_mbd@@ Mb/d: @@h_supply_loss@@% of world supply."
- **Point at the red warning.** "The linear formula says **+@@h_price@@%**. But I only validated it up to @@validated_max@@% supply loss, where the formula gave +@@edge_price@@%. Past that the line is dashed, the error band is gone ('not validated at this magnitude'), and the green line is the 2026 war, **+@@ref_move@@%** actual, itself a soft figure still unfolding. I show the number because the formula gives it; I do not claim it is a forecast."
- **Point at** the bypass sensitivity: "EIA's bypass capacity estimate moved from 4.7 to 2.6 Mb/d; the shaded band shows both."

### 4:15 to 5:00. The vessels, the limits, and the close

- **Do:** with the Suez scenario active, show the **SIMULATED** vessels on the Suez lane glide onto the Cape lane (amber). Click one (zoom in first): every field it lacks says "simulated", and the panel ends "cargo type not confirmed by AIS".
- **Say:** "That is an illustration. The live AIS adapter is built but **unverified**: I have not had a key. AIS also has real limits: coverage gaps, ships that switch the transponder off, unreliable destinations, and it never says what a tanker carries."
- **Close:** "What I would trust: the chain of arithmetic and the sources. What I would not: any single price number at extreme shocks, or the lithium figure beyond NMC batteries. All of it is in the Limitations file."

## Questions you may be asked, and honest answers

**"Twenty-one events is a tiny sample. Why believe the formula?"** I do not claim it is accurate; I claim it is **transparent and not beaten**. I tested a trained model with leave-one-out validation against it: formula error 13.09 pp, model 13.80 pp. With 21 events and four features there is not enough signal to justify replacing theory. The ±13.09 pp band on the chart is that error, so the chart shows how wrong it has been, not a guess.

**"Where does -0.15 come from?"** It is a **borrowed textbook short-run demand elasticity**, not estimated from my data. It is the biggest single assumption in the price number: if the true value were -0.10 the price effects would be 1.5 times larger, and at -0.30 half as large.

**"How was `conflict_intensity` scored?"** By hand, 0 to 10, for the 24 historical events, and several `supply_loss_pct` values are informed estimates too (the 2026 war is marked a rough estimate, still unfolding). `conflict_intensity` is an input I keep for context; it **does not change the price formula** (supply loss alone does). That is a limitation of the dataset.

**"What happens at extreme shocks?"** The formula is linear, validated to @@validated_max@@% supply loss. A Hormuz blockade is @@h_supply_loss@@% and the linear answer is +@@h_price@@%. Real prices would likely behave non-linearly (demand destruction, reserve releases, rerouting), so the app flags it as outside the validated range and does not cap it; capping would be invented precision in the other direction.

**"Is that vessel data real?"** The vessels you see are **simulated** and carry a permanent badge; they are never used in any statistic. The AIS adapter for real positions is written to the provider's documentation and tested against a mock, but **never run against the live feed** (no key). AIS limits: coverage gaps away from coasts, vessels that turn their transponder off (especially around the Gulf), destination fields typed in by the crew, free-tier limits, and no cargo information at all.

**"You used NewsAPI?"** Route news uses **GDELT**, not NewsAPI, precisely because NewsAPI's free Developer plan is for development and testing only. An *older* part of the project (the simulated model-baseline price and alert feed) still polls NewsAPI with a Developer key; that is outside the plan's terms for a public or production deployment, and I would switch it to a paid plan or remove the live polling before publishing.

**"Why does the lithium number change so much?"** Because the per-EV figure is an assumption. The sourced case is **@@li_per_ev@@ t LCE per EV** (0.10 kg Li/kWh from ICCT for NMC-811 cathodes, a 60 kWh pack from IEA's regional averages, 5.323 to convert lithium to carbonate equivalent). It does not cover LFP batteries, which dominate in China. My original 0.008 t per EV had no source and is about @@li_ratio@@ times lower; I kept it only as a comparison line. A larger EU or US pack raises the requirement to @@s_li_hi_mt@@ Mt.

**"What is the 10% lithium availability?"** A scenario input, not a forecast. USGS shows 2025 production (290,000 t of lithium) exceeded consumption (263,000 t) by 27,000 t, about 9% of production, so very little output is spare. Change it on the Results page and the deficit moves.

**"Why is the ticker a few days old?"** EIA's spot prices are daily closes **published in a weekly release**, so the newest point is never fresher than the last Wednesday release. I label it `DAILY_CLOSE` with its age and never call it live.

**"Why does the news panel sometimes say STALE or DEMO SNAPSHOT?"** GDELT is free but slow (10 to 60 seconds here) and often refuses requests. The panel shows the last good result with its original time (STALE) or, failing that, a saved copy of real headlines with the date it was fetched (DEMO SNAPSHOT). It is never presented as live.

## If something fails on the day (fallback plan)

| What fails | What you will see | What to do |
|---|---|---|
| **GDELT is down or slow** | Route news says STALE, DEMO SNAPSHOT, or "unavailable" (only 4 of 14 routes have a snapshot: Hormuz, Bab el-Mandeb, Suez, East-West) | Say what the badge means and move on: news is context, not part of any number. Click Hormuz, Bab el-Mandeb or Suez for the best chance of headlines. Run `prewarm_news.py --snapshot` beforehand to refresh |
| **EIA is down, the key is missing, or the key is rejected** | Ticker badge `OFFLINE_FALLBACK`, red, with an age of weeks and a sentence saying why (the CSV's last row is 2026-08-18) | Say it plainly: "this is the last row of a local file, not today's price." Do not read it as current. Nothing else depends on it |
| **The network is down entirely** | Ticker `OFFLINE_FALLBACK`; news from cache or snapshot; the rest works | The simulation, Results page, routes, lithium and economy sections need no network and no key. Present normally and say which panels are offline |
| **AIS key absent or feed down** | `SIMULATED VESSELS` badge; the "AIS feed" toggle says why it is unavailable | This is the expected state; you were never relying on it |
| **The backend crashes or is not running** | The dashboard says "OFFLINE" / "Price feed unavailable" and the Results page shows an offline message | Restart: `cd backend ; .\venv\Scripts\Activate.ps1 ; python -m uvicorn main:app --port 8000`, wait about 10 seconds, reload. Check `/api/v1/health` |
| **The globe is slow or WebGL fails** | Low frame rate on integrated graphics | Close other tabs. The Results page does not use WebGL, so go there and present from the charts |
| **Everything fails** | | Present from `docs/m9_screenshots/` (one screenshot per step above) and the Results URL printed in this script; the arithmetic table above works on paper |
