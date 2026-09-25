# 04 — Implementation Plan

## Refactor Plan: Tryp Transit v0.3 — stabilize, add seams, and build the Transit Intelligence Agent

> Execute **one phase at a time** using the matching prompt in [`prompts/`](./prompts/). Every phase ends with a
> green build and a human-merged PR. Findings (F-n) are defined in
> [01-current-state-assessment.md](./01-current-state-assessment.md), decisions (D-n) in
> [05-decisions-and-review.md](./05-decisions-and-review.md), and sources (S-n) in
> [03-data-source-catalog.md](./03-data-source-catalog.md).

### Current State

The app is a Next.js 14.2.4 UI plus one live API route (`/api/transit-insights`). That route sends raw TomTom
JSON and a fabricated ridership number to an LLM, and the LLM invents every number the user sees. Stops are
synthetic, and the Python service forecasts from NYC data. Static stats pages have no sources. `next build` fails,
two of three trip flows are broken, and there's no CI, no data store, no ingestion, and no review workflow.

### Target State

- A **green, CI-gated** web app. Its `/api/transit-insights` computes numbers **deterministically** (TomTom routing
  and speed ratios, a cost/CO2 model, and GTFS schedules) and uses the LLM **only to narrate** validated facts,
  with provenance in `meta`.
- A new **`data_agent/`** Python service with a source registry and a polite fetcher. It has connectors for
  CARTA GTFS, NTD, Census, EIA, SCDOT, and TomTom (as the terms allow), a Postgres store with provenance, and
  deterministic metrics and **cited facts**. It serves a read API, and it runs an **LLM agent** (Analyst,
  Narrator, Extractor, Scout) that writes only to a **human review queue**.
- `model_service/` forecasts from **Charleston** data. The dashboard and stats pages show **approved, cited**
  facts, with demo metrics behind a flag.

### Phase map

```
P0 ──► P0B ──► P1 ───────────────────────────────┐
 │                                               ▼
 └──► P2 ──► P3 ──► P4a (metrics + read API) ──► P4b (web integration) ──► P6 (forecasting) ──┐
                     │                                                                         ├──► P7
                     └──► P5 (agent + HITL) ───────────────────────────────────────────────────┘
```

Edges: P4b needs **P1 and P4a**. P5 needs **P4a** and runs in parallel with P4b and P6, since it touches only
`data_agent/`. P6 needs **P4b** (both edit `src/lib/insights/v2.ts`) and runs in parallel with P5. P7 needs
**P4b, P5, and P6**, or D-10 = retire.

| Phase | Size | Parallel-safe with | Prompt |
|-------|------|--------------------|--------|
| P0 Stabilize & secure the baseline | S (1–2 d) | none | [phase-0](./prompts/phase-0-stabilize.md) |
| P0B Framework upgrade (Next 16.x, React 19, Node 22) | S–M (1–3 d) | P2 | [phase-0b](./prompts/phase-0b-framework-upgrade.md) |
| P1 Web contracts, LLM seam, deterministic trip math | M (3–5 d) | P2, P3 | [phase-1](./prompts/phase-1-web-seams.md) |
| P2 `data_agent` scaffold, storage, polite fetcher | M (3–4 d) | P0B, P1 | [phase-2](./prompts/phase-2-data-agent-scaffold.md) |
| P3 Core connectors (one PR per connector) | L (5–8 d) | P1 | [phase-3](./prompts/phase-3-connectors.md) |
| P4a Metrics, facts, read API (`data_agent/`) | M (3–4 d) | P1 | [phase-4 (PR 4a)](./prompts/phase-4-metrics-api-integration.md) |
| P4b App integration (`src/`) | M (2–3 d) | P5 | [phase-4 (PR 4b)](./prompts/phase-4-metrics-api-integration.md) |
| P5 Agent runtime, guardrails, HITL, weekly report | L (5–8 d) | P4b, P6 | [phase-5](./prompts/phase-5-agent-hitl.md) |
| P6 Forecasting on real data (`model_service`) | M (3–5 d) | P5 | [phase-6](./prompts/phase-6-forecasting.md) |
| P7 Productionize, measure impact, clean up | M–L | none | [phase-7](./prompts/phase-7-productionize.md) |

Sizes assume one engineer working with a coding agent, and they exclude review wait time.

### Affected Files

