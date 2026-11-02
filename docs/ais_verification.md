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
| Vessels Nearby | `GET /v1/AIS/VesselsNearby?mmsi=` | 10 ok, 29 refused | see section 3 |

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

## 4. Rate limit or quota: observed, not explained

* The console lists Vessels Nearby as **Unmetered**, and the Vessel Search page says "no access frequency limits".
* Nearby calls at 14:55:37 (1) and 14:56:50 to 14:56:58 (9, at roughly one per second) all succeeded. **From 14:56:59 every Nearby call returned HTTP 200 with provider status 38, `msg` "The number of queries exceeded".** Status 38 is not in the provider's return-code table.
* A Port Information call afterwards succeeded, so the key is valid and the limit is specific to Nearby.
* I cannot yet tell whether this is a **per-minute (or per-second) rate limit** or a **small lifetime quota of about 10 calls**. The pattern (10 accepted, then refusal) fits both.
* **My mistake:** the test script did not stop at the first status 38, so 29 further requests were sent and refused (all in the log). They should not count against a quota, but the script should have stopped, and every client built from here stops at the first 38 and backs off.

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

**Candidate seed vessels for Vessels Nearby (Vessel Search only; positions and ship types NOT verified, because Search returns neither):**

| Candidate | MMSI | Last report | Why it might work | Status |
|---|---|---|---|---|
| ISTANBUL BOSTANCI light (AIS aid to navigation, MMSI starts 99) | 992711166 | 2 min | fixed transmitter near the Marmara end of the Bosphorus | location unverified |
| PORTSAID ENTRANCE (aid to navigation) | 996221004 | about 192 days | fixed, but its last report is stale | unusable as it stands |
| FSO AFRICA, FSO ASIA, FSO ARJUNA PRIMA (floating storage) | 538002388, 538003426, 525021322 | 0 min | permanently moored, so a fixed circle | locations unverified (not known to be near any chokepoint) |
| FUJAIRAH PILOT 1 | 470499000 | 0 min | near Fujairah, but a pilot boat moves | unreliable seed |

No candidate was found for Hormuz, Bab el-Mandeb, Malacca or the Danish and Cape approaches. Confirming any seed's position costs one Vessels Nearby call each, which is on hold until the owner reports the console numbers.

## 7. Open questions for the user

1. What does the console show now for Vessels Nearby and Vessel Search (used count, any limit)?
2. Is a seed-vessel design acceptable for "tankers near a chokepoint", or should the live-tanker layer be dropped (see `docs/ais_budget_proposal.md`)?
