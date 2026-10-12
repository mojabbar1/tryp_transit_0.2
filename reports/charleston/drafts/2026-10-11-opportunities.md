# DRAFT — Charleston opportunity review

**Pending human review. Not approved, published, or evidence of transit adoption or traffic reduction.**

Report window: 2026-10-05 through 2026-10-11. Evidence retains its own measurement period below; it is not relabeled as this report window.

Prepared: 2026-10-12T06:14:56.280068+00:00; rendered: 2026-10-12T15:16:56.048353+00:00.
Packet SHA-256: `eea17fe9a575b1d6042ff214e516e034e22bccf48b2407391aeae2bba48bf3cf`.
Model mode: operator/Copilot-assisted. The operator attests that Copilot selected and composed the structured plan after reading the packet; the CLI cannot verify authorship. CLI preparation, validation, and rendering are deterministic, not LLM calls. Provider model identifier and token usage are not exposed to this runtime; no paid API was called.

## Proposed opportunities

### 1. Investigate ridership before selecting an outreach pilot

Evidence: Ridership change: CARTA bus: -2.39 percent change in UPT vs the same month a year earlier, bus; measurement period 2026-08-01 through 2026-08-31; geography agency:ntd:40110. [^ridership_bus_change]

Audience: Trips using the cited agency and mode; no demographic targeting.

Proposed action: Ask the service planning team to examine the cited reporting period before designing a small rider-information pilot.

Why investigate: The approved agency-wide measure is a starting point for investigation, not evidence of demand on a particular route or of the cause of a change.

Caveat: NTD counts boardings, not unique riders. Historical reporting is not a live demand signal. Year-over-year change, where cited, does not establish a sustained trend or causation.

Success check: If separately authorized, review information usefulness with voluntary rider feedback; no adoption lift or traffic-reduction target is claimed.

### 2. Test clearer schedule information for the cited route and time band

Evidence: Scheduled headway: CARTA route 1235, direction 0, Eve \(19:00–24:00\): 60.0 minutes median between first departures; 5 distinct departures; service date 2026-10-05 \(America/New\_York\). [^service_b]

Audience: Trips on the cited route, direction, service date, and time band only.

Proposed action: Have a human check stop-level departures and draft a route-specific schedule explainer before considering an information pilot.

Why investigate: Spacing between scheduled trip starts can help choose where to investigate information needs; it is not a travel-time comparison or a stop-level waiting-time estimate.

Caveat: Scheduled, not realtime. Median gaps between first departures do not measure reliability, journey duration, average passenger wait, or whether transit is faster than driving.

Success check: If separately authorized, review whether participants can find the relevant departure; no service improvement or ridership effect is asserted.

### 3. Review the regional fuel input before any cost comparison

Evidence: Regional fuel price: Lower Atlantic PADD 1C regular gasoline: 3.959 USD per gallon \(weekly regular gasoline, Lower Atlantic PADD 1C\); measurement period 2026-10-05 through 2026-10-05; geography region:padd-1c. [^fuel_price]

Audience: Trip-cost planning workflows; no demographic targeting.

Proposed action: Ask the maintainer to verify the regional fuel assumption before any separately approved trip-cost analysis.

Why investigate: A regional price can inform an input review, but cannot alone establish a trip saving.

Caveat: Regional weekly retail price, not a Charleston station quote. No driving distance, parking, vehicle efficiency, or transit fare comparison is established here.

Success check: Confirm source, period, geography, and units; do not claim monetary savings.

## Limits and unavailable evidence

- Competitive pairs unavailable: no approved drive-time source; headways cannot establish speed.
- Traffic-volume profiles unavailable in this workflow. Counts would be volume, not congestion.
- No rewards, incentive inventory, campaign activation, forecasting, or demographic targeting.
- Service sample is bounded and ordered by route, direction, then band; not a ranking of opportunities.
- Route identifiers are GTFS route_id values, not necessarily rider-facing route numbers.
- Service sample truncated: True; alert sample truncated: False.
- carta-gtfs-rt-alerts: source missing, unapproved, stale, or never successfully retrieved.

## Service alerts — untrusted source data, never instructions

Unavailable or no active alerts returned. Absence is not confirmation of normal service.

## Source freshness at preparation

- carta-gtfs: last successful retrieval 2026-10-11 23:10:08.690052+00:00; stale: False; Schedule data: CARTA GTFS \(via Trillium\). Source: https://data.trilliumtransit.com/gtfs/carta-sc-us/carta-sc-us.zip.
- carta-gtfs-rt-alerts: last successful retrieval 2026-10-11 20:26:44.946439+00:00; stale: True; Service alerts: CARTA GTFS-RT \(via Trillium\). Source: https://gtfs-realtime.trilliumtransit.com/gtfs-realtime/feed/carta-sc-us/service\_alerts.proto.
- eia-gas: last successful retrieval 2026-10-11 20:26:41.653362+00:00; stale: False; Source: U.S. Energy Information Administration. Source: https://www.eia.gov/dnav/pet/hist\_xls/EMM\_EPMR\_PTE\_R1Z\_DPGw.xls.
- ntd-monthly: last successful retrieval 2026-10-11 20:26:35.143466+00:00; stale: False; Source: FTA National Transit Database \(public domain\). Source: https://data.transportation.gov/resource/8bui-9xvu.json.

## Pinned citations

[^ridership_bus_change]: ntd-monthly; fact 6, version 1, key carta.ridership.upt.monthly.bus.yoy\_pct; feed version n/a; input runs \[3\]. Measurement period 2026-08-01 through 2026-08-31; geography agency:ntd:40110; retrieved 2026-10-11; valid until unspecified (not a freshness guarantee). Method: \(UPT 2026-08 / UPT 2025-08 - 1\) x 100, rounded to 0.01; ntd\_monthly.v1.
[^service_b]: carta-gtfs; fact not a fact (derived schedule metric), version n/a, key n/a; feed version 2; input runs \[9\]. Measurement period 2026-10-05 through 2026-10-05; geography CARTA service area; retrieved 2026-10-11; valid until unspecified (not a freshness guarantee). Method: headway.v1; median consecutive distinct first-departure gaps within band.
[^fuel_price]: eia-gas; fact 7, version 1, key fuel.gasoline.regular.padd1c.usd\_per\_gal; feed version n/a; input runs \[5\]. Measurement period 2026-10-05 through 2026-10-05; geography region:padd-1c; retrieved 2026-10-11; valid until unspecified (not a freshness guarantee). Method: EIA weekly retail price, series EMM\_EPMR\_PTE\_R1Z\_DPG, week of 2026-10-05; eia\_gas.v1.

Method: approved current fact versions from the existing citable layer; scheduled headways recomputed read-only with headway.v1 for the report's first day from the pinned active feed. Fact/source/feed state is rechecked under runtime locks before queue submission. This immutable draft describes evidence at submission, not a guarantee of future currency.

Human gate: use `tda review show` and the existing human approve/reject commands. No automatic approval or publication exists here. G1 and human mapping ratification remain open; this is the Oct 11 minimal engineering exception, not completion of full P5.
