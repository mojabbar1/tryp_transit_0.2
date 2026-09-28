# 05 — Decisions, Assumptions & Human Review

> **This is the human-in-the-loop control panel.** Before each phase runs:
> 1. Answer the decisions it needs, or write "accept default".
> 2. Fill in the approved values in the assumptions table (P1 and P3.5).
> 3. Sign the phase off in §7.
>
> Coding agents treat anything unsigned as **blocked**.

---

## 1. Decision log

Legend: **Default** is what happens if the reviewer writes "accept default". **Needed by** is the first phase
that's blocked without an answer.

| ID | Question | Options | Default (recommended) | Needed by | Answer |
|----|----------|---------|-----------------------|-----------|--------|
| D-1 | Region scope | (a) Charleston first, region-pluggable config · (b) multi-region now | **(a)** | P2 | **(a)** accept default — mojabbar, 2026-09-27 16:58 ET (chat: "approve P2 defaults, use the repo URL as the contact") |
| D-2 | Where the data agent lives | (a) a new Python `data_agent/` service · (b) TypeScript inside Next.js · (c) extend `model_service` | **(a)**: best fit for GTFS, geo, PDF, scraping, scheduling, and agent tooling, with no load on the UX path | P2 | **(a)** accept default — mojabbar, 2026-09-27 16:58 ET (chat: "approve P2 defaults, use the repo URL as the contact") |
| D-3 | Agent framework | (a) **Pydantic AI 2.x** · (b) OpenAI Agents SDK 0.22.x · (c) LangGraph 1.x · (d) a thin custom loop | **(a)**: typed, multi-provider, has `TestModel`/`FunctionModel` and `pydantic-evals`, MIT | P5 | |
| D-4 | LLM providers and model IDs, **all from env** | Web narration: Gemini `gemini-3.8-flash` or OpenAI `gpt-5.6-terra`. Agent reports: the same, or a higher tier such as `gpt-6-astra`. Extraction: a cost tier such as `gpt-5.6-luna` or `gemini-3.8-flash`. | **Gemini `gemini-3.8-flash` everywhere to start** (the existing default provider), with OpenAI `gpt-5.6-terra` as the alternate. **Re-check the IDs at execution time.** | **P0** (stopgap), P1, P5 | Accept default — mojabbar, 2026-09-25 (IDs re-checked in P0 T8) |
| D-5 | Storage | (a) Postgres 16 via compose, PostGIS later if needed · (b) SQLite or DuckDB file · (c) managed Postgres | **(a)**, which also matches the pattern on the unmerged branch | P2 | **(a)** accept default — mojabbar, 2026-09-27 16:58 ET (chat: "approve P2 defaults, use the repo URL as the contact") |
| D-6 | How transit travel time is computed | (a) GTFS direct-route scheduled lookup · (b) OpenTripPlanner 2 (transfers, walking) · (c) a third-party routing API | **(a)** in P4, and (b) as a later upgrade if transfers matter | P4 | |
| D-7 | Traffic history and TomTom storage | (a) TomTom **live only**, no persistence; time-of-day patterns from SCDOT hourly counts (inbox) plus AADT · (b) buy TomTom Traffic Stats · (c) store live samples after a **written legal approval** of TomTom's terms · (d) NPMRDS through a partnership | **(a)** now, with (b) or (d) considered after P4 shows value | P3 | |
| D-8 | Human review surface | (a) CLI plus PR-published Markdown · (b) (a) plus an admin web UI in P7 (needs Auth.js) | **(a)**, revisited in P7 | P2, P5, P7 | **(a)** accept default — mojabbar, 2026-09-27 16:58 ET (chat: "approve P2 defaults, use the repo URL as the contact") |
| D-9 | Hosting and scheduling | (a) docker-compose on one VM, with an APScheduler worker · (b) managed containers or jobs (Azure Container Apps, AWS ECS, Render, Fly) · (c) GitHub Actions cron plus a managed DB | **(a)** for dev and staging; decide prod in P7 | P2 (local), P7 | **(a)** for dev and staging; prod decided in P7 — mojabbar, 2026-09-27 16:58 ET (chat: "approve P2 defaults, use the repo URL as the contact") |
| D-10 | Future of `model_service` | (a) keep it separate and retarget it to CARTA data through the data-agent API · (b) merge it into `data_agent` · (c) retire forecasting | **Decide at G1.** It leaves the live path in P1 regardless; whether to build P6 at all is an expansion decision. | G1 (was P6) | |
| D-11 | Unmerged branches `feature/economic-incentive-improvements` and `demo-improvements-20250813` | (a) harvest the patterns without merging, and archive the branches after P2 · (b) merge · (c) delete | **(a)**. Note that the second branch holds the key string (D-13). | P2 | **(a)** accept default — mojabbar, 2026-09-27 16:58 ET (chat: "approve P2 defaults, use the repo URL as the contact") |
| D-12 | Scout (source discovery with web search) | (a) off · (b) on, CLI-only, with proposals going to the queue | **(a)** | P5 | |
| D-13 | Handling the leaked Gemini key | (a) confirm it's **revoked**, redact the docs, and add PR-diff secret scanning · (b) additionally rewrite history with `git filter-repo` and force-push every affected branch | **(a)**. Choose (b) only if the key isn't confirmed revoked, or policy requires it. | **P0 (blocking)** | **(a)** accept default. Revoked? ☑ yes, confirmed by mojabbar on 2026-09-25. String redacted from `REFACTORING_PLAN.md` at G0. |
| D-14 | Budgets | LLM monthly cap; per-run caps; TomTom plan (free ~2,500 non-tile/day vs paid); any Traffic Stats spend | **Suggested:** LLM ≤ $25/month during development (a provider-side cap plus a code cap), the TomTom free tier, and no paid historical data before P4 | P5 (P1 for web LLM calls) | |
| D-15 | Where trip narration runs | (a) in the web app, sharing the validator vectors · (b) data agent `/v1/narrate` | **(a)**, the low-latency path | P1 | **(a)** accept default — mojabbar, 2026-09-27 (chat; see §7) |
| D-16 | Framework upgrade | (a) 14.2.35 as a stopgap in P0, then **Next 16.x** in P0B · (b) Next 15 | **(a)**. Next 15 support ends 2026-10-21. | P0 | **(a)** accept default — mojabbar, 2026-09-25 |
| D-17 | Demo mode | (a) one app-wide `NEXT_PUBLIC_DEMO_MODE` flag (default off) gates the demo scenarios, the dashboard constants, **and** the `/incentives` + `/routes` reward copy, each with a visible badge · (b) remove the demo artifacts | **(a)** | P4 | |
| D-18 | Retention, attribution, and crawler identity | Raw public-domain snapshots: 180 days (normalized data kept indefinitely). TomTom: `none`. UA: `TrypTransitDataAgent/<ver> (+<contact>)`. | **Accept these**, and supply the contact email: ________ | P2 | **Accepted as listed.** Contact: `https://github.com/mojabbar1/tryp_transit_0.2`, so the UA is `TrypTransitDataAgent/<ver> (+https://github.com/mojabbar1/tryp_transit_0.2)` — mojabbar, 2026-09-27 16:58 ET (chat: "approve P2 defaults, use the repo URL as the contact") |
| D-19 | Tooling | (a) uv, Python 3.12, Node 22 LTS, npm | **(a)** | P2 | **(a)** accept default — mojabbar, 2026-09-27 16:58 ET (chat: "approve P2 defaults, use the repo URL as the contact") |
| D-20 | Partnerships and outreach (not blocking) | Ask CARTA or Transdev for GTFS-RT vehicle positions and trip updates, plus route-level ridership. Ask BCDCOG or SCDOT for NPMRDS. Ask SCDOT for a 511 data share. | **Send the asks during P2.** Owner: ________ | — | |
| D-21 | Transit time before GTFS lands (P1 to P4) | (a) show it as **`unavailable`** in live mode — drive time, cost, and current traffic still render — (b) a flagged heuristic estimate · (c) show nothing at all | **(a)**. A heuristic "bus time" is an unsupported promise (half the current stops aren't even near CARTA service). Bus time becomes real in P4. | P1 | **(a)** accept default — mojabbar, 2026-09-27 (chat; see §7) |
| D-22 | Forecast model backend (`model_service`) | (a) statistical: seasonal-naive vs ETS, chosen by backtest · (b) Chronos-Bolt on CPU · (c) Chronos-2 | **(a)**, with (b) behind `MODEL_BACKEND` only if it beats (a) in the backtest | P6 | |
| D-23 | Privacy review owner and the impact-event schema | Owner name; approve the event list (`nudge_shown`, `cta_carta_fares_click`, `trip_planned`, `demo_vs_live`), the fields (hour-truncated time, corridor or route ID, variant, demo flag), k = 10 suppression, and "no IP, no user ID" | **Accept the schema as listed.** Owner: ________ | Expansion (P7) | |
| D-24 | **Baseline commit (G0)** | The assessed code (`9b129d6`) lives only on `origin/claude-opus4.5-refactor`, not `main`. (a) merge that branch **and** these docs into `main`, then start every phase from that commit · (b) keep phases on the branch and name it as the explicit base | **(a)**. Prompts branch from the named baseline, never an assumed `main`. | **G0 (blocking, before P0)** | **(a)** accept default — mojabbar, 2026-09-25. `9b129d6` + these docs fast-forwarded into `main`; the named base is the G0 sign-off commit on `main`. |
| D-25 | **Rewards** | Live-mode incentives: (a) **hidden until an approved, funded, redeemable offer inventory exists**; demo-only copy meanwhile, behind the demo badge · (b) keep showing example rewards | **(a)**. The app currently advertises $1–$4 gift cards nothing can pay (F-26). | P1 | **(a)** accept default — mojabbar, 2026-09-27 (chat; see §7) |
| D-26 | **Measurement design (G1)** | Before any impact claim, agree: the eligible-trip denominator, exposure/assignment (default: a randomized holdout), duplicate handling, the outcome tier (≥ 2 self-report; ≥ 3 verified), and a pre-declared decision rule. Owner: product + privacy. | **Default:** opt-in self-report with a randomized holdout; partner-verified trips as an upgrade. No traffic-reduction claim before Tier ≥ 3 data. | G1 (built in P7) | |
| D-27 | **P1 rollback mechanism** | (a) **no legacy engine**; roll back the P1 route change by reverting the PR · (b) keep an `INSIGHTS_ENGINE=legacy` runtime switch | **(a)**. A runtime switch that re-enables LLM-invented numbers defeats the refactor. | P1 | **(a)** accept default — mojabbar, 2026-09-27 (chat; see §7) |

> **Standing authority (maintainer, 2026-09-27 16:58 ET, verbatim):** *"you may accept the documented default for any
> decision unless it involves money, privacy, or G1."* The builder applies it only when a phase needs a decision, and records
> each use as "accepted under standing authority". **It stays with the maintainer:**
> - **D-14** budgets (money)
> - **D-23** privacy owner (privacy)
> - **D-10** and **D-26** (G1)
> - any paid data or service (such as D-7's licensed TomTom history)
> - §2 values that aren't documented defaults, such as `parking.applies_to_stops`

## 2. Assumptions table (the P1 source of truth; P3.5 moves it into the fact store)

> Coding agents copy **only** the "Approved value" column. Research supplied the proposed values; **a human
> verifies each one against the primary source**. Leave a cell blank to omit that output; the app then reports it
> in `meta.degraded`. The verbatim primary-source evidence for each proposal is in §2a.

| Key | Proposed value | Unit | Source (catalog) | Verification status | Approved value | Approved by / date |
|-----|----------------|------|------------------|---------------------|----------------|--------------------|
| `cost.basis` | **Marginal** (fuel + maintenance) for per-trip nudges. The total cost of ownership is used only for annual stats. | — | Policy (avoids overstating savings, R-13) | Decision | **Marginal** (fuel + maintenance) per trip; total cost of ownership for annual stats only | mojabbar, 2026-09-27 (chat; see §7) |
| `drive.fuel_price_usd_per_gal` | Latest EIA PADD 1C weekly regular price (live after P3.4). Latest week at research time: **4.163** (week of 2026-09-21) | USD/gal | S-11 | ✅ series; 🟡 week quoted in §2a; a human enters the value current at approval | **4.163** (EIA week of 2026-09-21; re-read 2026-09-27, still the latest) | mojabbar, 2026-09-27 (chat; see §7) |
| `drive.mpg` | **22.2** | mpg | S-13 (EPA typical vehicle) | 🟡 primary quoted in §2a; a human verifies | **22.2** | mojabbar, 2026-09-27 (chat; see §7) |
| `drive.maintenance_usd_per_mile` | **0.1104** (11.04¢/mile; includes an extended warranty, see §2a) | USD/mile | S-12 | 🟡 primary quoted in §2a; a human verifies | **0.1104** | mojabbar, 2026-09-27 (chat; see §7) |
| `drive.total_cost_usd_per_mile` (annual stats only) | **0.77** as printed (15k mi/yr). The earlier 0.7718 is derived ($11,577 ÷ 15,000), not printed | USD/mile | S-12 | 🟡 primary quoted in §2a; a human picks printed or derived | **0.77** (as printed) | mojabbar, 2026-09-27 (chat; see §7) |
| `parking.downtown_usd` | Standard City garage rate: $1 per 20 min ($3/h), $24 daily max (midnight to midnight). For self-paid daytime parking within one calendar day, with no discount or exemption, a workday (≥ 8 h) is **24.00** and a 2-h visit is 6.00. **A human picks the scenario.** | USD | S-15 | 🟡 primary quoted in §2a; the scenario is a decision | **24.00** (standard-rate workday) | mojabbar, 2026-09-27 (chat; see §7) |
| `parking.applies_to_stops` | The 10 Charleston-peninsula stops, by their exact keys in `src/app/data/busStopCoordinates.ts`: `Mary Street / Meeting Street`, `King Street / Morris Street`, `Market Street / Meeting Street`, `Calhoun Street / King Street`, `Broad Street / East Bay Street`, `Spring Street / Ashley Avenue`, `Lockwood Drive / Beaufain Street`, `Rutledge Avenue / Cannon Street`, `East Bay Street / Queen Street`, `King Street / Wentworth Street`. Parking applies when the trip's destination is one of them (P1); stop IDs in P4 | — | Policy | Decision. **Not approved yet**: the approval covered the concept, and this concrete list is new (2026-09-27) | | |
| `transit.base_fare_usd` | **2.00** (fixed-route one-way; Express is 3.50) | USD | S-15 (`ridecarta.com/fares-passes`) | 🟡 primary quoted in §2a; a human verifies | **2.00** | mojabbar, 2026-09-27 (chat; see §7) |
| `co2.car_g_per_mile` | **400** | g CO2/vehicle-mile | S-13 | 🟡 primary quoted in §2a; a human verifies | **400** | mojabbar, 2026-09-27 (chat; see §7) |
| `co2.car_occupancy` | 1.0 (a drive-alone commute) | persons | Policy | Decision | **1.0** | mojabbar, 2026-09-27 (chat; see §7) |
| `co2.bus_g_per_passenger_mile` | **~290** (0.64 lb, FTA "Bus Transit"), a historical **national** bus-average proxy, not a CARTA measurement. ⚠ The earlier ~204 (0.45 lb) was the chart's all-mode "Transit Average", not the bus figure; see §2a. **Stale (2010)**; replace with S-14b once available. | g CO2/pax-mile | S-14 | ⚠ corrected by research 2026-09-25; a human verifies the chart | **290** (2010 national bus-average proxy) | mojabbar, 2026-09-27 (chat; see §7) |
| `traffic.density_thresholds` | Light ≥ 0.85, Medium ≥ 0.60, Heavy < 0.60 (current/free-flow speed ratio), labeled "Traffic now" | ratio | Engineering default | Decision | Light ≥ 0.85, Medium ≥ 0.60, Heavy < 0.60; labeled "Traffic now" | mojabbar, 2026-09-27 (chat; see §7) |
| `transit.access_buffer_min` (D-21, D-6) | **5 min** walk-to-stop buffer; earliest boardable departure = now + buffer | min | Engineering default | Decision | **5** | mojabbar, 2026-09-27 (chat; see §7) |
| `incentive.policy` | **Demo-only until D-25 funded offers exist.** When live: eCredit within $0.50–$2.00 bounds, chosen deterministically. | USD | Product policy | Decision | Demo-only until D-25 funded offers exist; when live, eCredit within $0.50–$2.00, chosen deterministically | mojabbar, 2026-09-27 (chat; see §7) |
| `nudge.tone_rules` | 1–2 sentences; no false urgency or fear; **numbers by reference only**; "about" for estimates; no demographic targeting | — | Policy (R-13) | Decision | As proposed: 1–2 sentences; no false urgency or fear; numbers by reference only; "about" for estimates; no demographic targeting | mojabbar, 2026-09-27 (chat; see §7) |
| `headline.congestion` (display only) | TomTom Traffic Index 2025, Charleston **City** view: **35.5%** average congestion level and **48 h** lost in rush hour (10 km commute). The Metro view shows 32.9% and 39 h; label whichever you show | % / hours | S-9 | 🟡 primary read in §2a; a human verifies it on the page | **35.5%** congestion level and **48 h** lost in rush hour (TomTom 2025, **City** view; label it "City") | mojabbar, 2026-09-27 (chat; see §7) |

## 2a. Source evidence for the §2 proposals (research, retrieved 2026-09-25 ET)

> Research only; **this is not approval.** Each figure was read from the primary source on the date shown, and
> quotes are verbatim except for whitespace. The approver re-opens each link and fills "Approved value" in §2.

| Key | Evidence (verbatim) | Primary source | Notes for the approver |
|-----|---------------------|----------------|------------------------|
| `drive.fuel_price_usd_per_gal` | Title: "Weekly Lower Atlantic (PADD 1C) Regular All Formulations Retail Gasoline Prices (Dollars per Gallon)". 2026-Sep row: 09/07 3.860 · 09/14 4.041 · **09/21 4.163**. "Release Date: 9/22/2026" · "Next Release Date: 9/29/2026" | [EIA series page](https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=EMM_EPMR_PTE_R1Z_DPG&f=W) | Up 0.38 in three weeks (08/31 was 3.783). Re-read the latest week when approving. |
| `drive.mpg` | "This assumes the average gasoline vehicle on the road today has a fuel economy of about 22.2 miles per gallon and drives around 11,500 miles per year." | [EPA-420-F-23-014](https://www.epa.gov/greenvehicles/greenhouse-gas-emissions-typical-passenger-vehicle) ("Last updated on June 3, 2026") | On-road fleet average, not new cars |
| `co2.car_g_per_mile` | "How much tailpipe carbon dioxide (CO2) is emitted from driving one mile? The average passenger vehicle emits about 400 grams of CO2 per mile." | Same EPA page | Tailpipe only |
| `drive.maintenance_usd_per_mile` | "Maintenance, Repair & Tires 11.04¢/mile" — "Includes retail parts & labor for routine maintenance specified by the vehicle manufacturer, a comprehensive extended warranty, repairs to wear-and-tear items that require service during 5 years of operation & one set of replacement tires." | [AAA Your Driving Costs 2025 fact sheet](https://newsroom.aaa.com/wp-content/uploads/2025/09/UPDATE-AAA-Fact-Sheet-Your-Driving-Cost-9.2025-1.pdf), p. 1 | National average for new cars over 5 years / 75,000 miles. It includes an allocated extended-warranty cost, so it is not a pure marginal-cost figure. The sheet doesn't break the warranty out, so the overstatement is unquantified. Do not subtract an estimate by hand. |
| `drive.total_cost_usd_per_mile` | "The overall average cost to own and operate a new car in 2025 is $11,577 …" and "Average Ownership Costs Per Mile — Miles per Year 10k 15k 20k — Average Cost $1.00 77¢ 66¢" | Same AAA PDF, p. 1 | 0.77 is printed (15k mi/yr). 0.7718 is derived: $11,577 ÷ 15,000 mi, using the study's 75,000 mi over 5 years. |
| `parking.downtown_usd` | Under "Garages - Rates Per 20 Min", all 13 City garages list Rates "$1" and Daily Max* "$24". Footnote: "* Daily is 12 midnight to 12 midnight, computed per single parking event." Metered lots: "$3 Per Hour, Minimum 1 hour" (2-hour limit). | [City of Charleston, Where to Park](https://www.charleston-sc.gov/1025/Where-to-Park) (redirected from `/parking-information`) | The arithmetic ($1 per 20 min is $3/h, so 8 h or more reaches the $24 cap) holds only for **standard-rate, self-paid daytime parking within one calendar day**. The cap is per parking event, midnight to midnight, not a rolling 24 h. The same page lists exceptions: "Discounted Evening Rates" ("93 Queen Street: $7 flat rate fee after 3 p.m.; $5 flat rate fee after 5 p.m.", with $5 after 5 p.m. also at East Bay/Prioleau and Majestic), which "end at 3:00 AM", and free parking with a disability placard or plate. Visit or workday is a decision; the drive-alone commute framing (`co2.car_occupancy`) points to workday. Drivers with employer-paid parking save nothing on parking, and the page says "Currently there are no vacancies for any monthly accounts". |
| `transit.base_fare_usd` | "Fixed Route One-Way: $2.00/ride" · "Express One-Way: $3.50/ride" · "Transfers: No charge within two hours of the original trip" (under "Cash-Only Fares") | [CARTA Fares & Passes](https://ridecarta.com/fares-passes/) | `robots.txt` allows this path. `transit.base_fare_usd` is the standard fixed-route one-way fare. Reduced and free fares have conditions: seniors 55+ pay $1; riders with disabilities need a Disabled Fare ID Card for $0.75, or ride free with a Tel-A-Ride ID; K-12 students ride free "with a valid school ID"; children under 6 ride free but "Must be accompanied by a paying passenger". |
| `co2.bus_g_per_passenger_mile` | Slide 3 bar chart, "Pounds CO2 per Passenger Mile": Private Auto (SOV) 0.96 · **Bus Transit 0.64** · Heavy Rail Transit 0.22 · Light Rail Transit 0.36 · Commuter Rail 0.33 · Van Pool 0.22 · **Transit Average 0.45** | [FTA 2010 EPA-webinar deck](https://www.epa.gov/sites/default/files/2016-04/documents/public_transportations_role_in_responding_to_climate_change.pdf), slide 3 | ⚠ The earlier "bus ≈ 0.45 lb" was the all-mode average, which includes rail. For a bus-only agency, the national bus bar is the closer proxy: 0.64 lb × 453.59 g/lb ≈ **290 g**. It is still a 2010 national average, not CARTA's own intensity. Slides 4–5 ("Averages Mask Variability"; "From National Average to Local Specific") name vehicle efficiency, ridership and fuel/electricity carbon intensity as local drivers, hence S-14b. *Illustration only, under these per-mile assumptions:* against the 400 g car, 0.45 would show about 196 g saved per mile versus about 110 g with 0.64, so the old value overstated the saving (R-13). The chart is an image, so the values were read visually. |
| `headline.congestion` | "Charleston, SC, traffic in 2025", City view (the page default): "Average congestion level 35.5%" ("similar to 2024"); "Time lost due to traffic in rush hour in 2025": "48 hours" (10 km slider default). Metro view: 32.9% and "39 hours". | [TomTom Traffic Index, Charleston](https://www.tomtom.com/traffic-index/city/charleston-sc/) | JavaScript-rendered, so it was read in a browser. Label the area (City or Metro) wherever the figure appears. Cite with attribution; no bulk reuse (S-9). |

## 2b. Demo-stop mapping (P4b)

Fill this in once the GTFS feed is loaded (P3.1). Look up the stops with `tda` or `GET /v1/stops?query=`. Before
P4b, the demo scenarios use the P0 keys — all chosen to be within ~350 m of a real CARTA stop (verified against
the GTFS feed 2026-09-24). The weekend scenario is **not** Folly Beach; that stop is ~3.7 km from any CARTA stop.

| Scenario | P0 departure key | P0 destination key | GTFS departure `stop_id` / name | GTFS destination `stop_id` / name | Direct route? (`/v1/compare`) | Approved by / date |
|----------|------------------|--------------------|----------------------------------|------------------------------------|-------------------------------|--------------------|
| rush-hour | King Street / Morris Street | Spring Street / Ashley Avenue | | | | |
| weekend | Market Street / Meeting Street | Isle of Palms / 14th Avenue | | | | |
| night-out | King Street / Wentworth Street | Calhoun Street / King Street | | | | |

> Even these near-CARTA keys are approximate intersections, not confirmed served pairs. A human must verify each
> pair resolves to a real boardable trip in `/v1/compare` before P4b signs off; drop any scenario that doesn't.

## 3. Research findings (verified 2026-09-24)

The full data-source findings are in [03-data-source-catalog.md](./03-data-source-catalog.md). Technology facts
that drive the plan:

| Topic | Finding | Impact | Source |
|-------|---------|--------|--------|
| Gemini SDK | `@google/generative-ai` has been legacy/EOL since **2025-11-30**. The replacement is **`@google/genai`**, which needs Node ≥ 20. | P1 migration | github.com/google-gemini/deprecated-generative-ai-js; ai.google.dev/gemini-api/docs/migrate |
| Gemini model | `gemini-1.5-flash` **shut down** in Sept 2025 (the exact date comes from secondary sources). The current GA recommendation is `gemini-3.8-flash` (released 2026-09-02). | **The default AI path fails today**, so the P0 stopgap is needed | ai.google.dev/gemini-api/docs/models; /deprecations |
| OpenAI model | `gpt-3.5-turbo` is legacy, with **shutdown on 2026-10-23**. Recommended models: `gpt-5.6-terra` (balanced), `gpt-6-astra` (flagship), and `gpt-5.6-luna` (cost). | P0 stopgap before 2026-10-23 | developers.openai.com/api/docs/deprecations; /models |
| OpenAI API | The Responses API is recommended for new projects, and Structured Outputs (JSON Schema) is supported | P1 | developers.openai.com/api/docs/guides/migrate-to-responses; /structured-outputs |
| Next.js | Next 14 reached **EOL on 2025-10-26**, and the last 14.x is 14.2.35. 14.2.4 misses fixes including **CVE-2025-29927 (critical; middleware only, so not exploitable here)**, CVE-2024-46982 and CVE-2024-51479 (high), and CVE-2025-55184 and CVE-2025-67779 (high, Server Components DoS). **CVE-2026-23864, -23869, and -23870 (high) have no 14.x fix.** Next 16.x is Active LTS; Next 15 support ends 2026-10-21. | P0 patch, P0B upgrade | nextjs.org/support-policy; GitHub advisories GHSA-f82v-jwr5-mffw, GHSA-h25m-26qc-wcjf, GHSA-q4gf-8mx6-v5v3, GHSA-8h8q-6873-q5fj |
| Next 16 upgrade | Node ≥ 20.9 and TS ≥ 5.1. Codemod: `npx @next/codemod@canary upgrade latest`, plus `next-async-request-api`. **`next lint` is removed** (use the ESLint 9 flat config). Turbopack is the default. `next/image` defaults changed. `@hookform/resolvers` needs ≥ 5.4.1 and `lucide-react` needs ≥ 0.400 or 1.x for React 19. | P0B | nextjs.org/docs/app/guides/upgrading/version-16; npm registry peer dependencies |
| Python | 3.9 has been **EOL since 2025-10-31**. Current numpy needs ≥ 3.12. | P2 and P6 use 3.12 | devguide.python.org/versions |
| Agent framework | Pydantic AI 2.49 (MIT, Py ≥ 3.10; Gemini, OpenAI, and Anthropic; TestModel, FunctionModel, pydantic-evals). OpenAI Agents SDK 0.22.3. LangGraph 1.2.12. | D-3 | pypi.org/project/pydantic-ai; /openai-agents; /langgraph |
| GTFS libraries | gtfs-kit 13.0.1 (maintained), gtfs-realtime-bindings 3.0.0 (maintained), **partridge unmaintained** (last release 2023) | P3 | pypi.org |
| Chronos | `chronos-forecasting` 2.3.2 needs Py ≥ 3.10. Chronos-Bolt (CPU-friendly) and Chronos-2 supersede `chronos-t5-mini`. | P6 | github.com/amazon-science/chronos-forecasting |
| MCP | The Python SDK package is `mcp` 2.2.0 (MIT) | P5 optional | pypi.org/project/mcp |

## 4. Security and privacy checklist (re-run at P0, P0B, P5, and P7)

- [ ] The leaked Gemini key is **revoked** (D-13). HEAD has no secrets (`git grep -nE 'AIza[0-9A-Za-z_-]{20,}'` is empty), and PR secret scanning is on.
- [ ] Next.js is on a supported line (16.x), and `npm audit --omit=dev --audit-level=high` is clean for runtime dependencies.
- [ ] The Python services run on 3.12, in non-root containers, with debug off.
- [ ] No secret uses a `NEXT_PUBLIC_*` name, and `server-only` guards the env and LLM modules.
- [ ] Error responses are generic, and the details stay in server logs.
- [ ] LLM- and TomTom-backed routes are rate-limited before any public deploy.
- [ ] Admin and review endpoints are authenticated, and the DB roles are least-privilege (the reader can't write; grants are explicit).
- [ ] **The LLM has no write tools.** The runtime submits to the review queue only after validation; a failed run leaves no draft.
- [ ] Untrusted text (alerts, documents) is rendered as plain text. The extractor has no tools, and nothing
      auto-approves.
- [ ] Every enabled source is terms-reviewed, attribution is rendered, and `robots.txt` is honored.
- [ ] No PII is collected. Events are aggregate-only, with k ≥ 10 suppression.
- [ ] Budgets are enforced in code (reserved atomically) and at the provider (D-14).

## 5. Reviewer checklist (every phase PR)

- [ ] The preconditions were met, and the decisions and assumptions the phase uses are recorded here.
- [ ] The diff stays within the prompt's scope, with no drive-by refactors.
- [ ] The verification output is pasted in and matches the expected results. CI is green.
- [ ] New behavior has tests, and the failure paths are tested (degraded modes, guardrails).
- [ ] No invented numbers: every constant traces to §2 or to an approved fact.
- [ ] The docs are updated (CHANGELOG, CONTEXT, and the status table in the docs index).
- [ ] The rollback path (a flag or a revert) is understood and practical.

**Phase-specific checks**
- **P0:** the demo buttons work, the `/find-rides` error path works, the loading state clears on success, the
  bbox order is fixed, the key is redacted, and CI exists.
- **P0B:** the diff is behavior-neutral, and the screenshots match the pre-upgrade UI.
- **P1:** the narration validator rejects the swapped-fact counterexample; live mode shows no bus time and no
  reward; there is no legacy engine; the response is additive only.
- **P2:** proposed sources can't run; `/v1/facts` never leaks candidates; the reader role can't write; an
  append-then-rollback drill restores the prior value.
- **P3:** the terms review is recorded, loads are append-only, and a human ran the live smoke test.
- **P4:** every page number has a citation (or the page says "data unavailable"); demo mode is clearly badged;
  `/v1/compare` never returns a departed bus.
- **P5:** the model has no write tools; nothing reaches the queue before validation; the budget reservation
  holds under concurrency; the injection tests pass.
- **P6 (expansion):** no NYC data or randomness remains, and the backtest report is attached.
- **P7 (expansion):** the privacy doc is signed, the measurement design (D-26) is agreed, and the rate limits and
  alerts have been tested.

## 6. Connector sign-off (P3)

> **P3 authorization (maintainer, 2026-09-27 20:35 ET, verbatim):** *"prep p3. proceed with p3, as long as it does
> not cost me any money, and does not have privacy concerns, and does not cause anythin destructie in the system."*
> Follow-up, same evening (verbatim): *"you can also simulated data / use syntehetic data if lack of direct API access
> is causing a bottleneck"*.
>
> **What it covers:**
> - It authorizes **preparing and building** P3 under three conditions: no cost, no privacy concern, and nothing
>   destructive.
> - It is **not** the per-connector sign-off below, as the reviewer ruled on #16. For that, the maintainer must name
>   the connector rows, accept each terms determination (including any stated uncertainty), and say who runs the
>   live smoke tests.
> - The builder asked for this at about 21:00 ET, and the maintainer was not available, so **every row is pending**.
>
> Until the maintainer signs, the P3 prompt's procedure is unchanged:
> - The builder builds and tests each connector in its **own open PR**, reviewed as usual. **Nothing merges** until
>   that connector's row is signed.
> - Every source stays `proposed`, so running it only records `skipped_disabled`.
> - Synthetic data appears only as test fixtures, never as real observations.
>
> When a row is signed, that connector's PR gets the `status: approved` flip and the live smoke-test output (two
> ingestions plus the DB and DQ checks), then merges, as the P3 definition of done requires. Per the P3 prompt, a
> human runs the smoke tests unless the maintainer explicitly delegates them to the builder.
>
> **To sign, one reply is enough.** For example: *"approve gtfs_static and gtfs_rt_alerts (accepting the
> registry-only licence), ntd_monthly, eia_gas (bulk file), and reference_facts (candidates only); you may run the
> live smoke tests."* Name any subset.

The builder's assessment is in §6a. "Eligible" means that, in the builder's reading, the source meets the no-cost,
no-privacy, and non-destructive conditions. It is not a sign-off.

| Connector | Source | Stage | Terms reviewed by / date | `store_policy` | Key provisioned | Approved to enable |
|-----------|--------|-------|--------------------------|----------------|-----------------|--------------------|
| `gtfs_static` | S-1 | Pilot | prepared and re-verified by Claude Opus (builder), 2026-09-27; **human terms sign-off pending** | `ttl:180d` raw zip (D-18); normalized rows kept indefinitely; raw cited by a published fact kept regardless of TTL (03 §3.1) | n/a | ☐ pending: eligible, but the **licence is registry-only** (§6a), which the maintainer must accept explicitly or wait on CARTA/Trillium (D-20) |
| `ntd_monthly` | S-3 | Pilot | prepared and re-verified by the builder, 2026-09-27; **human sign-off pending** | `ttl:180d` raw (D-18); normalized rows kept indefinitely | n/a (the optional app token isn't used) | ☐ pending: eligible (public domain) |
| `reference_facts` | S-9, S-12…S-15 | Pilot | prepared by the builder, 2026-09-27; **human sign-off pending** | n/a: nothing is fetched | n/a | ☐ pending: eligible to load **`candidate`** facts only. Values are entered by a human (P3.5), and each fact still needs `tda review approve`. The cited sources stay `proposed` because nothing fetches them |
| `census_acs` | S-10 | Pilot (optional) | prepared and re-verified by the builder, 2026-09-27 | `ttl:180d` | ☐ **a key is required** (keyless calls redirect to `missing_key.html`) | ☐ not eligible yet: synthetic fixtures only until the maintainer supplies a free key and signs |
| `eia_gas` | S-11 | Pilot (optional) | prepared and re-verified by the builder, 2026-09-27; **human sign-off pending** | `ttl:180d` | n/a if the acquisition change is approved: EIA's official keyless bulk file of the same series (API v2 needs a registered key) | ☐ pending: eligible; the **acquisition change** needs the sign-off |
| `gtfs_rt_alerts` | S-2 | Pilot (optional) | prepared and re-verified by the builder, 2026-09-27; **human terms sign-off pending** | `ttl:30d` raw (P3 spec); normalized rows kept indefinitely | n/a | ☐ pending: eligible, with the same **registry-only licence** as S-1 (there's no alert-specific grant) |
| `scdot_counts` / `scdot_ccs_inbox` | S-6a/b/c | Expansion | the builder, 2026-09-27: **terms unclear** | | n/a | ⛔ not eligible: the SCDOT site says "All Rights Reserved" and publishes no data licence (which doesn't prove reuse is forbidden); the BCDCOG layer has no `licenseInfo`. Needs a maintainer decision or the D-20 data-sharing ask |
| `tomtom_sampler` | S-7/S-7b | Expansion | **requires D-7 (b) or (c)** | | ☐ | ⛔ excluded: paid and legal (D-7, D-14) |
| `nws` / `noaa_tides` / `nhtsa_fars` / `documents` | S-16/17/18/5/19/20 | Expansion | | | n/a | ☐ after G1 |

### 6a. Re-verification packets (P3 step A1, retrieved 2026-09-27 ET)

Every request used the D-18 User-Agent `TrypTransitDataAgent/0.1.0 (+https://github.com/mojabbar1/tryp_transit_0.2)`.
Compared with the 03 catalog:
- **Contradiction:** S-2 was listed as "`http`, not https", but `https` now works. P3's connector note anticipates
  this, and 03 is corrected.
- **Confirmations:** S-10 needs a key (03 already listed a free key); S-1 and S-3 are unchanged.
- **Additions:** S-11 has a keyless bulk file (an acquisition change, needing sign-off), and the S-6a footer.

| Source | Reachable today | Terms and licence | Cost / key | Personal data | Verdict |
|--------|-----------------|-------------------|------------|---------------|---------|
| **S-1** CARTA GTFS | `HEAD` 200: `Content-Length: 2888471`, `Last-Modified: Thu, 20 Aug 2026 17:30:59 GMT`, and an `ETag`, so conditional GETs work. `robots.txt` returns 404 (allowed). The feed has 1,108 stops, 24 routes, 5,050 trips, and 148,842 stop times, valid 20260820–20270527, matching 03 | **Registry-only:** [Transitland](https://www.transit.land/feeds/f-djz4-carta~sc~us) shows "Use allowed without attribution: Yes · Creating derived products allowed: Yes"; its licence URL, redistribution, and commercial-use fields are empty. `feed_info.txt` has an empty `feed_license`. **No publisher-confirmed licence was found.** The scope to sign off: raw zip 180 d; normalized rows indefinitely; derived facts published with CARTA/Trillium attribution; the raw feed never redistributed | free, no key | none: stops, routes, and schedules; the only contacts are the agency's public phone and Trillium's support address | eligible; the licence uncertainty needs explicit acceptance |
| **S-3** NTD monthly | `/api/views/8bui-9xvu.json` 200; the date field is `date` (`calendar_date`). The `ntd_id='40110'` query returns rows through 2026-07 (MB/PT UPT 224,397) | "Public Domain U.S. Government" (`USGOV_WORKS`) | free, no key | none: agency-level totals | eligible |
| **S-2** GTFS-RT alerts | **new:** `https://` works (200); `http://` also works. At check time the feed was a 15-byte header, meaning no active alerts | **Registry-only**, and less than S-1: "same publisher as S-1" is not an alert-specific grant. The scope to sign off: raw 30 d; normalized alerts indefinitely; no redistribution of the raw feed | free, no key | none: public service notices, stored as untrusted text (02 §7.3) | eligible; the licence uncertainty needs explicit acceptance |
| **S-11** EIA weekly gasoline | API v2 without a key: **403 `API_KEY_MISSING`**. **New:** EIA's own download of the same series, `https://www.eia.gov/dnav/pet/hist_xls/EMM_EPMR_PTE_R1Z_DPGw.xls`, returns 200 (120,320 bytes, `Last-Modified: Tue, 22 Sep 2026`) with no key, and `robots.txt` has no rule against `/dnav/` | public domain; [EIA's reuse terms](https://www.eia.gov/about/copyrights_reuse.php) allow use and redistribution with source acknowledgment. The bulk file is linked from EIA's [series page](https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=EMM_EPMR_PTE_R1Z_DPG&f=W). Prices are dated Mondays and EIA publishes on Tuesdays (released 2026-09-22; next 2026-09-29) | free; the bulk file needs no key | none | eligible via the bulk file (03 §2.1 preference 2); the acquisition change needs sign-off |
| **S-10** Census ACS | **New:** keyless calls redirect to `https://api.census.gov/data/missing_key.html` | public domain | free, but needs a registered key | none: published aggregates | not eligible yet: synthetic fixtures until a key exists |
| **S-9, S-12…S-15** reference facts | Not fetched. A human enters each value (P3.5: the agent leaves `value: null`), using the approved §2 values and the §2a evidence | cite with attribution; no bulk reuse | free | none | eligible, to load candidates only |
| **S-6a/b/c** SCDOT counts | **New:** the traffic-data page footer reads "© 2026 All Rights Reserved. Property of South Carolina Department of Transportation"; no data licence was found | unclear (the footer alone doesn't prove reuse is forbidden) | free | none: aggregate counts | not eligible: terms unclear |

## G0 — baseline gate (before P0)

- [x] D-24 answered: the assessed code (`9b129d6`) is an ancestor of `origin/main` (branch merged), **or** an
      explicit base commit is named for every phase. → (a): fast-forwarded into `main` on 2026-09-25.
- [x] These planning docs are committed.
- [x] D-13 recorded: the leaked Gemini key is confirmed revoked. → mojabbar, 2026-09-25.
- [x] A clean checkout of the named base contains every P0 input and passes the recorded baseline tests. → every
      file P0 reads or edits is present; `npm ci` OK; `npm test -- --ci` 4 suites / 28 tests passed (matches 01 §2).

Signed: mojabbar, 2026-09-25 (recorded by the P0 builder session on the maintainer's instruction).

## G1 — pilot gate (after P4b; before any expansion)

All must hold and be recorded below:

1. [ ] ≥ 20 real stop-pair queries match CARTA's published schedules on a human spot-check — including a
       departed-bus case, an overnight case, and a no-service case.
2. [ ] Every number on trip results and the stats pages resolves to an approved fact or a deterministic
       computation, with a citation (automated scan + spot-check).
3. [ ] A correction drill restores the prior value, sends dependent facts to `needs_review`, and keeps published
       history explainable.
4. [ ] An outage drill (data agent down) yields honest degraded results with no fabricated values.
5. [ ] Live mode shows no `unavailable`-basis bus time as a number and no unfunded reward.
6. [ ] D-26 (measurement design) is agreed and signed.
7. [ ] The go/no-go decision and the chosen expansion items (P5 agent tasks, P6 forecasting, extra connectors,
       scout, MCP, admin UI) are recorded.

| G1 item | Evidence / link | Signed by / date |
|---------|-----------------|------------------|
| Schedule spot-check | | |
| Provenance scan | | |
| Correction drill | | |
| Outage drill | | |
| No unsupported promises | | |
| Measurement design (D-26) | | |
| Go/no-go + expansion list | | |

## 7. Phase sign-off

| Phase | Stage | Approved to execute (name / date) | Decisions confirmed | PR | Merged (date) | Notes |
|-------|-------|-----------------------------------|---------------------|----|---------------|-------|
| **G0 baseline gate** | Gate | mojabbar / 2026-09-25 | D-24 ✅, D-13 ✅ | — | 2026-09-25 | Passed; baseline + docs on `main` |
| P0 Stabilize | Stabilize | mojabbar / 2026-09-25 | D-4 ✅, D-13 ✅, D-16 ✅, D-24 ✅ | [#3](https://github.com/mojabbar1/tryp_transit_0.2/pull/3) | 2026-09-25 (`fd52ce8`) | Reviewer R1 (real-key provider check) **waived at merge** by maintainer delegation ("proceed on what you think best objectively"; recorded by the builder, see #3). Carried forward as a **P1 precondition**. Waiver **ratified** by the maintainer 2026-09-27 (chat). |
| P0B Next 16 | Stabilize | mojabbar, by delegation / 2026-09-25 22:06 ("proceed on what you think best objectively"; recorded by the builder) | D-16 ✅ | [#4](https://github.com/mojabbar1/tryp_transit_0.2/pull/4) | 2026-09-25 (`5a7833a`) | **Exceptions (same delegation):** (1) started as a PR stacked on the unmerged #3, now rebased onto `main` after #3 merged; (2) Next **16.3.5**, not public-npm 16.3.6, because the corporate package proxy holds back releases for about 7 days. 16.3.6 fixes a `next/og` RCE, and `next/og` is unused here; bump once the proxy serves it (about 2026-09-29). The delegated sign-off and both exceptions were **ratified** by the maintainer 2026-09-27 (chat). |
| P1 Web seams | Pilot | mojabbar / 2026-09-27 12:32 ET, in chat ("approved. proceed", answering the builder's list: §2 values, D-15/D-21/D-25/D-27, #5, the delegated P0/P0B records, and P1 sign-off); transcribed by the builder. The real-key precondition is met by the maintainer's 14:20 ET decision to simulate (see Notes). | D-4 ✅, D-15 ✅, D-21 ✅, D-25 ✅, D-27 ✅, §2 ✅ except `parking.applies_to_stops` (no concrete list had been proposed) | [#12](https://github.com/mojabbar1/tryp_transit_0.2/pull/12) (P1a) · [#13](https://github.com/mojabbar1/tryp_transit_0.2/pull/13) (P1b) · [#14](https://github.com/mojabbar1/tryp_transit_0.2/pull/14) (P1c) | 2026-09-27: P1a `9a5fa76`, P1b `dd48054`, P1c on merge of #14 | Split into P1a/P1b/P1c by #5 (`2f82c86`). §2 choices are the proposals shown: 0.77 printed, the $24 workday, the TomTom City view, and 4.163 (still EIA's latest week on 2026-09-27). **Real-key check replaced by a simulated-provider check (maintainer decision, 2026-09-27 14:20 ET).** The maintainer wrote, verbatim: *"im confused. i dont have an api key. just simulate wha tyou need via copilot. proceed with im[plementation plan."* So the committed `live-provider-check.sh` was run with the providers redirected to a local simulator whose replies the builder authored: **PASS (simulated) gemini/gemini-3.8-flash @ 959e595, 2026-09-27** and **PASS (simulated) openai/gpt-5.6-terra @ 959e595, 2026-09-27**. **Real-provider behavior remains unverified** because no key exists. P1c's "(Human, with keys)" live step is simulated the same way. This supersedes the P1a/P1b-only exemption proposal. P1a was built before this decision; that is disclosed in #10 and #11. **Handoff:** the transit leg stays `basis: "unavailable"` (null `travelTime`, empty `additionalRides`) until P4 supplies `scheduled` GTFS timing. CO2 stays omitted until P4 supplies a bus distance, and parking until `parking.applies_to_stops` is approved. P3 (P3.4 EIA, P3.5 reference facts) moves every §2 approved value, now in `src/lib/domain/assumptions.ts`, into the fact store; the fuel price becomes weekly-live. |
| P2 Scaffold | Pilot | mojabbar / 2026-09-27 16:58 ET (chat: "approve P2 defaults, use the repo URL as the contact") | D-1 ✅, D-2 ✅, D-5 ✅, D-8 ✅, D-9 ✅ (dev/staging), D-11 ✅, D-18 ✅, D-19 ✅ | [#15](https://github.com/mojabbar1/tryp_transit_0.2/pull/15) | 2026-09-27 | GPT Astra reviewed in 3 rounds: REQUEST CHANGES (F1–F9), REQUEST CHANGES (R2-1 to R2-5), then **APPROVE** at `4a7797a` with no findings. Every finding was reproduced by the reviewer and fixed with a regression test. The CI `data-agent` job is green with `TDA_REQUIRE_DB_TESTS=1` (205 passed, 0 skipped). Merged by the builder under the maintainer's standing authority (no money, privacy, or G1 involved). Disclosed deviations are in #15, notably robots.txt via an RFC 9309 matcher instead of `urllib.robotparser`, and `sources[].retrieved` served from a reader-safe view. **Handoff to P3:** (1) all **25 sources** in `sources.yaml` are `proposed` and each needs its 03 §5 re-verification and a per-connector §6 sign-off; (2) all **5 corridors** in `regions/charleston.yaml` are drafts with no probe points; (3) D-20 outreach (CARTA, Transdev, BCDCOG, SCDOT asks) still has no owner, which is a human action and not blocking; (4) D-11: the two unmerged branches are archived as `archive/*` tags after merge. |
| P3 Connectors (core) | Pilot | | D-7, §6 | | | One PR per connector |
| P4a Metrics + read API | Pilot | | D-6 | | | |
| P4b Web integration | Pilot | | D-6, D-17, D-25, §2b | | | |
| **G1 pilot gate** | Gate | | D-26 | — | | Blocking; before expansion |
| P5 Agent + HITL | Expansion | | D-3, D-4, D-8, D-12, D-14 | | | Needs P1 + P4a |
| P6 Forecasting | Expansion | | D-10, D-22 | | | Only if D-10 keeps it |
| P7 Productionize | Expansion | | D-8, D-9, D-14, D-20, D-23, D-26 | | | PRs 7a–7d |
