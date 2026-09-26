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
| D-1 | Region scope | (a) Charleston first, region-pluggable config · (b) multi-region now | **(a)** | P2 | |
| D-2 | Where the data agent lives | (a) a new Python `data_agent/` service · (b) TypeScript inside Next.js · (c) extend `model_service` | **(a)**: best fit for GTFS, geo, PDF, scraping, scheduling, and agent tooling, with no load on the UX path | P2 | |
| D-3 | Agent framework | (a) **Pydantic AI 2.x** · (b) OpenAI Agents SDK 0.22.x · (c) LangGraph 1.x · (d) a thin custom loop | **(a)**: typed, multi-provider, has `TestModel`/`FunctionModel` and `pydantic-evals`, MIT | P5 | |
| D-4 | LLM providers and model IDs, **all from env** | Web narration: Gemini `gemini-3.8-flash` or OpenAI `gpt-5.6-terra`. Agent reports: the same, or a higher tier such as `gpt-6-astra`. Extraction: a cost tier such as `gpt-5.6-luna` or `gemini-3.8-flash`. | **Gemini `gemini-3.8-flash` everywhere to start** (the existing default provider), with OpenAI `gpt-5.6-terra` as the alternate. **Re-check the IDs at execution time.** | **P0** (stopgap), P1, P5 | Accept default — mojabbar, 2026-09-25 (IDs re-checked in P0 T8) |
| D-5 | Storage | (a) Postgres 16 via compose, PostGIS later if needed · (b) SQLite or DuckDB file · (c) managed Postgres | **(a)**, which also matches the pattern on the unmerged branch | P2 | |
| D-6 | How transit travel time is computed | (a) GTFS direct-route scheduled lookup · (b) OpenTripPlanner 2 (transfers, walking) · (c) a third-party routing API | **(a)** in P4, and (b) as a later upgrade if transfers matter | P4 | |
| D-7 | Traffic history and TomTom storage | (a) TomTom **live only**, no persistence; time-of-day patterns from SCDOT hourly counts (inbox) plus AADT · (b) buy TomTom Traffic Stats · (c) store live samples after a **written legal approval** of TomTom's terms · (d) NPMRDS through a partnership | **(a)** now, with (b) or (d) considered after P4 shows value | P3 | |
| D-8 | Human review surface | (a) CLI plus PR-published Markdown · (b) (a) plus an admin web UI in P7 (needs Auth.js) | **(a)**, revisited in P7 | P2, P5, P7 | |
| D-9 | Hosting and scheduling | (a) docker-compose on one VM, with an APScheduler worker · (b) managed containers or jobs (Azure Container Apps, AWS ECS, Render, Fly) · (c) GitHub Actions cron plus a managed DB | **(a)** for dev and staging; decide prod in P7 | P2 (local), P7 | |
| D-10 | Future of `model_service` | (a) keep it separate and retarget it to CARTA data through the data-agent API · (b) merge it into `data_agent` · (c) retire forecasting | **Decide at G1.** It leaves the live path in P1 regardless; whether to build P6 at all is an expansion decision. | G1 (was P6) | |
| D-11 | Unmerged branches `feature/economic-incentive-improvements` and `demo-improvements-20250813` | (a) harvest the patterns without merging, and archive the branches after P2 · (b) merge · (c) delete | **(a)**. Note that the second branch holds the key string (D-13). | P2 | |
| D-12 | Scout (source discovery with web search) | (a) off · (b) on, CLI-only, with proposals going to the queue | **(a)** | P5 | |
| D-13 | Handling the leaked Gemini key | (a) confirm it's **revoked**, redact the docs, and add PR-diff secret scanning · (b) additionally rewrite history with `git filter-repo` and force-push every affected branch | **(a)**. Choose (b) only if the key isn't confirmed revoked, or policy requires it. | **P0 (blocking)** | **(a)** accept default. Revoked? ☑ yes, confirmed by mojabbar on 2026-09-25. String redacted from `REFACTORING_PLAN.md` at G0. |
| D-14 | Budgets | LLM monthly cap; per-run caps; TomTom plan (free ~2,500 non-tile/day vs paid); any Traffic Stats spend | **Suggested:** LLM ≤ $25/month during development (a provider-side cap plus a code cap), the TomTom free tier, and no paid historical data before P4 | P5 (P1 for web LLM calls) | |
| D-15 | Where trip narration runs | (a) in the web app, sharing the validator vectors · (b) data agent `/v1/narrate` | **(a)**, the low-latency path | P1 | |
| D-16 | Framework upgrade | (a) 14.2.35 as a stopgap in P0, then **Next 16.x** in P0B · (b) Next 15 | **(a)**. Next 15 support ends 2026-10-21. | P0 | **(a)** accept default — mojabbar, 2026-09-25 |
| D-17 | Demo mode | (a) one app-wide `NEXT_PUBLIC_DEMO_MODE` flag (default off) gates the demo scenarios, the dashboard constants, **and** the `/incentives` + `/routes` reward copy, each with a visible badge · (b) remove the demo artifacts | **(a)** | P4 | |
| D-18 | Retention, attribution, and crawler identity | Raw public-domain snapshots: 180 days (normalized data kept indefinitely). TomTom: `none`. UA: `TrypTransitDataAgent/<ver> (+<contact>)`. | **Accept these**, and supply the contact email: ________ | P2 | |
| D-19 | Tooling | (a) uv, Python 3.12, Node 22 LTS, npm | **(a)** | P2 | |
| D-20 | Partnerships and outreach (not blocking) | Ask CARTA or Transdev for GTFS-RT vehicle positions and trip updates, plus route-level ridership. Ask BCDCOG or SCDOT for NPMRDS. Ask SCDOT for a 511 data share. | **Send the asks during P2.** Owner: ________ | — | |
| D-21 | Transit time before GTFS lands (P1 to P4) | (a) show it as **`unavailable`** in live mode — drive time, cost, and current traffic still render — (b) a flagged heuristic estimate · (c) show nothing at all | **(a)**. A heuristic "bus time" is an unsupported promise (half the current stops aren't even near CARTA service). Bus time becomes real in P4. | P1 | |
| D-22 | Forecast model backend (`model_service`) | (a) statistical: seasonal-naive vs ETS, chosen by backtest · (b) Chronos-Bolt on CPU · (c) Chronos-2 | **(a)**, with (b) behind `MODEL_BACKEND` only if it beats (a) in the backtest | P6 | |
| D-23 | Privacy review owner and the impact-event schema | Owner name; approve the event list (`nudge_shown`, `cta_carta_fares_click`, `trip_planned`, `demo_vs_live`), the fields (hour-truncated time, corridor or route ID, variant, demo flag), k = 10 suppression, and "no IP, no user ID" | **Accept the schema as listed.** Owner: ________ | Expansion (P7) | |
| D-24 | **Baseline commit (G0)** | The assessed code (`9b129d6`) lives only on `origin/claude-opus4.5-refactor`, not `main`. (a) merge that branch **and** these docs into `main`, then start every phase from that commit · (b) keep phases on the branch and name it as the explicit base | **(a)**. Prompts branch from the named baseline, never an assumed `main`. | **G0 (blocking, before P0)** | **(a)** accept default — mojabbar, 2026-09-25. `9b129d6` + these docs fast-forwarded into `main`; the named base is the G0 sign-off commit on `main`. |
| D-25 | **Rewards** | Live-mode incentives: (a) **hidden until an approved, funded, redeemable offer inventory exists**; demo-only copy meanwhile, behind the demo badge · (b) keep showing example rewards | **(a)**. The app currently advertises $1–$4 gift cards nothing can pay (F-26). | P1 | |
| D-26 | **Measurement design (G1)** | Before any impact claim, agree: the eligible-trip denominator, exposure/assignment (default: a randomized holdout), duplicate handling, the outcome tier (≥ 2 self-report; ≥ 3 verified), and a pre-declared decision rule. Owner: product + privacy. | **Default:** opt-in self-report with a randomized holdout; partner-verified trips as an upgrade. No traffic-reduction claim before Tier ≥ 3 data. | G1 (built in P7) | |
| D-27 | **P1 rollback mechanism** | (a) **no legacy engine**; roll back the P1 route change by reverting the PR · (b) keep an `INSIGHTS_ENGINE=legacy` runtime switch | **(a)**. A runtime switch that re-enables LLM-invented numbers defeats the refactor. | P1 | |

## 2. Assumptions table (the P1 source of truth; P3.5 moves it into the fact store)

> Coding agents copy **only** the "Approved value" column. Research supplied the proposed values; **a human
> verifies each one against the primary source**. Leave a cell blank to omit that output; the app then reports it
> in `meta.degraded`.

| Key | Proposed value | Unit | Source (catalog) | Verification status | Approved value | Approved by / date |
|-----|----------------|------|------------------|---------------------|----------------|--------------------|
| `cost.basis` | **Marginal** (fuel + maintenance) for per-trip nudges. The total cost of ownership is used only for annual stats. | — | Policy (avoids overstating savings, R-13) | Decision | | |
| `drive.fuel_price_usd_per_gal` | Latest EIA PADD 1C weekly regular price (live after P3.4) | USD/gal | S-11 | ✅ series; a human enters the current value for P1 | | |
| `drive.mpg` | ~22.2 | mpg | S-13 (EPA typical vehicle) | 🟡 secondary | | |
| `drive.maintenance_usd_per_mile` | From the AAA 2025 fact sheet | USD/mile | S-12 | ❔ extract from the PDF | | |
| `drive.total_cost_usd_per_mile` (annual stats only) | ~0.7718 (overall average) | USD/mile | S-12 | 🟡 secondary | | |
| `parking.downtown_usd` | City garage rate for a typical visit or workday | USD | S-15 | ❔ extract | | |
| `parking.applies_to_stops` | The list of downtown stop names (P1) or stop IDs (P4) | — | Policy | Decision | | |
| `transit.base_fare_usd` | CARTA base one-way fare | USD | S-15 (`ridecarta.com/fares-passes`) | ❔ extract | | |
| `co2.car_g_per_mile` | ~400 | g CO2/vehicle-mile | S-13 | 🟡 secondary | | |
| `co2.car_occupancy` | 1.0 (a drive-alone commute) | persons | Policy | Decision | | |
| `co2.bus_g_per_passenger_mile` | ~204 (0.45 lb). **Stale (2010)**; replace with S-14b once available. | g CO2/pax-mile | S-14 | 🟡 secondary | | |
| `traffic.density_thresholds` | Light ≥ 0.85, Medium ≥ 0.60, Heavy < 0.60 (current/free-flow speed ratio), labeled "Traffic now" | ratio | Engineering default | Decision | | |
| `transit.access_buffer_min` (D-21, D-6) | **5 min** walk-to-stop buffer; earliest boardable departure = now + buffer | min | Engineering default | Decision | | |
| `incentive.policy` | **Demo-only until D-25 funded offers exist.** When live: eCredit within $0.50–$2.00 bounds, chosen deterministically. | USD | Product policy | Decision | | |
| `nudge.tone_rules` | 1–2 sentences; no false urgency or fear; **numbers by reference only**; "about" for estimates; no demographic targeting | — | Policy (R-13) | Decision | | |
| `headline.congestion` (display only) | TomTom Traffic Index, Charleston (~35.5% congestion level, ~48 h lost per driver, 2025) | % / hours | S-9 | 🟡 secondary; a human verifies it on the page | | |

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

| Connector | Source | Stage | Terms reviewed by / date | `store_policy` | Key provisioned | Approved to enable |
|-----------|--------|-------|--------------------------|----------------|-----------------|--------------------|
| `gtfs_static` | S-1 | Pilot | | | n/a | ☐ |
| `ntd_monthly` | S-3 | Pilot | | | n/a (app token optional) | ☐ |
| `reference_facts` | S-9, S-12…S-15 | Pilot | | | n/a | ☐ |
| `census_acs` | S-10 | Pilot (optional) | | | ☐ | ☐ |
| `eia_gas` | S-11 | Pilot (optional) | | | ☐ | ☐ |
| `gtfs_rt_alerts` | S-2 | Pilot (optional) | | | n/a | ☐ |
| `scdot_counts` / `scdot_ccs_inbox` | S-6a/b/c | Expansion | | | n/a | ☐ |
| `tomtom_sampler` | S-7/S-7b | Expansion | **requires D-7 (b) or (c)** | | ☐ | ☐ |
| `nws` / `noaa_tides` / `nhtsa_fars` / `documents` | S-16/17/18/5/19/20 | Expansion | | | n/a | ☐ |

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
| P0 Stabilize | Stabilize | mojabbar / 2026-09-25 | D-4 ✅, D-13 ✅, D-16 ✅, D-24 ✅ | [#3](https://github.com/mojabbar1/tryp_transit_0.2/pull/3) | 2026-09-25 (`fd52ce8`) | Reviewer R1 (real-key provider check) **waived at merge** by maintainer delegation ("proceed on what you think best objectively"; recorded by the builder, see #3). Carried forward as a **P1 precondition**. |
| P0B Next 16 | Stabilize | mojabbar, by delegation / 2026-09-25 22:06 ("proceed on what you think best objectively"; recorded by the builder) | D-16 ✅ | [#4](https://github.com/mojabbar1/tryp_transit_0.2/pull/4) | 2026-09-25 (`5a7833a`) | **Exceptions (same delegation):** (1) started as a PR stacked on the unmerged #3, now rebased onto `main` after #3 merged; (2) Next **16.3.5**, not public-npm 16.3.6, because the corporate package proxy holds back releases for about 7 days. 16.3.6 fixes a `next/og` RCE, and `next/og` is unused here; bump once the proxy serves it (about 2026-09-29). |
| P1 Web seams | Pilot | | D-4, D-15, D-21, D-25, D-27, §2 | | | **Precondition:** the real-key provider check carried from P0 (R1). Split into P1a/P1b/P1c is proposed in #5. |
| P2 Scaffold | Pilot | | D-1, D-2, D-5, D-8, D-9, D-11, D-18, D-19 | | | |
| P3 Connectors (core) | Pilot | | D-7, §6 | | | One PR per connector |
| P4a Metrics + read API | Pilot | | D-6 | | | |
| P4b Web integration | Pilot | | D-6, D-17, D-25, §2b | | | |
| **G1 pilot gate** | Gate | | D-26 | — | | Blocking; before expansion |
| P5 Agent + HITL | Expansion | | D-3, D-4, D-8, D-12, D-14 | | | Needs P1 + P4a |
| P6 Forecasting | Expansion | | D-10, D-22 | | | Only if D-10 keeps it |
| P7 Productionize | Expansion | | D-8, D-9, D-14, D-20, D-23, D-26 | | | PRs 7a–7d |