| File | Change type | Phase | Dependencies |
|------|-------------|-------|--------------|
| `src/app/test/page.tsx` | modify (typed; calls `/api/health`) | P0 | blocks the green build |
| `src/app/api/health/route.ts` | create | P0 | blocks the `/test` page |
| `src/__tests__/lib/convertToUTC.test.ts` | modify (fake timers) | P0 | blocks the green build; replaced in P1 |
| `src/types/next-image.d.ts` | create (`/// <reference types="next/image-types/global" />`) | P0 | enables standalone `tsc` in CI |
| `src/package.json` | modify (`typecheck` script; Next 14.2.35 in P0; Next 16 + React 19 in P0B; `@google/genai` in P1) | P0, P0B, P1 | blocks CI |
| `src/.eslintrc.json` → `src/eslint.config.mjs` | migrate, if Next 16 requires flat config or the ESLint CLI | P0B | blocked by P0 |
| `src/next.config.mjs`, `src/tsconfig.json` | modify (codemod output) | P0B | — |
| `src/app/find-rides/page.tsx` | modify (→ `/api/transit-insights`; error handling) | P0 | blocked by nothing |
| `src/app/page.tsx` | modify (demo stop keys; demo skips coordinate check; interval cleanup; `$` formatting) | P0, P1, P4 | P4 stop IDs |
| `src/app/api/transit-insights-demo/route.ts` | modify (numeric savings; `meta.demo`) | P0, P1 | P1 contracts |
| `.gitignore` | modify (drop global `*.json`, `*.csv`, `*.parquet`, `public`; add targeted rules) | P0 | blocks P1 vectors, P2 configs, P3 fixtures |
| `model_service/.env`, `model_service/__pycache__/*`, `.DS_Store`, `model_service/.DS_Store` | untrack (`git rm --cached`) | P0 | — |
| `REFACTORING_PLAN.md` | modify (redact key string) | P0 | blocked by the maintainer committing pending edits |
| `model_service/app.py` | modify (debug from env; generic errors) → rewrite v2 | P0, P6 | — |
| `model_service/Dockerfile`, `model_service/.dockerignore` | modify / create | P0 (port), P6 (base image) | — |
| `src/lib/api/tomtom.ts` | modify (server-only env, typed, timeouts, routing, allSettled) | P0 (env rename), P1 | blocks P1 domain |
| `.github/workflows/ci.yml` | create → extend | P0, P2, P7 | gates every later PR |
| `README.md`, `SETUP.md`, `DEMO_CHECKLIST.md`, `CONTEXT.md`, `CHANGELOG.md`, `start-app.sh` | modify (fix dead refs; document changes) | every phase | — |
| `src/lib/contracts/transit-insights.ts` | create (zod; source of truth) | P1 | blocks the route refactor and P4 client |
| `src/types/interfaces.ts`, `src/contexts/travel-context.tsx` | modify (re-export contract types; dedupe) | P1 | blocked by contracts |
| `src/lib/env.ts` | create (server-only zod env) | P1 | blocks the LLM seam |
| `src/lib/domain/{time,traffic,cost,emissions,assumptions}.ts` | create | P1 | blocked by contracts |
| `src/lib/convertToUTC.ts` | delete (imported but unused in `route.ts:10`; replaced by `domain/time.ts`) | P1 | tests updated |
| `src/lib/llm/{provider,gemini,openai,narrate,validate-claims}.ts` | create (replaces `lib/api/gemini.ts` and `openai.ts`) | P1 | blocked by env |
| `src/lib/api/{gemini,openai,index}.ts` | delete or modify (move to `lib/llm`, keep re-exports for one release) | P1 | callers updated |
| `contracts/claim-validation.vectors.json` | create (shared test vectors) | P1 | used by P5 |
| `src/app/api/transit-insights/route.ts` | modify (thin orchestrator) | P1, P4 | blocked by domain and LLM |
| `src/__tests__/**` | create or modify (route, domain, LLM, contract tests) | P1, P4 | — |
| `data_agent/**` | create | P2–P5 | blocked by P0 `.gitignore` |
| `docker-compose.yml`, `.env.example` (root) | create | P2 | harvests the pattern from the unmerged branch (D-11) |
| `contracts/data-agent.openapi.json` | create (exported snapshot) | P2, P4 | blocks the P4 web client |
| `src/lib/api/data-agent.ts`, `src/app/api/{stats,stops}/route.ts` | create | P4 | blocked by P4 API |
| `src/app/data/busStops.ts`, `busStopCoordinates.ts` | replace with `/api/stops` plus the committed fallback `stops.fallback.generated.ts`; delete only after the rollback test passes | P4b | blocked by P3 GTFS and P4a |
| `src/app/{dashboard,emissions-stats,safety-cost-comparison,routes}/page.tsx` | modify (render cited facts; demo flag) | P4 | blocked by `/api/stats` |
| `reports/**` | create (published reports) | P5 | blocked by P5 |
| `model_service/*.py`, `model_service/requirements.txt`, `model_service/data/MTA_*.csv` | rewrite, modify, delete | P6 | blocked by P3 NTD |
| `src/lib/api/ridership.ts` | modify (v2 endpoints) | P6 | same PR as the model_service v2 |

---

### Execution Plan

#### Phase 0 — Stabilize & secure the baseline

*Fixes F-01…F-04, F-12, F-13 (partial), F-14, F-15 (port), F-16 (CI), F-21 (demo). Entry: D-13 and D-16 answered;
a human has confirmed the leaked key is revoked; the maintainer's pending edits to `CHANGELOG.md`,
`CLEAN_SUMMARY.md`, and `REFACTORING_PLAN.md` are committed.*

