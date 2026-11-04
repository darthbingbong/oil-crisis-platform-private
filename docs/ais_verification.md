# ShipFinder AIS key: verification record (M10)

Run on 2026-11-01 (UTC) from the project machine. Every real provider call is in `logs/ais_calls.jsonl` (service, time, HTTP status, provider status, latency, purpose; never the key) so it can be compared with the console counters. The key was read from `backend/.env` (`AIS_API_KEY`, 32 characters) and never printed.

## 1. Host and authentication (verified)

| Question | Answer | Evidence |
|---|---|---|
| Host | `https://api.elaneglobal.com/v1/...` | HTTP 200, provider status 0 |
| Authentication | `key=<KEY>` **query parameter**. No `Authorization: Bearer` header is needed; the `api.shipfinder.com` bearer form from the marketing page was not used | Port Information, Vessel Search and Vessels Nearby all answered with this form |
| Coordinate order in docs | **longitude first**: `start_point=lng,lat`, `through=lng,lat-lng,lat` (route planning). Not yet exercised by a call | docs.shipfinder.com 4.1 |
| IP or domain restriction | None met. Docs say the *provider's own* sample key is bound to a domain (status 14); the user's key was never refused for its origin | no status 14 seen |
| Sample key from the docs | Not used anywhere. The doc pages were downloaded with any key-like token redacted | n/a |

Redirects: the docs host is `docs.shipfinder.com`; the Markdown source of every page is at `<page id>.md` and the index at `/llms.txt`.

## 2. Services called (all unmetered per the console)

