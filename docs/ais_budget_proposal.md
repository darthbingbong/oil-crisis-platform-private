# ShipFinder budget and route-pair proposal (M10 pause point) - DRAFT, awaiting approval

Written 2026-11-02. **The key and every service expire on 2026-11-13 (11 days).** Nothing below has been spent except the unmetered verification calls already in `logs/ais_calls.jsonl`.

Rules applied: at most 60% of each metered quota during development, the rest kept for demo preparation and final QA; one backend poller only; browsers never call the provider; tests replay hand-written fixtures; every real call is logged without the key; a provider status 38 (or any quota or rate refusal) stops all calls for that service immediately.

## 1. Per-service budget

| Service | Quota (console) | Use | Planned calls | Development cap (60%) | Reserve |
|---|---|---|---|---|---|
| Vessels Nearby | "Unmetered", **but refused after 10 calls on 2026-11-01 (status 38)** | **ON HOLD** until the console numbers are known (see section 3) | 0 now | n/a | n/a |
| Vessel Search | Unmetered ("no frequency limits" in docs; 23 calls, no refusal) | the search box; server-side limit 1 call per second, results cached 10 min | about 60 in development, about 20 on demo day | n/a | n/a |
| Vessel Flag Information | Unmetered | on selecting a vessel, once per MMSI, cached permanently | about 10 | n/a | n/a |
| Port Information | Unmetered | curated port list; static, cached on disk permanently | 12 already done, 0 polling | n/a | n/a |
| Vessel Position | 50 | only when the user selects a search result; shows "provider calls left" | 6 development + 8 demo preparation = **14** | 30 | **36** |
| Fleet Position | 50 | not needed (works on a console-defined fleet, a push-side feature) | **0** | 30 | 50 |
| Vessel History Track | **10** | "Load track" on demand only, cached, never automatic | 3 development + 3 final snapshot (M15) = **6** | 6 | **4** (rule: at least 3) |
| Port-to-Port Route Planning | **10** | real sea distance for the five voyages below | **5** | 6 | **5** |
| Point-to-Point Route Planning | **10** | optional cross-check of two Port-to-Port results | **2** (optional) | 6 | **8** |
| Disabled services | n/a | not implemented, not called, UI hides them; listed in LIMITATIONS as "not available on the current key" | 0 | n/a | n/a |

Polling interval for unmetered services: **none until Vessels Nearby is understood.** If it turns out to be a per-minute rate limit, the poller would make at most 1 call per seed vessel per 5 minutes and at most 5 seeds, so at most 60 calls an hour and never more than 6 in any minute (a client-side cap far below the 10 accepted in 8 seconds). If it is a small lifetime quota, there is no polling at all.

## 2. Route pairs proposed (Port-to-Port unless marked)

The app's six voyage-day figures currently come from five representative voyages measured over hand-placed waypoints (`derive_voyages.py`). These calls replace them with the provider's planned distance, at the project's 14 knots.

| # | Service | From to | Parameters | Replaces | Current value |
|---|---|---|---|---|---|
| 1 | Port-to-Port | Ras Tanura `SARTA` to Ningbo `CNNBG` | none | Hormuz and Malacca voyage days | 5,784 nm, 17.2 days (Malacca is flagged estimate) |
| 2 | Port-to-Port | Ras Tanura `SARTA` to Rotterdam `NLRTM` | none (the planner should choose Hormuz, Bab el-Mandeb, Suez) | Bab el-Mandeb and Suez voyage days | 21.2 days |
| 3 | Port-to-Port | Ras Tanura `SARTA` to Rotterdam `NLRTM` | `avoid=2` (Suez Canal), forces the Cape | Cape voyage, so the derived default detour (Cape days minus Suez days) | derived from hand waypoints |
| 4 | Port-to-Port | Novorossiysk `RUNVS` to Trieste `ITTRS` | none | Turkish Straits voyage days | 1,704 nm, 5.1 days |
| 5 | Port-to-Port | Primorsk `RUPRI` to Rotterdam `NLRTM` | none | Danish Straits voyage days | 1,425 nm, 4.2 days |
| 6 (optional) | Point-to-Point | Ras Tanura (50.15 E, 26.7 N) to Ningbo (122.2 E, 29.9 N) | none | consistency check of #1 | n/a |
| 7 (optional) | Point-to-Point | Primorsk (28.6 E, 60.35 N) to Rotterdam (4.1 E, 51.95 N) | none | consistency check of #5 | n/a |

That is 5 of 10 Port-to-Port (limit 8, 5 left) and 2 of 10 Point-to-Point (8 left). Every response is saved raw to `backend/data/ais_raw/` (ignored) before anything is derived from it. Each distance that is committed to `routes.json` carries provider, service, retrieval date and `is_estimate: false`.

**Numbers that will change** (so snapshot first, before/after table, update the golden tests, README changelog, regenerate DEMO_SCRIPT from the API): `baseline_voyage_days` on hormuz, malacca, bab_el_mandeb, suez, turkish_straits, danish_straits; the derived default detour; and the Suez worked example, which divides the 20-day detour by the baseline voyage.

## 3. The decision that blocks live tankers

Vessels Nearby is centred on a vessel, with a fixed 10 nm radius, and returned status 38 after 10 calls. Nothing may call it until the console numbers are pasted. Then:

* **If the console shows a lifetime quota (about 10, now used):** Vessels Nearby is finished for this key. Live tankers are dropped. M12 shows simulated vessels (labelled `SIMULATED`), plus the vessel search, details, tracks and ports that the key does support.
* **If it shows a rate limit or no quota:** one retry after the limit window. If it works, a seed design is possible, but with limits stated plainly: a circle of 10 nm around a seed, not a strait; usable seeds found so far are only the Istanbul light (unverified position) and three permanently moored floating-storage vessels (positions unknown); no candidate for Hormuz, Bab el-Mandeb, Malacca, the Danish straits or the Cape. Chokepoints without a verified seed would show no live tankers rather than a made-up count.

## 4. Schedule against the key expiry

| When | What |
|---|---|
| Now (11-02 to 11-03) | approvals, then route planning (7 calls), record raw responses, derive voyage days, before/after table, tests |
| Through 11-10 | M11 to M14 are built offline from saved data and simulated vessels |
| 11-11 or 11-12 | `prewarm_ais.py`: final snapshots, 3 track calls, vessel positions for the demo; `backup_ais_data.py` |
| 11-13 | key and all services expire; the app must run entirely from snapshots, simulated vessels and the stored route distances |