- [ ] 0.1 Replace the `/test` page body with a typed call to a new `GET /api/health`. It returns the
      `ridership` status and the `llm`/`traffic` configured flags as booleans only, never secrets.
- [ ] 0.2 Fix `__tests__/lib/convertToUTC.test.ts` with `jest.useFakeTimers().setSystemTime(...)`. Add
      `src/types/next-image.d.ts` and a `"typecheck": "tsc --noEmit"` script.
- [ ] 0.3 Point `/find-rides` at `POST /api/transit-insights`, sending the correct body (drop `currentLocation`).
      Show an inline error and **don't** navigate on failure.
- [ ] 0.4 Demo scenarios: set departure and destination to existing stop keys (rush-hour:
      `King Street / Morris Street` to `Spring Street / Ashley Avenue`; weekend: `Market Street / Meeting Street`
      to `Folly Beach / Center Street`; night-out: `King Street / Wentworth Street` to `Calhoun Street / King Street`).
      Skip the coordinate check when `demoMode` is set. Clear the loading interval on early returns. Return demo
      savings without a `$`.
- [ ] 0.5 `.gitignore`: remove the global `*.json`, `*.csv`, `*.parquet`, and `public` rules. Add targeted rules
      (`data_agent/raw/`, `data_agent/inbox/`, `data_agent/.cache/`, `*.local.*`, `coverage/`). Run
      `git rm --cached` on `model_service/.env`, `model_service/__pycache__/`, `.DS_Store`, and
      `model_service/.DS_Store`. Add `model_service/.dockerignore`.
- [ ] 0.6 Redact the key string in `REFACTORING_PLAN.md`. Add a secret-scanning CI job. Record the D-13 outcome
      (history rewrite: yes or no; handling of the remote branch `origin/demo-improvements-20250813`).
- [ ] 0.7 Security quick wins:
  - Flask debug comes from env (default off).
  - Generic error bodies plus a server-side log in `model_service/app.py` and `route.ts`.
  - Rename `NEXT_PUBLIC_TOMTOM_API_KEY` → `TOMTOM_API_KEY`, with a fallback read and a deprecation warning.
  - Upgrade `next` and `eslint-config-next` to **14.2.35**, the last 14.x release (F-22 stopgap; P0B completes it).
