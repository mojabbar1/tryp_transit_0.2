# 03 — Data Source Catalog & Ingestion Policy

> **Research date:** 2026-09-24. Live API calls were made where possible. Endpoints, quotas, and terms change,
> so **every connector prompt re-verifies its source at execution time** (risk R-16).
> Status: ✅ **Verified** on a primary source or with a live call · 🟡 **Partial** (secondary source, or the
> primary blocked automated fetch) · ❌ **Not available** · ❔ **Unverified**, a to-do for P3.
> A source becomes `approved` in `data_agent/tda/config/sources.yaml` **only via a human-reviewed PR** after the
> terms review below.
> **Re-verified 2026-09-27 for P3** (packets in [05 §6a](./05-decisions-and-review.md#6a-re-verification-packets-p3-step-a1-retrieved-2026-09-27-et)):
> S-1 and S-3 are unchanged; S-2's "http, not https" is corrected (`https` works); S-10's key requirement is
> confirmed; S-11 has a keyless official bulk file; the S-6a page claims "All Rights Reserved".

---

## 1. Source table

### Transit

| ID | Source | Access | Auth | Terms: fetch / store / attribution | Cadence | Priority · Phase | Status |
|----|--------|--------|------|------------------------------------|---------|------------------|--------|
| **S-1** | **CARTA GTFS static**, published through Trillium. Transitland feed `f-djz4-carta~sc~us`. Verified 2026-09-24: **1,108 stops, 24 routes**, active feed valid **2026-08-20 → 2027-05-27**. | `https://data.trilliumtransit.com/gtfs/carta-sc-us/carta-sc-us.zip` | none | Transitland **registry metadata** shows use-without-attribution and derived products allowed; the feed's own `feed_info.txt` has an **empty `feed_license`**, so treat terms as "registry-flagged, not publisher-confirmed" and attribute CARTA/Trillium anyway. | ~monthly new versions; poll daily with a conditional GET | **Pilot** · P3.1 | ✅ |
| **S-2** | **CARTA GTFS-RT: Service Alerts only** | `https://gtfs-realtime.trilliumtransit.com/gtfs-realtime/feed/carta-sc-us/service_alerts.proto` (`https` works as of 2026-09-27; the originally listed `http://` also answers) | none | Same publisher as S-1 | Live; poll every 2–5 min | P1 · P3.7 | ✅ (alerts) |
| S-2b | CARTA **vehicle positions and trip updates** | Not public. The AVL vendor is **Swiftly**, and the rider app is Transit. The Swiftly API needs an agency-authorized key and bans redistribution. | agency key | Needs a **partnership** with CARTA/Transdev | — | Outreach (D-20) | ❌ public |
| **S-3** | **NTD Complete Monthly Ridership** (FTA), Socrata `8bui-9xvu`. CARTA's **NTD ID is 40110** (legacy 4110), UZA Charleston, SC | `https://data.transportation.gov/resource/8bui-9xvu.json?$where=ntd_id='40110'&$order=date DESC` (query by `ntd_id`, not the display name) | none (an app token is recommended) | `USGOV_WORKS` (public domain). Store indefinitely. | Weekly refresh, with a monthly data lag. The live query returned **Jul 2026** (bus UPT 6,372 for mode CB; MB rows also present). | **Pilot** · P3.2 | ✅ |
| **S-4** | **Tri-County Link GTFS** (BCDCOG rural). Transitland `f-tricounty~link~sc~us` | `http://data.trilliumtransit.com/gtfs/tricountylink-sc-us/tricountylink-sc-us.zip` | none | **No license flags are stated.** A human terms review is needed before use. | ~monthly | P2 · P3 (later) | ✅ feed · ❔ terms |
| S-5 | **Lowcountry Rapid Transit (LCRT)** BRT project info: 21.3 mi, Ladson ↔ downtown, BCDCOG sponsor | `https://lowcountryrapidtransit.com/about/` (the FTA CIG pages return 403 to bots, so a human retrieves them) | none | Public web. Check `robots.txt`. Cite facts only. | Ad hoc | P2 · P5 Extractor | 🟡 (opening ~2029 comes from a secondary source) |

### Traffic

| ID | Source | Access | Auth | Terms: fetch / store / attribution | Cadence | Priority · Phase | Status |
|----|--------|--------|------|------------------------------------|---------|------------------|--------|
| **S-6a** | **SCDOT traffic counts**, statewide annual CSVs | `https://www.scdot.org/travel/travel-trafficdata.html` | none | No explicit license, so terms need review. The page footer reads "© 2026 All Rights Reserved. Property of South Carolina Department of Transportation" (2026-09-27). Attribute SCDOT. | Annual | P1 · P3.6 | 🟡 |
| **S-6b** | SCDOT counts mirrored by **BCDCOG** (ArcGIS FeatureServer, tri-county, ~2022 vintage) | `https://services2.arcgis.com/BTzI2Eau2uhzyzR0/arcgis/rest/services/SC_DOT_Traffic_Counts_WFL1/FeatureServer/0/query` | none (`allowAnonymousToQuery`) | No `licenseInfo`. Confirm the item's owner and org through `sharing/rest/content/items/{id}` before trusting it. | Last modified ~Feb 2025 | P1 · P3.6 | ✅ reachable |
| **S-6c** | **SCDOT continuous count stations** (hourly volumes, 170+ stations), via the Drakewell public map | `https://scdottrafficdata.drakewell.com/publicmultinodemap.asp`: **export only** (Excel/PDF), no API | none | Don't scrape the UI. A **human exports** the files into the **inbox** (§3). | Monthly manual export | **P0 for traffic patterns** · P3.6 | 🟡 |
| **S-7** | **TomTom** Traffic Flow v4, Incident Details v5, and Routing | `api.tomtom.com/...` (existing client) | API key | Free tier is ~**2,500 non-tile req/day** (secondary source). The terms **likely prohibit long-term storage** of live responses or building a derived database. **Legal review is required** (D-7). **Live use only by default.** Attribution: "© TomTom". | Per request | **P0** (live) · P1 | 🟡 |
| S-7b | **TomTom Traffic Stats / MOVE**: the licensed historical speeds and travel times | `move.tomtom.com`, `docs.tomtom.com/traffic-stats` | paid (30-day trial) | Licensed for historical analytics | On demand | Option (D-7, D-14) | 🟡 |
| S-8 | **SC511** (Iteris for SCDOT): incidents, cameras | Public web map only | — | **No public developer API was found** (no docs or key signup located). Consumer ToS only. **Excluded**: don't scrape. A data-sharing request to SCDOT is possible. | — | Excluded | ❌ found |
| S-9 | Headline congestion stats: the **TomTom Traffic Index** Charleston page and **INRIX Scorecard** | `https://www.tomtom.com/traffic-index/city/charleston-sc/`; INRIX requires registration | none / registration | Cite headline figures with attribution. No bulk reuse. | Annual (Q4/Jan) | P2 · P3.5 reference facts | 🟡 (figures are secondary; a human verifies them) |
| S-9b | **NPMRDS** (FHWA probe travel times) | Restricted to public agencies | agency | Possible via a BCDCOG/SCDOT partnership | Monthly | Outreach (D-20) | ❔ |

### Supporting statistics

| ID | Source | Access | Auth | Terms: fetch / store / attribution | Cadence | Priority · Phase | Status |
|----|--------|--------|------|------------------------------------|---------|------------------|--------|
| **S-10** | **Census ACS**: CBSA **16700** (Charleston–North Charleston MSA); tables **B08301** (mode), **S0801** (commuting, %), **B08303** (travel time); counties 45019, 45015, 45035 | `https://api.census.gov/data/<year>/acs/acs5?get=NAME,B08301_001E,B08301_010E&for=metropolitan%20statistical%20area/micropolitan%20statistical%20area:16700&key=…` | **free key** (checked live) | Public domain | Annual (~Dec) | P1 · P3.3 | ✅ |
| **S-11** | **EIA API v2**: weekly regular gasoline, Lower Atlantic (PADD 1C), series `EMM_EPMR_PTE_R1Z_DPG` | `https://api.eia.gov/v2/petroleum/pri/gnd/data/?frequency=weekly&data[0]=value&facets[series][]=EMM_EPMR_PTE_R1Z_DPG&api_key=…`, or, with **no key**, EIA's official bulk file of the same series: `https://www.eia.gov/dnav/pet/hist_xls/EMM_EPMR_PTE_R1Z_DPGw.xls` (verified 2026-09-27) | **free key** (API v2 only; the bulk file needs none) | Public domain | Weekly: prices dated Mondays, published Tuesdays (released 2026-09-22; next 2026-09-29 per the series page) | P1 · P3.4 | ✅ series · 🟡 exact v2 call |
| S-12 | **AAA Your Driving Costs 2025** | Fact-sheet PDF: `https://newsroom.aaa.com/wp-content/uploads/2025/09/UPDATE-AAA-Fact-Sheet-Your-Driving-Cost-9.2025-1.pdf` | none | Cite with attribution. No bulk reuse. | Annual (~Aug/Sep) | P1 · P3.5 | 🟡 (a human extracts the figures from the PDF) |
| S-13 | **EPA**, "GHG Emissions from a Typical Passenger Vehicle" (EPA-420-F-23-014) | `https://www.epa.gov/greenvehicles/greenhouse-gas-emissions-typical-passenger-vehicle` | none | Public domain | Reviewed periodically | P1 · P3.5 | 🟡 (~400 g CO2/mi is widely cited; a human verifies it) |
| S-14 | **FTA (2010)**, *Public Transportation's Role in Responding to Climate Change*, national averages: bus transit ≈ 0.64 lb CO2/passenger-mile vs drive-alone ≈ 0.96 (0.45 is the all-mode transit average, which includes rail; 05 §2a) | `https://www.epa.gov/sites/default/files/2016-04/documents/public_transportations_role_in_responding_to_climate_change.pdf` (FTA's 2010 EPA-webinar deck; the chart is on slide 3) | none | Public domain. **Stale (2010).** | Static | P2 · P3.5 | 🟡 |
| S-14b | **CARTA-specific bus CO2 per passenger-mile**, derived from NTD annual fuel/energy and passenger-miles | NTD annual data products (dataset IDs **to be confirmed**) | none | Public domain | Annual | P2 · P4 derived metric | ❔ |
| S-15 | **CARTA fares** and **downtown parking rates** (City of Charleston) | `https://www.ridecarta.com/fares-passes/` (already linked in `routes/page.tsx:113`); City parking pages | none | Public web. Check `robots.txt`. Cite. | On change | P1 · P3.5 (a human curates them) | ❔ |
| S-16 | **NWS API** (weather, alerts) | `https://api.weather.gov` | none; requires a **User-Agent with contact** | Public domain, free for any purpose | Live | P3 · P3.9 | ✅ |
| S-17 | **NOAA CO-OPS**, Charleston station **8665530**: water level, flood thresholds, high-tide flood outlook | `https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/8665530/floodlevels.json`; `/api/prod/datagetter` | none | Public domain | Live, plus a monthly outlook | P3 · P3.9 (tidal flooding closes roads) | ✅ |
| S-18 | **NHTSA FARS** CrashAPI: fatalities by county (FIPS 45019, 45015, 45035 verified) | `https://crashviewer.nhtsa.dot.gov/CrashAPI/crashes/GetCrashesByLocation?fromCaseYear=YYYY&toCaseYear=YYYY&state=45&county=19&format=json` | none | Public domain. **It returned 403 to automated fetch.** Don't evade it (§2.2). | Annual (~1-yr lag) | P2 · P3.9 (safety page) | 🟡 |
| S-19 | **City of Charleston** and **BCDCOG (CHATS MPO)** ArcGIS Hub portals | `https://data-charleston-sc.opendata.arcgis.com/`, `https://data-bcdcog.opendata.arcgis.com/`, `https://transportation.bcdcog.com/` | none | Standard Hub terms, per dataset | Varies | P2 · P3.9 | ✅ portals · ❔ datasets |
| S-20 | **Public documents**: CARTA board packets and service-change notices; BCDCOG/CHATS plans and reports | Per URL, listed as `documents` sources | none | A `robots.txt` check per host. Cite facts with a verbatim quote and page. | Ad hoc | P2 · P5 Extractor | ❔ |

## 2. Ingestion policy (enforced in code in P2, and reviewed per source in PRs)

### 2.1 Preference order
1. An official API or feed (GTFS, GTFS-RT, Socrata, Census, EIA, NOAA, NWS)
2. An official bulk download (CSV or ZIP)
3. An open-data portal layer (ArcGIS Hub or FeatureServer), with the owner/org verified
4. A published document (HTML or PDF), processed by the **Extractor** into **candidate** facts for human review
5. A **manual export** by a human, dropped into the inbox (§3)

**Never:**
- scrape sites whose terms forbid it (S-8 SC511, the Google Maps and Waze consumer apps)
- bypass authentication, paywalls, registration walls, or bot protection
- impersonate a browser
- collect PII

### 2.2 Identity and politeness
- Send a descriptive User-Agent with a contact address: `TrypTransitDataAgent/<ver> (+<contact>)` (D-18).
  **Don't spoof browser headers.** If a host returns 403 or 429 to that honest UA (for example, S-18 or the FTA
  PDFs), mark the source `blocked`. Then either use the official API, ask the publisher, or have a human retrieve
  the file into the inbox.