| Service | Path | Calls | Result |
|---|---|---|---|
| Port Information | `GET /v1/Voyage/PortInfo?keywords=&max=` | 2 | status 0, 563 to 963 ms. Rows: `port_code` (UN/LOCODE, e.g. `AEFJR`), `port_name`, `port_cnname`, `port_time_zone`, `port_country_name`, `port_country_code`. **No coordinates.** `max` up to 100 |
| Vessel Search | `GET /v1/AIS/VesselSearch?keywords=&max=` | 23 | status 0 (21) or **31** (2, both searches that matched nothing, so 31 reads as "no result"; not in the provider's code table). 280 to 375 ms. Rows: `match_type, mmsi, imo, call_sign, ship_name, data_source, last_time`. **No position and no ship type.** `max` up to 100 (100 rows returned in practice). Partial name match. Several MMSIs can share one IMO, and old MMSIs stay in the records (one had an age of 6,235 h) |
| Vessels Nearby | `GET /v1/AIS/VesselsNearby?mmsi=` | 11 ok, 29 refused | see sections 3, 4 and 7 |

Not called (metered): Vessel Position, Fleet Position, Vessel History Track, both route-planning services. Vessel Flag Information is unmetered and not yet called.

## 3. Vessels Nearby: what it really is

* **It is centred on a vessel, not on a coordinate.** The only inputs are `key` and `mmsi`. The docs: "vessels within a **10 nautical mile radius** circular area centred on the position of a target vessel", sorted nearest first. There is no latitude, longitude or radius parameter. A fixed chokepoint "watch point" therefore needs a seed vessel that is near it.
* Response: `status, msg, total, data[]`. Each row: `mmsi, imo, call_sign, ship_name, ship_cnname, data_source (0 terrestrial, 1 satellite), last_time, last_time_utc, lat, lng, ship_type, length, width, left, trail, draught, dest, destcode, eta, navistat, sog, cog, hdg, rot`.
* **Result cap:** none seen. First call: `total` 53, 53 rows returned (19,256 bytes, 366 ms). The docs state no cap. `total` equalled the rows returned in that one case; with one sample the cap is **unknown**, so counts must still carry the "at most N returned" caveat.
* **Freshness** (53 vessels, 37.1 N 6.9 W): last report age min 0 min, median 2 min, max 116 min.
* **Types** in that sample: 13 of 53 were tankers (types 80 to 89: 7 x type 80, 3 x type 89, 1 x type 83 and 2 of other 8x subtypes); the rest were cargo, fishing, passenger and so on.
* **Heading:** 28 of 53 had `hdg` = 511 (not available), so the course over ground is the dependable direction.
* **Navigation status** (`navistat`) is present. Values seen: 0 underway, 1 at anchor, 3 manoeuvre restricted, 5 moored, 15 and 255 (the provider's table lists only 0 to 8 and 255; 15 is "not defined" in the AIS standard). It is crew-set and often wrong.
* **Seed finding:** 9 further hops (before the refusals began) found one vessel near a chokepoint centre: `SPEED T`, 0.3 nm from the Bosphorus centre, moving at 2.4 kn. It is ship type 37 (pleasure craft), **not a tanker**, so it only shows that an area can be reached by hopping. No vessel was found near the other nine centres, and the coverage measurement (tankers returned, truncation, age distribution at each chokepoint) **was not completed** because the refusals began.

## 4. Status 38: a burst rate limit, not a lifetime cap (updated 2026-11-03)

* The console lists Vessels Nearby as **Unmetered**, and the Vessel Search page says "no access frequency limits". The console also **does not record unmetered calls at all**: its usage chart showed 0 calls for Vessel Position, Vessel Search and Vessels Nearby every day from 10/28 to 11/3, although about 40 Nearby calls were made (owner's check, 2026-11-03). Our own `logs/ais_calls.jsonl` is therefore the only reliable count.
* On 2026-11-01, Nearby calls at 14:55:37 (1) and 14:56:50 to 14:56:58 (9, about one a second) succeeded. **From 14:56:59 every Nearby call returned HTTP 200 with provider status 38, `msg` "The number of queries exceeded"** (29 calls, all refused). Status 38 is not in the provider's return-code table.
* On 2026-11-03 at 15:58 UTC (49 hours after the last refusal) one Nearby call succeeded (status 0). That is the 11th successful Nearby call for this key, so a **lifetime cap of 10 is ruled out**. The refusal behaved like a burst rate limit (10 calls in about 8 seconds). The length of the window is not known; waiting 49 hours was enough.
* **My mistake on 2026-11-01:** the test script did not stop at the first status 38, so 29 further requests were sent. Every client built since stops at the first non-zero status and backs off (30 minutes, doubling to 4 hours), and Vessels Nearby is held for a person to release.

## 5. Terms

The public docs pages describe no licence, display or caching rules, and `shipfinder.com/terms`, `/terms-of-service` and `/privacy` return the site's single-page-app shell (identical size), not terms text. **The terms text was therefore never read by me.**

**Confirmed by the project owner on 2026-11-02, after reading the terms they accepted:** showing the data in the presentation is allowed, and saving it (snapshots, fixtures, route-planning results) is allowed. Rules that follow:

* Raw provider data lives only in git-ignored folders (`backend/data/ais_raw/`, `backend/data/ais_backups/`, `logs/`). It is not committed.
* `tools/backup_ais_data.py` copies the raw folder and the call log to a local backup (`%USERPROFILE%\oil-crisis-backups\ais_<time>\`) and deletes the copy if it contains the key. Run it before the key expires on 2026-11-13.
* Derived voyage distances in `routes.json` may be committed because the app needs them; each carries its source, provider and retrieval date.
* Tests that must run on a clean export use small hand-written fixtures that are committed; recordings of real responses stay in the ignored folder and tests that use them skip when the folder is absent.

## 6. Facts gathered for the budget plan (2026-11-02, unmetered calls only, no Vessels Nearby)

**Port codes (Port Information, verified):** Ras Tanura `SARTA`, Ningbo `CNNBG`, Rotterdam `NLRTM`, Novorossiysk `RUNVS`, Trieste `ITTRS`, Primorsk `RUPRI`, Fujairah `AEFJR`, Singapore `SGSIN`, Yanbu `SAYNB`, Houston `USHOU`. Some terminal rows come back without a code or country (`Singapore Refinery Company`, `BTC Terminal Ceyhan`), so code parsing must tolerate missing fields. Port Information has no coordinates.

**Route planning (from the docs, not yet called):** both services return `data.distance` in **nautical miles** and `data.route[]` of `{lng, lat}`. Port-to-Port takes `start_port_code`, `end_port_code`, optional `avoid` (waypoint IDs, up to 10) and `through` (up to 30). Point-to-Point takes `start_point` and `end_point` as `lng,lat` (or `end_port_code`). Avoid IDs: 1 Malacca, 2 Suez Canal, 3 Sunda, 4 Panama, 5 Lombok, 7 Bab el-Mandeb, 17 Cape of Good Hope, 22 Gibraltar, 38 Dover. A Cape voyage is therefore `avoid=2`.

**Candidate seed vessels for Vessels Nearby (Vessel Search only; positions and ship types NOT verified, because Search returns neither). DROPPED by the owner on 2026-11-02 (DECISIONS D5): no fixed objects are used and Nearby is not called to place them. Kept here only as a record of what was found:**

| Candidate | MMSI | Last report | Why it might work | Status |
|---|---|---|---|---|
| ISTANBUL BOSTANCI light (AIS aid to navigation, MMSI starts 99) | 992711166 | 2 min | fixed transmitter near the Marmara end of the Bosphorus | location unverified |
| PORTSAID ENTRANCE (aid to navigation) | 996221004 | about 192 days | fixed, but its last report is stale | unusable as it stands |
| FSO AFRICA, FSO ASIA, FSO ARJUNA PRIMA (floating storage) | 538002388, 538003426, 525021322 | 0 min | permanently moored, so a fixed circle | locations unverified (not known to be near any chokepoint) |
| FUJAIRAH PILOT 1 | 470499000 | 0 min | near Fujairah, but a pilot boat moves | unreliable seed |

No candidate was found for Hormuz, Bab el-Mandeb, Malacca or the Danish and Cape approaches. Confirming any seed's position costs one Vessels Nearby call each, which is on hold until the owner reports the console numbers.

## 7. Verified on 2026-11-03

| Service | Calls | Result |
|---|---|---|
| Vessels Nearby (one authorised call, seed FRONT ALTAIR, MMSI 538007007) | 1 | status 0, **65 vessels returned, `total` 65** (second sample with total equal to returned: still **no result cap observed**, none documented), 14 typed by the provider as tankers (ship type 80 to 89), 398 ms. Raw response saved to the ignored folder, backup run |
| Vessel Position (single) | 8 | status 0 each, 453 to 651 ms (median 494 ms). `data` is one object with the same fields as a Nearby row, plus an `eta` string. Used 8 of the 14 planned, 8 of 50 for the key |
| Vessel Flag Information | 8 | status 0 each, 437 to 565 ms. `data` is `{mmsi, registry}` (flag state name). Where our MMSI-prefix table has no entry (Cayman Islands, Spain, Madeira) the registry from this service is the only source |

Call totals in the log at this point: 120 provider calls (Port Information 22, Vessel Search 35 incl. 3 no-match answers with status 31, Vessels Nearby 40 incl. 29 refused, Vessel Flag 8, Vessel Position 8, Port-to-Port 5, Point-to-Point 2).

**The watchlist is geographically one place.** A Nearby sample is every vessel within 10 nm of one seed, so all 8 chosen tankers are in the Huelva anchorage area (Gulf of Cadiz): 8 different flags and several size classes, but 7 of 8 stopped (moored or at anchor). It is a real-vessel sample, not coverage of any chokepoint.

## 8. Saved past tracks (Vessel History Track, fetched 2026-11-03, 3 of 10 loads used)

Fetched now rather than on demand because the key expires on 2026-11-13. Each raw response is in `backend/data/ais_raw/tracks/` (git-ignored, backed up). The thinned fixture the vessel panel serves is `backend/data/ais_raw/snapshots/tracks.json`; the panel labels it "past track, fetched at <time>" and serves it from disk with no key or provider call, so after the key expires it still shows the saved track with its date and never an error. The window was 7 days ending at the fetch time. I did not re-check the documented maximum window in this session.

| Vessel | MMSI | Flag | Fetched (UTC) | Provider points | Stored (thinned) | First to last point (UTC) | Path | Start to end | Max speed | Moving share |
|---|---|---|---|---|---|---|---|---|---|---|
| OIZMENDI | 224543980 | Spain | 2026-11-03 16:10:33 | 5,349 | 493 | 10-27 16:10 to 11-03 16:09 | 76.0 nm | 6.1 nm | 7.9 kn | 34% |
| MUHUT SILVER | 538006502 | Marshall Islands | 2026-11-03 16:11:15 | 7,291 | 500 | 10-27 16:12 to 11-03 16:08 | 846.5 nm | 658.9 nm | 13.8 kn | 67% |
| CAPE ANN | 563202900 | Singapore | 2026-11-03 16:11:03 | 3,213 | 500 | 10-27 16:11 to 11-03 16:04 | 18.8 nm | 0.1 nm | 0.7 kn | 0% |

**Correction of the owner's premise and of my pick.** The owner's instruction called OIZMENDI "the one underway". Its saved track covers only 76 nm of path and 6.1 nm from start to end, so it spent most of the week stopped. **MUHUT SILVER is the vessel with real movement** (about 659 nm in a straight line). **CAPE ANN did not move at all** (0.1 nm net, 0% moving), so it was a poor choice for "most movement"; it is a valid saved track but the panel must not suggest a voyage. The vessel names in commit 80703c8 (OIZMENDI, MUHUT SILVER, CAPE ANN) are correct; nothing in that commit needs correcting. Seven History Track loads remain in reserve (3 of 10 used). Track lines join reported AIS positions and are not surveyed routes.

## 9. Location-variety attempt (one attempt, 2026-11-03, within the hard limits)

Goal: put at least one real tanker near Hormuz/Fujairah, Singapore or Malacca so the watchlist is not only Huelva.

| Step | Calls | What happened |
|---|---|---|
| Vessel Search (unmetered) for `ADNOC` and `EAGLE` | 2 | saved to `vessel_search_location_20261103.json` |
| Vessel Position, 3 candidates (from the reserve, not the 16 ceiling) | 3 | **ADNOC 810** (MMSI 470562000): provider type 90, 25.119 N 53.605 E, not a tanker. **ADNOC A15** (471991000): type 90, 24.288 N 54.434 E (Abu Dhabi area), not a tanker. **SINGAPORE ENERGY** (538007985): type 80, 278 m, 2.335 N 101.955 E, at anchor (nav status 1) at the Kuala Linggi anchorage, **Strait of Malacca**. |
| Vessels Nearby around SINGAPORE ENERGY (one call, 2026-11-03 16:28:13 UTC) | 1 | status 0, **46 vessels, `total` 46**, **10 typed as tankers by the provider** (80 to 89), 641 ms |

Result: the two Gulf candidates were not tankers and not near Hormuz/Fujairah, so only the Malacca candidate qualified. Four tankers were added to the watchlist, taking it from 8 to 12: **SINGAPORE ENERGY** (the seed), **TEMBEK** (461000259), **ZARGA** (538003346) and **ETYFA PROMETHEAS** (210060000). Their positions come from the Nearby sample itself and are labelled "Vessels Nearby sample only" (no extra Vessel Position calls). Nearly all are anchored or moored at the Kuala Linggi anchorage. Still no tanker at Hormuz or Fujairah. The watchlist label now reads "A sample of real tankers near Huelva, Spain, and a few in the Strait of Malacca, each group seen at the time shown on it. Not chokepoint traffic and not coverage of any area." The Nearby hold was put back after the call; the raw response is saved and backed up.

## 10. Call totals from `logs/ais_calls.jsonl` (129 calls, last entry 2026-11-03 16:28:13 UTC)

| Service | Calls | Successful | Metered limit for the key |
|---|---|---|---|
| Vessel Position | 11 | 11 | 11 of 50 (8 watchlist, 3 location search) |
| Vessel History Track | 3 | 3 | 3 of 10 |
| Port-to-Port | 5 | 5 | 5 of 10 |
| Point-to-Point | 2 | 2 | 2 of 10 |
| Fleet Position | 0 | 0 | 0 of 50 |
| Vessels Nearby (unmetered) | 41 | 12 (29 refused with status 38 on 2026-11-01) | none |
| Vessel Search (unmetered) | 37 | 34 (3 answered status 31, no match) | none |
| Vessel Flag (unmetered) | 8 | 8 | none |
| Port Information (unmetered) | 22 | 22 | none |

Vessel Position headroom: ceiling 16 (5 left), absolute limit 19 (8 left). That is not enough to refresh 12 tankers; see DECISIONS D17.

## 12. M12 (2026-11-04): no provider calls were made

- **Malacca tracks:** the owner approved up to 2 more History Track loads for Malacca tankers underway according to their saved status. All four were stopped when last seen: SINGAPORE ENERGY (at anchor, 0.1 kn), TEMBEK (moored, 0.0 kn), ZARGA (at anchor, 0.0 kn), ETYFA PROMETHEAS (at anchor, 0.2 kn). **Nothing was spent**; History Track stays at 3 of 10.
- **Calls this session:** none to the provider. Every test uses a mock transport or a canned reply; the expired-key checks fake the date. The call log still holds 129 calls (Vessel Position 11 of 50).
- **New endpoints:** `GET /api/v1/ais/budget` (counts from `logs/ais_calls.jsonl`), `GET /api/v1/ais/search`, `POST /api/v1/ais/search/provider`, `GET /api/v1/vessels/{mmsi}/track`, `GET /api/v1/vessels/{mmsi}/near`; `key` and `ais_key_line` in `/health` and `/vessels/watchlist`. See DECISIONS D21 to D24.

## 13. Open questions for the user

None blocking. Final snapshot due 2026-11-10; the key expires 2026-11-13.