- [ ] 0.8 `model_service/Dockerfile`: `EXPOSE 5001` and `gunicorn -b 0.0.0.0:5001 app:app`.
- [ ] 0.9 CI `.github/workflows/ci.yml`:
  - web: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`
  - python: `python -m py_compile model_service/*.py`
  - secret scan
- [ ] 0.10 Docs: fix the dead references (`SETUP.md:27,76`, `DEMO_CHECKLIST.md:21`, `start-app.sh:156`), rename
      the env var in `README.md` and `CONTEXT.md`, and add a `CHANGELOG.md` entry for **v0.2.2**.
- [ ] 0.11 ⏰ **Model-ID stopgap (F-11, time-critical).** `gemini.ts` and `openai.ts` read `GEMINI_MODEL` and
      `OPENAI_MODEL` from env instead of hard-coding them. Defaults are set to currently supported IDs (see 05
      §Research; confirm them at execution time). Keep the SDKs for now; P1 migrates them. A human verifies each
      configured provider with a real key before merge.
- [ ] **Verify:**
  - `cd src && npm ci && npm run lint && npm run typecheck && npm test && npm run build` exits with code 0.
  - Manually click each demo scenario: results render with no `$$`.
  - `/find-rides` shows an error or the `/routes` values; it never redirects silently.
  - `git ls-files | grep -cE '__pycache__|\.DS_Store|model_service/\.env$'` → `0`.
  - `git grep -nE 'AIza[0-9A-Za-z_-]{20,}'` → no matches.
  - With a real key, a live `POST /api/transit-insights` returns 200 for each configured provider (human-run).
  - CI is green on the PR.

#### Phase 0B — Framework upgrade: Next 16.x, React 19, Node 22 *(parallel-safe with P2)*

*Fixes F-22. Entry: P0 merged; D-16 answered. Keep this PR **behavior-neutral**: no feature changes.*

- [ ] 0B.1 Run the official upgrade codemod (the exact invocation is in the prompt, from 05 §Research). Bump
      `next`, `react`, `react-dom`, `@types/react`, `@types/react-dom`, and `eslint-config-next` to the matching
      versions. Set `"engines": { "node": ">=20.9" }`. CI uses Node 22 LTS.
- [ ] 0B.2 Apply the breaking changes the app actually hits:
  - async request APIs, if any are used
  - route-handler caching defaults
  - the `next lint` → ESLint CLI switch (flat config, if required)
  - Turbopack default
  - `next/image` and `next/font` changes
- [ ] 0B.3 Check the UI libraries for React 19 compatibility (Radix, react-hook-form, `@hookform/resolvers`,
      lucide-react), and bump only what's required.
- [ ] 0B.4 Update `README.md`, `SETUP.md`, and `CONTEXT.md` for Node and scripts. Add a CHANGELOG entry
      (**v0.2.3**).
- [ ] **Verify:**
  - The web suite passes (lint, typecheck, test, build).
  - `npm run dev` smoke test: home page, the three demo scenarios, `/find-rides` → `/routes`, `/dashboard`,
    the stats pages, and `/test`.
  - `npm audit --omit=dev` shows no high or critical findings for `next`.

#### Phase 1 — Web contracts, LLM seam, deterministic trip math *(parallel-safe with P2)*

*Fixes F-05 (partial), F-09, F-10, F-11, F-17, F-18 (web), F-21. Entry: P0B merged; D-4 and D-15 answered; the
assumptions table in 05 is approved.*

- [ ] 1.1 Add `src/lib/contracts/transit-insights.ts` (zod request and response, plus optional `comparison` and
      `meta`). `types/interfaces.ts` and `travel-context.tsx` re-export or infer from it; delete the duplicate types.
- [ ] 1.2 Add `src/lib/env.ts`. It is server-only, validated with zod, and reads `LLM_PROVIDER`, `LLM_MODEL`,
      `USE_GEMINI` (as an alias), `TOMTOM_API_KEY`, `RIDERSHIP_API_BASE_URL`, `REGION_TIMEZONE`
      (default `America/New_York`), `DATA_AGENT_BASE_URL?`, and `INSIGHTS_ENGINE` (`v2` | `legacy`).
- [ ] 1.3 Add `src/lib/domain/`:
  - `time.ts`: region-timezone parsing and a horizon in minutes. It replaces `calculateHoursUntilDestination` and
    the unused `convertToUTC`. Test the DST boundaries.
  - `traffic.ts`: density from `currentSpeed/freeFlowSpeed`, with configurable thresholds.
  - `cost.ts` and `emissions.ts`: pure functions.
  - `assumptions.ts`: cited defaults. P4 moves them into the fact store.
- [ ] 1.4 `tomtom.ts`:
  - Type the incidents.
  - Add `getDriveRoute(dep, dest, arriveAt)`, using the Routing API with traffic and the **arrival-time**
    parameter, because the UI asks for the *desired arrival time*. It returns minutes, delay, and distance. A test
    asserts the exact upstream time parameter.
  - 5 s timeouts and `Promise.allSettled`.
  - Return partial results with `degraded` reasons.
- [ ] 1.5 Add `src/lib/llm/`:
  - A provider interface `generateJson(schema, prompt, opts)`.
  - Gemini on the current Google Gen AI SDK and OpenAI with schema-constrained output (per the research in 05).
  - Model IDs from env, and timeouts.
  - `narrate.ts` (a facts-only prompt) and `validate-claims.ts`, plus `contracts/claim-validation.vectors.json`.
  - A template fallback.
- [ ] 1.6 Rewrite `route.ts` as an orchestrator:
  1. Validate the request with zod (return 400 if invalid).
  2. Gather the TomTom flow, incidents, and route with allSettled. **v2 never calls `model_service`**: its current
     output is NYC-based or random (F-07). The ridership client is used only by the legacy engine until P6.
  3. Compute the deterministic fields.
  4. Narrate, then validate. If validation fails, use the template.
  5. Assemble the legacy fields plus `comparison` and `meta`.
  6. Log with structured logs.

  Keep `INSIGHTS_ENGINE=legacy` for one release.
- [ ] 1.7 UI: show an "Estimated" badge when `comparison.transit.estimated`, and format currency from numbers.
      Make the demo route output contract-valid (`meta.demo: true`).
- [ ] 1.8 Tests:
  - Route handler cases: happy path, TomTom down, LLM down, invalid body, and an unmatched number → template.
  - Domain tests.
  - Claim-validator tests against the vectors.
  - Contract test for the demo route.
- [ ] 1.9 Remove the streaming `callOpenAI` JSON path, the `TrafficData` `any` types, and the raw-AI-output logs.
      Update `CONTEXT.md`, `.env.example`, and `CHANGELOG.md`.
- [ ] **Verify:**
  - The web suite passes (lint, typecheck, test, build).
  - With no LLM key, `curl -sX POST :3000/api/transit-insights -H 'content-type: application/json' -d '{"departure":{"lat":32.7813,"lng":-79.9306},"destination":{"lat":32.7878,"lng":-79.9512},"timeToDestination":"08:30"}'`
    returns 200 with `meta.narration.provider == "template"`.
  - With no TomTom key, it returns 200 with `"traffic.unavailable"` in `meta.degraded`.
  - A request with a malformed body returns 400.

#### Phase 2 — `data_agent` scaffold, storage, polite fetcher *(parallel-safe with P1)*

*Adds the platform. Entry: P0 merged; D-2, D-5, D-9, D-11, D-18, D-19 answered.*

- [ ] 2.1 Create a `data_agent/` uv project for Python 3.12. Dependencies: FastAPI, Uvicorn, SQLAlchemy 2,
      Alembic, psycopg 3, Pydantic 2, pydantic-settings, httpx, tenacity, Typer, structlog, APScheduler, and PyYAML.
      Dev: pytest, respx, and Ruff.
- [ ] 2.2 Config:
  - `tda/config/settings.py`.
  - `regions/charleston.yaml`: timezone, bbox, agencies, and **draft** corridors with probe points for human
    confirmation.
  - `sources.yaml`, seeded from the catalog with `status: proposed`.
- [ ] 2.3 Add SQLAlchemy models and the Alembic baseline for `source`, `fetch_run`, `fact`, `metric_value`,
      `review_item`, and `agent_run`. Create the `tda_writer` and `tda_reader` roles.
- [ ] 2.4 Add the raw store (filesystem, sha256, path layout) and a retention job driven by `store_policy`.
- [ ] 2.5 Build the polite HTTP client:
  - A `robots.txt` gate for HTML and PDF sources, and a per-host token bucket.
  - Tenacity retries on 429/5xx that honor `Retry-After`.
  - ETag and Last-Modified caching.
  - A UA with a contact address, timeouts, and a maximum body size.
- [ ] 2.6 Add the connector base class (`fetch → land → normalize → validate → load`). It records `fetch_run` and
      is idempotent by checksum.
- [ ] 2.7 Add the FastAPI endpoints `/v1/health` (DB and freshness), `/v1/sources`, and `/v1/facts`, which returns
      approved facts only. Add `tda api openapi > contracts/data-agent.openapi.json`.
- [ ] 2.8 Add the CLI commands: `tda db upgrade`, `tda sources list|validate`, `tda ingest <id>`, and
      `tda review list|show|approve|reject`.
- [ ] 2.9 Add a root `docker-compose.yml` with `postgres:16`, `data-agent-api`, `data-agent-worker`,
      `model-service` (5001), and an optional `web` service. Harvest the compose pattern from
      `origin/feature/economic-incentive-improvements:deploy/docker-compose.yml`, but **don't merge** the branch.
- [ ] 2.10 Tests cover:
  - polite-client behavior (robots deny, 429 retry, 304)
  - raw store
  - review-state transitions
  - API

  Add a `data-agent` CI job (Ruff, pytest, `alembic upgrade head` against a Postgres service container).
- [ ] **Verify:**
  - `cd data_agent && uv sync && uv run ruff check . && uv run pytest -q`
  - `docker compose up -d postgres && uv run tda db upgrade && uv run tda sources validate`
  - Start the API (`uv run tda api serve --port 8081 &`), then `curl -s localhost:8081/v1/health | jq .status` → `"ok"`
  - The reader-role integration tests pass: API queries run as `tda_reader`, and writes are denied.
  - CI is green.

#### Phase 3 — Core connectors *(one PR per connector; order = priority)*

*Fixes F-06 and F-07 (data side). Entry: P2 merged; each source's `sources.yaml` entry has been **approved by a
human** after the terms review in 03; D-7 answered.*

- [ ] 3.1 `gtfs_static` (CARTA, S-1): conditional download, validation, and a load into `gtfs_*` under a new
      `feed_version` with atomic activation. Add `tda gtfs activate <version>` for rollback.
- [ ] 3.2 `ntd_monthly` (S-3): a SoQL query against Socrata `8bui-9xvu`, filtered by CARTA (NTD ID 40110) →
      `ridership_monthly`. Rule-based facts: latest month UPT by mode and year-over-year change.
- [ ] 3.3 `census_acs` (S-10): B08301, S0801, and B08303 for CBSA 16700 and the three counties → `acs_commute` and
      facts. Needs a free key.
- [ ] 3.4 `eia_gas` (S-11): series `EMM_EPMR_PTE_R1Z_DPG` weekly → fact. Needs a free key.
- [ ] 3.5 `reference_facts` (S-9, S-12…S-15): curated YAML (EPA, AAA, the FTA bus figure, the CARTA fare, downtown
      parking, and the TomTom Traffic Index headline) loaded as `candidate` facts. **A human checks each value
      against the primary document** and approves it in the review CLI.
- [ ] 3.6 `scdot_counts` (S-6a CSV and S-6b FeatureServer, with the owner/org verified) → `traffic_count`. Also
      `scdot_ccs_inbox` (S-6c): parse the human-exported hourly files from `data_agent/inbox/scdot-ccs/` →
      `traffic_count_hourly`. Add the `tda inbox process` command (03 §3).
- [ ] 3.7 `gtfs_rt_alerts` (S-2): parse Service Alerts with `gtfs-realtime-bindings` → `service_alert`, keeping only
      the active ones. These surface in nudges and reports.
- [ ] 3.8 `tomtom_sampler` (S-7): **don't build it by default.** Build it only if D-7 records a legal approval to
      store samples, or a Traffic Stats (S-7b) license exists. Then it needs its own key, a daily budget guard,
      and TTL retention.
- [ ] 3.9 Optional: `nhtsa_fars` (S-18, facts for the safety page; if blocked, use the inbox), `nws` (S-16),
      `noaa_tides` (S-17), and `documents` (S-5, S-19, S-20, the approved HTML/PDF sources used by the P5 Extractor).
- [ ] 3.10 The scheduler worker runs **approved** sources by cadence (`tda ingest --all-due`). Freshness is
      reported in `/v1/health`.
- [ ] **Verify:**
  - Each connector passes `uv run pytest tests/connectors/test_<name>.py`, with recorded fixtures and no network.
  - A human runs the live smoke test: `uv run tda ingest <id> --live` followed by the data-quality SQL in the
    prompt (for example, GTFS stops > 0 with no orphan `stop_times`; NTD months are contiguous).

#### Phase 4 — Metrics, facts, read API (4a), then app integration (4b)

*Fixes F-05 (fully), F-06, F-08. **4a** entry: P3 connectors 3.1, 3.2, and 3.5 merged, with 3.6 and 3.7
recommended. **4b** entry: P1 and P4a merged, and the 05 §2b demo-stop mapping signed.*

- [ ] 4.1 **(4a)** Metrics:
  - `service.py`: headways by route and time band.
  - `compare.py`: stop pairs via a direct-route scheduled lookup, expected wait = min(headway/2, cap), and the
    next N departures in the region timezone (D-6).
  - `congestion.py`: hourly **volume** profiles by station and corridor from `traffic_count_hourly`. Travel-time
    profiles only if licensed data exists (D-7).
  - `costs.py`, `emissions.py` (plus the S-14b CARTA-derived factor, if its dataset is confirmed), and `ridership.py`.
- [ ] 4.2 **(4a)** Fact-promotion rules with `valid_until`. Approved facts only are served.
- [ ] 4.3 **(4a)** API endpoints:
  - `/v1/stops` and `/v1/stops/nearest`
  - `/v1/compare?origin_stop_id&dest_stop_id&date&arrive_by|depart_at`
  - `/v1/assumptions`, `/v1/alerts`, `/v1/corridors`, `/v1/corridors/{id}/profile`
  - `/v1/stats` (headline stats plus citations)
  - `/v1/series/ridership/monthly` and `/v1/series/traffic/hourly` (P6 consumes them, so they're built here)

  Every API-exposed table has an explicit reader grant. Update the OpenAPI snapshot.
- [ ] 4.4 **(4b)** Web:
  - `src/lib/api/data-agent.ts`, with types generated from the OpenAPI by `openapi-typescript`.
  - `/api/transit-insights` uses `/v1/compare` (`estimated=false`, real `additionalRides`).
  - `/api/stats` (revalidates every hour), and `/api/stops`, which falls back to a **generated static stops file**
    when `DATA_AGENT_ENABLED=false` or the agent is down.
  - `DATA_AGENT_ENABLED` flag, so turning it off gives the P1 behavior.
- [ ] 4.5 **(4b)** UI:
  - GTFS stop pickers.
  - Citations footnote.
  - The dashboard reads `/api/stats`, falling back to demo constants when `NEXT_PUBLIC_DEMO_MODE=true`.
  - The emissions and safety pages render approved facts, which fixes the "2.680 grams" error. A page with no
    approved facts shows a **"data unavailable"** state, and no uncited number is ever shown.
  - Demo scenarios map to the GTFS stop IDs in 05 §2b.
- [ ] 4.6 **(4b)** Generate `src/app/data/stops.fallback.generated.ts` with `tda gtfs export-stops --format ts`,
      committed and refreshed on feed change. Remove `busStops.ts` and `busStopCoordinates.ts` only **after** the
      fallback is in place and a rollback test passes with `data-agent-api` stopped. Update `busStops.test.ts`.
- [ ] 4.7 Tests: metric tests on the fixture GTFS, API tests (including reader-role access), web route tests with a
      mocked data agent, a contract test (a CI diff check between the OpenAPI snapshot and the generated types), and
      the rollback test.
- [ ] **Verify:**
  - Both suites are green.
  - `curl ':8081/v1/compare?origin_stop_id=<A>&dest_stop_id=<B>&date=<YYYY-MM-DD>&arrive_by=08:30'` returns
    non-null `transit.minutes` for the fixture's direct-route pair.
  - With the agent stopped, `/` still loads stops from the fallback and returns a degraded result.
  - The UI checklist in the prompt passes.

#### Phase 5 — Agent runtime, guardrails, HITL, weekly report

*Delivers the agent. Entry: **P4a** merged (it can run in parallel with P4b and P6); D-3, D-4, D-8, D-12, D-14
answered; an LLM key with a provider-side budget cap.*

- [ ] 5.1 `tda/agent/runtime.py`: the D-3 framework, provider and model from settings, budgets and timeouts, and
      `agent_run` logging with cost.
- [ ] 5.2 The read tools and the queue-only write tools from architecture §7.2. No raw SQL, no arbitrary HTTP.
- [ ] 5.3 `guardrails.py`: the numeric-claim validator (the shared vectors), a citation check, schema validation,
      and the untrusted-content wrapper.
- [ ] 5.4 Tasks:
  - `weekly_report` (structured output → Markdown). The **competitive-pairs** section needs a drive-time source
    (D-7 b, c, or d). Without one, the section renders as "unavailable", with the reason stated, and the report
    uses transit service metrics, volume profiles, ridership, and alerts instead.
  - `extract` (documents → `candidate` facts, with no tools).
  - `scout` (disabled unless D-12).
  - Optionally `/v1/narrate` (only if D-15 changes).
- [ ] 5.5 Review UX: `tda review list|show|approve|reject`, and `tda publish report <id>` →
      `reports/<region>/<yyyy>-W<ww>.md`, which a human commits via PR.
- [ ] 5.6 Evals:
  - Deterministic tests use the framework's test model.
  - The live golden set is budget-capped and run manually. It checks for no unmatched numbers, cited sections,
    and injection-document cases.
- [ ] 5.7 Schedule the weekly report job. The draft goes to the queue and is **never auto-published**.
- [ ] **Verify:**
  - `uv run pytest tests/agent -q` passes with no network.
  - `uv run tda agent weekly-report --fixture --dry-run` produces a cited Markdown draft.
  - `uv run tda review list --kind report` shows it.
  - A human runs one live eval and records the cost.

#### Phase 6 — Forecasting on real data *(after P4b; parallel-safe with P5)*

*Fixes F-07 and F-15. Entry: P4b merged (which provides the `/v1/series/*` endpoints and the stable v2 engine);
D-10 and D-22 answered.*

- [ ] 6.1 Image: `python:3.12-slim`, a non-root user, `.dockerignore`, pinned deps, and gunicorn on :5001.
- [ ] 6.2 Load the series from the data agent's `/v1/series/*` (NTD monthly UPT; hourly volumes), replacing the
      MTA CSVs. `model_service` gets **no DB credentials**.
- [ ] 6.3 Model per D-22: a deterministic seasonal baseline (statsmodels ETS or seasonal-naive) with a backtest.
      Chronos stays optional behind `MODEL_BACKEND` (see the research in 05).
- [ ] 6.4 API v2: `/v2/forecast/ridership/monthly` and `/v2/forecast/volume`, returning a value plus an interval,
      the model version, and the training window. `/predict/*` gets a deprecation header for one release. Update
      `src/lib/api/ridership.ts` in the same PR.
- [ ] 6.5 Mock output only when `MODEL_MODE=demo`, seeded. Remove the MTA CSVs and `predict_chronos`.
- [ ] **Verify:**
  - `docker compose up -d --build postgres data-agent-api model-service`, then `tda dev seed ntd_monthly`
    (dev-only fixture load)
  - `curl :5001/health` and `curl ':5001/v2/forecast/ridership/monthly?mode=MB&months=6'`
  - pytest (the backtest model selection on the fixture)
  - the web ridership-client tests

#### Phase 7 — Productionize, measure impact, clean up

*Fixes F-13 (rest), F-18, F-20, and the flow duplication. Entry: P4b, P5, and P6 merged (or D-10 = retire, with
`model_service` removed); D-23 answered.*

- [ ] 7.1 Rate limiting and body-size limits on the LLM-backed routes.
- [ ] 7.2 Real auth (Auth.js) and, if chosen in D-8, an `/admin/review` UI over authenticated data-agent admin
      endpoints.
- [ ] 7.3 Impact measurement:
  - Anonymous aggregate events (`nudge_shown`, `cta_carta_fares_click`) and a privacy review.
  - Funnel metrics in the weekly report.
  - An incentive A/B framework, with each experiment approved by a human.
- [ ] 7.4 Hosted schedule per D-9, freshness alerts, and Postgres backups.
- [ ] 7.5 Keep dependencies current: Dependabot or Renovate for npm, uv, and Docker, with monthly batches. Add a
      calendar check for the model deprecation pages (see 05 §Research).
- [ ] 7.6 Merge the `/find-rides` → `/routes` flow into `/`.
- [ ] 7.7 Docs refresh (README "COMPLETE" claims, `CONTEXT.md`, `SETUP.md`, `DEMO_CHECKLIST.md`), archive
      `changes.md`, and a **v0.3.0** entry in `CHANGELOG.md`.
- [ ] 7.8 A Playwright e2e smoke test in CI.
- [ ] **Verify:**
  - CI is green, including e2e.
  - A light load test meets the p95 budgets in architecture §10.
  - The security checklist in 05 is signed off.

### Final validation (run from the repo root after any phase ≥ P2)

```bash
(cd src && npm ci && npm run lint && npm run typecheck && npm test && npm run build) && \
(cd data_agent && uv sync --frozen && uv run ruff check . && uv run pytest -q) && \
(cd model_service && uv run pytest -q) && \
docker compose up -d postgres && (cd data_agent && uv run tda db upgrade && uv run tda sources validate)
```

Skip the `model_service` line until P6 has added its test suite.

### Rollback Plan

If something fails:
1. **Any phase:** each phase is one squash-merged PR, so revert it with `git revert <merge-sha>`. The phases are
   additive by design (new files, optional fields, feature flags).
2. **P0 env rename:** the old `NEXT_PUBLIC_TOMTOM_API_KEY` is still read as a fallback, with a warning. The
   Next patch upgrade can be reverted with `package-lock.json`.
3. **P0B framework upgrade:** revert the single PR, which returns to Next 14.2.35 (the P0 state). Ship nothing
   else in that PR, so the revert stays clean.
4. **P1 route rewrite (the riskiest web change):** set `INSIGHTS_ENGINE=legacy` to restore the v0.2.1 prompt path
   without redeploying code. It's removed in P7.
5. **P3 connectors:** set `status: disabled` in `sources.yaml`. `tda gtfs activate <previous_version>` restores
   the prior feed. For a bad load, run `tda ingest rollback <run-id> --dry-run`, then `--confirm`. This is a tested,
   transactional command. It lists the dependent rows, **refuses** if the run's lineage feeds approved or
   published facts unless a human passes the approving review ID, and keeps the raw evidence. **Never** run ad hoc
   `DELETE`s.
6. **P4 integration:** `DATA_AGENT_ENABLED=false` returns to the P1 behavior, and `NEXT_PUBLIC_DEMO_MODE=true`
   restores the demo dashboard.
7. **P5 agent:** `AGENT_ENABLED=false`. Nothing auto-publishes, so the only cleanup is rejecting the pending
   review items.
8. **P6 forecasting:** the v1 endpoints stay for one release, and the previous image tag is kept.
9. **Database:** migrations are forward-only, with a tested `downgrade` per revision. Take a `pg_dump` before any
   P3–P5 migration in a shared environment.

### Risks

| ID | Risk | Likelihood / impact | Mitigation |
|----|------|---------------------|------------|
| R-1 | TomTom terms forbid storing the sampled data, so there's no historical congestion dataset | Med / High | D-7 alternatives: live-only plus SCDOT counts plus licensed historical data. `store_policy` enforced in code. |
| R-2 | No public CARTA GTFS-RT, so no real-time reliability metrics | Med / Med | Schedule-based metrics first; request feed access from CARTA (partnership) |
| R-3 | LLM numbers slip past the validator | Low / High | Shared vectors, template fallback, `meta.narration.validated`, tests on every PR |
| R-4 | Prompt injection through scraped documents | Med / High | Extractor has no tools; outputs are only ever `candidate`; approval is human-only; injection eval cases |
| R-5 | Competing architectures (the unmerged branches) | Med / Med | D-11: harvest, don't merge. These docs are the single plan of record. |
| R-6 | LLM or TomTom cost overrun | Med / Med | Budgets enforced in code (D-14), separate keys, caching, daily caps |
| R-7 | Licensing or attribution violations | Low / High | Per-source terms review is a HITL gate; `attribution_text` is rendered; `robots.txt` is enforced |
| R-8 | UI breaks during the contract migration | Low / Med | Additive fields; zod-validated demo; the `INSIGHTS_ENGINE` and `DATA_AGENT_ENABLED` flags |
| R-9 | Timezone or DST errors | Med / Med | Region-timezone utilities with tests on the March/November DST dates |
| R-10 | Operating new services becomes a burden | Med / Med | Single-host compose first; health and freshness endpoints; few moving parts |
| R-11 | A history rewrite for the leaked key disrupts collaborators | Low / Med | Prefer revocation plus redaction (D-13); coordinate any force-push |
| R-12 | The framework upgrade (14 → 16) breaks the UI or tests | Med / Med | Isolated, behavior-neutral P0B PR; official codemod; full smoke checklist; revert to 14.2.35 is clean |
| R-13 | Misleading or manipulative nudges | Low / High | Tone policy, fixed incentive bounds, human review of templates and reports, no demographic targeting |
| R-14 | The maintainer's uncommitted doc edits conflict with P0 | High / Low | P0 precondition: a clean tree, with the pending edits committed first |
| R-15 | More model or SDK shutdowns (`gpt-3.5-turbo` on 2026-10-23; `gemini-1.5-flash` already gone) | High / High | P0.11 stopgap; model IDs only from env; a provider interface (P1); the deprecation-page calendar check (P7.5) |
| R-16 | Stale research facts (quotas, terms, model IDs change) | Med / Med | Every connector and prompt re-verifies its source at execution time; the catalog records verification dates |