- `robots.txt` is **mandatory** for the HTML and PDF kinds. Honor `Crawl-delay`. Unreachable (5xx) means
  disallowed.
- Per-host rate limits (default 30/min, lower if the source specifies it), exponential backoff with jitter, honor
  `Retry-After`, conditional GETs, and a max body size.

### 2.3 Storage, retention, attribution
- Each source declares `store_policy`: `none` means no raw body, only a checksum and derived aggregates if the
  terms allow; `ttl:<N>d`; or `indefinite`.
  - **TomTom live responses:** `none` until the legal review in D-7 says otherwise.
  - **Public-domain federal data:** `indefinite`.
- `attribution_text` is required whenever the terms ask for it, or it's good practice. The UI renders it next to
  any number derived from the source.
- A number is publishable only as an **approved fact** that links back to its sources and fetch runs.

### 2.4 Terms review (a HITL gate, recorded in `sources.yaml`)
Each source must record `terms_url`, `terms_summary`, `store_policy` with a justification, `attribution_text`,
`terms_reviewed_by`, and `terms_reviewed_at`. Only after that review can a PR flip it to `status: approved`.

## 3. Manual inbox (HITL retrieval)

Some high-value data can't be fetched politely, or doesn't have an API: the S-6c hourly counts, the FTA CIG PDFs,
and registration-gated reports. For those:

- A human drops the file into `data_agent/inbox/<source_id>/`. The directory is gitignored and holds raw files only.
- `tda inbox process <source_id>` checksums the file, records a `fetch_run` with `acquisition=manual` (plus
  `supplied_by` and `original_url`), and normalizes it. For document sources, it also sends the file to the
  Extractor.
- Every inbox run records **who** supplied the file, plus the original URL and retrieval date, for provenance.

### 3.1 Retention model (raw vs normalized vs evidence)

Retention is per-layer, not one number:

| Layer | Default | Notes |
|-------|---------|-------|
| Raw snapshots | `store_policy` per source: `none`, `ttl:<N>d` (default 180 d for public-domain), or `indefinite` | TomTom live = `none` (D-7) |
| Normalized observations | Kept **indefinitely** (append-only) | This is what makes rollback restore prior values; it's small |
| Published-fact evidence | Kept **regardless of TTL** | Any raw snapshot cited by an approved/published fact is pinned so the citation stays reconstructable |

This resolves the earlier drift between "180-day raw retention" (D-18) and "store NTD indefinitely" — they describe
different layers.

## 4. Traffic patterns without violating terms (the D-7 default)

| Need | Default source | Upgrade path |
|------|----------------|--------------|
| Current conditions per trip | S-7 TomTom live (no persistence) | — |
| **Time-of-day volume patterns** by corridor | **S-6c SCDOT hourly counts** (monthly human export → inbox) | S-9b NPMRDS through a BCDCOG/SCDOT partnership |
| Volumes by location (context) | S-6a/S-6b AADT | — |
| **Historical travel-time and speed profiles** | *Not in the default design* | **S-7b TomTom Traffic Stats** (licensed, D-14) or NPMRDS |
| Headline city congestion stats | S-9 (cited reference facts) | — |
| Road-closure risk (tidal flooding) | S-17 NOAA thresholds and outlook | City road-closure data (S-19), if published |

## 5. Per-source verification checklist (copy into each connector PR)

- [ ] The endpoint is reachable today, with the exact URL and parameters recorded. A sample response is saved as a
      **trimmed** test fixture, if the license permits it.
- [ ] Auth needs are confirmed, the key is stored as an env var, and nothing is committed.
- [ ] Terms are reviewed for fetch, store, redistribute, and attribution; `store_policy` and `attribution_text` are set.
- [ ] `robots.txt` is checked (HTML/PDF), and the rate limit is configured.
- [ ] The schema is documented, and the data-quality checks are defined (row counts, keys, ranges, and continuity).
- [ ] The owner/org is confirmed for ArcGIS items (guard against false-positive layers).
- [ ] The `sources.yaml` entry is complete, and a human flipped it to `approved` in the PR.

## 6. Known gaps and outreach (feeds D-20)

| Gap | Why it matters | Ask |
|-----|----------------|-----|
| CARTA vehicle positions and trip updates (S-2b) | On-time performance and live arrival times strengthen nudges | CARTA or Transdev: a GTFS-RT VehiclePositions and TripUpdates feed, or Swiftly API access |
| Route-level ridership | NTD is agency- and mode-level only | CARTA: monthly ridership by route (board packets or a data share) |
| Historical travel times | Evidence for when and where transit beats driving | BCDCOG or SCDOT: NPMRDS access, or budget for S-7b |
| SC511 incidents | Real-time disruptions | SCDOT or Iteris: a data-sharing agreement |
