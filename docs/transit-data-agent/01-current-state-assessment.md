# 01 — Current-State Assessment

> **Scope:** the whole repo at `test/opus5.5-gpt6-refactor` (`9b129d6`, which is `main` + the v0.2.1 refactor commit).
> **Method:** full read of the tracked source, baseline commands, and a runtime smoke test in a browser.
> **Date:** 2026-09-24. Items marked *(research)* are confirmed in [03-data-source-catalog.md](./03-data-source-catalog.md)
> and [05-decisions-and-review.md](./05-decisions-and-review.md).

---

## 1. Verdict

**Yes, a refactor is necessary. It should be targeted and staged, not a rewrite.**

The UI shell, component library, and `lib/api/*` client pattern are sound, so keep them. The agent goal ("real
data → trustworthy stats → more transit use") is blocked by four structural problems:

1. **The numbers aren't real.** The LLM invents travel time, traffic density, savings, and alternative departures
   (F-05). The stops are synthetic (F-06), the ridership model runs on NYC data (F-07), and the stats pages have
   no sources (F-08). Nothing is citable.
2. **The baseline doesn't ship.** `next build` fails (F-01), two of the three user flows are broken (F-02, F-03),
   and there's no CI (F-16). The default AI path fails today because `gemini-1.5-flash` was shut down, and the
   OpenAI fallback model shuts down 2026-10-23 (F-11). The framework is EOL, with unpatchable high-severity
   CVEs (F-22).
3. **There's no place for an agent to live.** There's no data store, no ingestion or scheduling, no provenance
   model, and no review queue. The only backend is a stateless forecasting stub.
4. **Security hygiene gaps** would become real exposure once the app ingests data and gets deployed (F-12, F-13, F-14).

The staged plan in [04-implementation-plan.md](./04-implementation-plan.md) fixes the baseline first (Phase 0),
then moves to a supported framework (Phase 0B). After that it adds seams (contracts, LLM abstraction,
deterministic math) and a separate Python data-agent service. The Next.js app keeps working at every step.

> ⏰ **Time-sensitive:** OpenAI shuts down `gpt-3.5-turbo` on **2026-10-23**. Next 15 support ends on
> **2026-10-21**. The model-ID stopgap in Phase 0 should land before those dates.

## 2. Baseline health (measured 2026-09-24)

| Check | Command (from `src/` unless noted) | Result |
|-------|-------------------------------------|--------|
| Unit tests | `npx jest` | ✅ 4 suites, 28 tests passed (2.2 s) |
| Lint | `npx next lint` | ✅ no warnings or errors |
| Type-check | `npx tsc --noEmit` (with the generated `next-env.d.ts`) | ❌ 6 errors in 2 files |
| Production build | `npx next build` | ❌ **fails** at "checking validity of types" (`app/test/page.tsx:14`) |
| Runtime smoke | `npx next dev`, then click **Rush Hour Commute** | ❌ "Oops! Something went wrong" (both selects fall back to their placeholders) |
| Python tests | none | ⚠️ no test suite exists |
| CI | none | ⚠️ no `.github/workflows/` |
| Toolchain seen | Node v25.2.1, npm 11.6.2, Python 3.9.6 (system) | ⚠️ Python 3.9 has been EOL since 2025-10-31. Use Node 22 LTS in CI. |
| Framework support | `next@14.2.4` | ❌ Next 14 has been EOL since 2025-10-26; see F-22 |

## 3. System inventory

| Layer | Components | Notes |
|-------|------------|-------|
| UI pages | `/` (trip insights plus demo scenarios), `/find-rides` → `/routes` (the "rewards" flow, behind demo auth), `/dashboard` (investor metrics), `/emissions-stats`, `/safety-cost-comparison`, `/incentives`, `/register`, `/test` | Two parallel trip flows with different clients (`fetch` vs `axios`) and different state (local vs `TravelContext`) |
| API routes | `POST /api/transit-insights` (TomTom → ML → LLM), `POST /api/transit-insights-demo` (deterministic mock, 3 s delay) | The only live API is the first one |
| Shared libs | `src/lib/api/{gemini,openai,tomtom,ridership}.ts`, `src/lib/convertToUTC.ts` | Lazy singletons; typed in parts |
| Data | `src/app/data/busStops.ts` and `busStopCoordinates.ts` (66 stops, kept in sync by hand) | Synthetic, not GTFS |
| ML service | `model_service/app.py` (Flask on :5001), `bus_{hourly,daily}_chronos_t5_tiny.py`, `data/MTA_*.csv` | NYC MTA data; mock fallback uses random numbers |
| Tests | `src/__tests__/{lib,data}/**` | Utilities only |
| Ops | `start-app.sh`, `stop-app.sh`, `test-setup.sh`, `model_service/Dockerfile` | No compose file, no CI |
| Unmerged | `origin/feature/economic-incentive-improvements` (77 files, +21k lines, Prisma/Postgres rewards engine, a nested `src/src/`), `origin/demo-improvements-20250813` (107 files) | See F-19 |

## 4. Findings

Severity: **Critical** blocks shipping or is a security exposure. **High** produces misleading output, breaks
a flow, or blocks the agent goal. **Medium** is a reliability or maintainability risk. **Low** is hygiene.

| ID | Sev | Finding | Evidence | Impact on agent goal | Fix → Phase |
|----|-----|---------|----------|----------------------|-------------|
| F-01 | Critical | Production build fails on type errors. Next type-checks the tests too, because `tsconfig.json` includes `**/*.ts`. | `next build` → `app/test/page.tsx:14`; `tsc` also flags `app/test/page.tsx:22` and `__tests__/lib/convertToUTC.test.ts:51,69` | Nothing is deployable. There's no gate on regressions. | Type the state; mock time with `jest.useFakeTimers().setSystemTime()`; add CI → **P0** |
| F-02 | High | The "Find Rewards" flow posts to the **deleted** `/api/getTravelTime`. The error is swallowed, the user is redirected anyway, and `/routes` bounces to `/dashboard`. | `app/find-rides/page.tsx:76,97-98,103`; `app/routes/page.tsx:21-22` | One of the two trip flows is dead | Repoint to `/api/transit-insights` → **P0**; merge the flows → **P7** |
| F-03 | High | Demo scenarios pre-fill stop names that don't exist, and coordinate validation runs **before** the demo branch. **Verified in a browser.** | `app/page.tsx:138-150` vs `app/data/busStopCoordinates.ts`; validation at `app/page.tsx:67-71` | The investor demo in `DEMO_CHECKLIST.md` fails | Use valid stop keys and skip coordinate checks in demo mode → **P0** |
| F-04 | Medium | The `/test` page calls deleted endpoints, is linked from home, and is advertised in the scripts and docs | `app/test/page.tsx:35-37`; `app/page.tsx:194`; `start-app.sh:156`; `SETUP.md:27,76`; `DEMO_CHECKLIST.md:21` | Misleading diagnostics | Replace with `GET /api/health` (no secrets) or delete → **P0** |
| F-05 | High | **The LLM generates every user-facing number** (`travelTime`, `trafficDensity`, `costSavingsPerTrip`, `additionalRides`). A silent hard-coded fallback looks identical to a real answer. | Prompt at `app/api/transit-insights/route.ts:73-93`; fallback at `:104-121` | Stats are uncitable and possibly wrong, which is the opposite of the goal | Compute numbers deterministically, let the LLM only narrate, add `meta` provenance → **P1**, **P4** |
| F-06 | High | There's no real transit data. Stops are hand-made intersections with synthetic-looking coordinates (Hanahan, Ladson, and Moncks Corner step by exactly 0.0111° of longitude). There are no routes or schedules, and departures are invented. | `app/data/busStopCoordinates.ts:84-96`; two files synced by hand | Can't compute transit time, frequency, or next departures | Ingest CARTA GTFS and generate the stop list from it → **P3**, **P4** |
| F-07 | High | The ridership "forecast" isn't about Charleston and isn't a time series. The hourly model loads 1,000 raw NYC rows mixing every route and fare class. The daily model grabs the first column containing "total", which is NYC **subway** ridership. The mock uses unseeded random numbers. Dead code calls an undefined `floor`. | `model_service/bus_hourly_chronos_t5_tiny.py:34,54-70,137`; `bus_daily_chronos_t5_tiny.py:34,63-64`; the prompt presents it as "predicted bus passenger count" at `route.ts:58-60` | A fabricated signal gets fed to users | Retarget to CARTA data (NTD monthly plus collected series), make it deterministic, add tests → **P6** |
| F-08 | High | Static stats have no sources and contradict each other. Dashboard "real-time metrics" are constants. The emissions page says bus CO2 is "2.680 grams"/mile yet derives 89.33 g per passenger-mile, which implies about 2,680 g/mile. Safety claims and incentive tiers have no source. | `app/dashboard/page.tsx:9-27`; `app/emissions-stats/page.tsx:38-39`; `app/safety-cost-comparison/page.tsx:29,33`; `app/routes/page.tsx:26-40` | These are exactly the stats the agent should own | Serve cited facts from the fact store; keep demo metrics behind a flag → **P4** |
| F-09 | Medium | Time bugs: "HH:MM" is read in the **server's** timezone, which is UTC on typical hosts, so Charleston users are off by 4–5 hours. The horizon floors to whole hours, so trips under an hour away skip prediction. | `app/api/transit-insights/route.ts:22-47`; `lib/convertToUTC.ts`; `lib/api/ridership.ts:21` | Wrong time-of-day context for traffic and ridership | Region-timezone time utilities (`America/New_York`) → **P1** |
| F-10 | Medium | No degradation when TomTom fails. `Promise.all` rejects on any single failure, a missing key throws, and the route turns that into a 500 that exposes the internal error message. | `lib/api/tomtom.ts:29-31,63-65,95`; `route.ts:160,212` | Contradicts the "always provide fallback responses" rule in `CONTEXT.md` | `Promise.allSettled`, timeouts, typed partial results → **P1** |
| F-11 | **High** | **The default AI path is broken, and the fallback is about to be.** `gemini-1.5-flash` was shut down in Sept 2025, so with the default `USE_GEMINI=true` the call throws, which lands in the route's 500 path. `gpt-3.5-turbo` **shuts down 2026-10-23**. `@google/generative-ai` has been legacy/EOL since 2025-11-30. JSON is parsed by regex, not structured output. | `lib/api/gemini.ts:32`; `lib/api/openai.ts:27,47`; the AI call at `route.ts:187-193` sits outside the parse-fallback `try` (`:198-206`), so errors land in the 500 `catch` (`:207-215`); research in [05 §Research](./05-decisions-and-review.md#3-research-findings-verified-2026-09-24) | The live insight path fails today | **P0** stopgap: model IDs from env, with current defaults. **P1**: `@google/genai`, the OpenAI Responses API with structured outputs, and a provider interface. |
| F-12 | Critical | **Secret material in docs and history.** A Gemini key string (described as revoked) is committed in `REFACTORING_PLAN.md` (Phase 1.1 sample) and in remote branch `origin/demo-improvements-20250813` (commit `57379e1`). | `grep -l 'AIza' REFACTORING_PLAN.md`; `git show --stat 57379e1` | Secret scanners flag the repo. It's only safe if revocation is confirmed. | A human confirms revocation; redact; decide on a history rewrite (D-13) → **P0** |
| F-13 | Medium | Security hygiene. Flask runs `debug=True` on `0.0.0.0`, and the Werkzeug debugger allows code execution if reachable. Error payloads leak internals. A server secret uses the `NEXT_PUBLIC_*` prefix. No rate limit protects the LLM-backed endpoint. Demo auth stores bcrypt hashes in `localStorage`. (For framework CVEs, see F-22.) | `model_service/app.py:83,54,77`; `route.ts:212`; `lib/api/tomtom.ts:8`; `app/register/page.tsx:45-55` | Becomes real exposure once deployed with ingestion | P0: debug off, rename the env var. P7: rate limit, real auth. |
| F-14 | Medium | **Hidden coupling in `.gitignore`.** The root file ignores `*.json`, `*.csv`, `*.parquet`, and `public`. Any **new** config, fixture, schema, or data snapshot would be silently untracked; existing ones are tracked only because they predate the rules. Ten ignored-pattern files are tracked anyway (`model_service/.env`, `__pycache__/*.pyc`, `.DS_Store`). | `.gitignore:42-44,100`; `git ls-files \| grep -cE '__pycache__\|\.DS_Store\|model_service/\.env$'` → 10 | New agent configs, fixtures, and GTFS samples would vanish from commits | Scope the ignores; untrack the artifacts → **P0** |
| F-15 | Medium | Container drift. The image is `python:3.9-slim`, and Python 3.9 has been **EOL since 2025-10-31**. Current `chronos-forecasting` (2.x) needs Python ≥ 3.10, and numpy needs ≥ 3.12. The Dockerfile says `EXPOSE 5000` / `--port=5000`, while the app and clients use **5001**. There's no `.dockerignore`, and the CPU torch wheels bloat the image. | `model_service/Dockerfile:1,6-7`; `lib/api/ridership.ts:8`; `app.py:83` | The container can't talk to the app as configured, and it can't install current dependencies | P0: fix the port and add `.dockerignore`. P6: Python 3.12 image and a lighter model. |
| F-16 | Medium | No CI and thin tests: no workflows, and 28 unit tests covering utilities only. No route, UI, Python, or contract tests. | No `.github/`; `src/__tests__/**` | Regressions like F-01 and F-02 land unnoticed | CI in **P0**; tests in every phase |
| F-17 | Low | Contracts are duplicated and loose. `TrafficData` uses `any`. `AdditionalRide` and `TravelContextProps` are defined twice with different shapes. The request body is only presence-checked. | `types/interfaces.ts:21-22,36,58` vs `contexts/travel-context.tsx:5,10`; `route.ts:148-157` | Hard to add a data-service boundary safely | Zod contracts as the single source of truth → **P1** |
| F-18 | Low | Observability: raw AI output and key-presence flags go to `console.log`. No request IDs, timings, or cost tracking. | `route.ts:184-195` | Can't measure cost or freshness, or debug the agent | Structured logger → **P1** (web), **P2** (agent) |
| F-19 | Medium | Divergent unmerged branches carry a Prisma/Postgres rewards engine, docker-compose, and a nested duplicate `src/src/` tree | `git diff --stat HEAD...origin/feature/economic-incentive-improvements` | Risk of two competing architectures | Decision D-11: harvest the compose/Postgres pattern, don't merge → **P2** |
| F-20 | Low | Docs drift. README says "COMPLETE", "Real-time Data", and "Global Loading", which contradicts `CONTEXT.md` (lazy loading). `changes.md` documents deleted endpoints. | `README.md:1,11-37,201,299`; `changes.md` | Onboarding confusion for humans and agents | Each phase updates the docs it touches; full refresh → **P7** |
| F-21 | Low | Currency formatting is inconsistent. The demo returns `"$4.25"`, the live prompt asks for `"2.50"`, and the UI prepends `$`, so demo results render as `$$4.25`. | `app/api/transit-insights-demo/route.ts:22,45,68`; `app/page.tsx:493` | Sloppy numbers undermine trust in the stats | Numeric `costSavingsUsd` in the contract; format only in the UI → **P0** (demo), **P1** (contract) |
| F-22 | **High** | **The framework is end-of-life.** Next.js 14 reached EOL on 2025-10-26. Version 14.2.4 is missing the fixes for 13 advisories, including critical CVE-2025-29927 (middleware bypass; not exploitable here because there's no middleware), plus high-severity cache-poisoning, authorization-bypass, and Server Components DoS bugs. Three 2026 high-severity Server Components DoS CVEs (CVE-2026-23864, -23869, -23870) have **no 14.x fix at all**. Next 15 support ends 2026-10-21, so 16.x is the only durable target. | `src/package.json` (`"next": "14.2.4"`); research in [05](./05-decisions-and-review.md#3-research-findings-verified-2026-09-24) | App Router pages are exposed to known DoS bugs. It can't be deployed responsibly. | **P0**: patch to 14.2.35 as a stopgap. **P0B**: upgrade to Next 16.x + React 19. |

## 5. What's worth keeping

- The **Next.js App Router + Shadcn/UI** shell, and the strict TypeScript setup with Jest.
- The **`src/lib/api/*` client pattern** (lazy singletons, one module per provider). It extends naturally to a
  `data-agent` client and an `llm/` provider interface.
- **Deterministic demo mode** (`/api/transit-insights-demo`), which matters for investor demos. Keep it isolated behind a flag.
- The **graceful-degradation philosophy**. It just needs to be applied consistently (F-10).
- **Multi-provider LLM support**. Formalize it as an interface.

## 6. Refactor scope: keep / change / add / remove

| Action | Item | Phase |
|--------|------|-------|
| **Keep** | UI shell, Shadcn components, demo endpoint, `lib/api` pattern, Jest setup | — |
| **Change** | Next 14.2.4 → 14.2.35 (stopgap), then **Next 16.x + React 19**, with Node 22 LTS in CI | P0, P0B |
| **Change** | Hard-coded model IDs become env-configured, with current defaults (stopgap for the shutdowns) | P0 |
| **Change** | `transit-insights` route becomes a thin orchestrator. Numbers are deterministic; the LLM only narrates. The response grows additively (`meta`, `comparison`). | P1, P4 |
| **Change** | LLM clients move to current SDKs, env-configured models, and structured output | P1 |
| **Change** | TomTom client: server-only key, typed, timeouts, partial results | P1 |
| **Change** | Time handling uses the region's timezone | P1 |
| **Change** | Stops come from GTFS. Stats pages and the dashboard read cited facts, with demo metrics behind a flag. | P4 |
| **Change** | `model_service` moves to CARTA data, deterministic output, Python ≥ 3.12, and consistent ports | P0 (port), P6 |
| **Change** | Scope `.gitignore`; untrack artifacts | P0 |
| **Add** | **`data_agent/` Python service**: source registry, polite fetcher, connectors, Postgres store with provenance, metrics and facts, read API, CLI | P2–P4 |
| **Add** | **LLM agent runtime** (analyst, narrator, extractor, scout) with read-only tools, guardrails, evals, and a HITL review queue | P5 |
| **Add** | CI, a docker-compose stack, scheduled ingestion, structured logging, rate limiting | P0, P2, P7 |
| **Remove** | `/test` page (or repoint it), `busStops.ts` duplication, NYC MTA CSVs, dead `predict_chronos`, streaming `callOpenAI` for JSON, tracked `.env`, `__pycache__`, and `.DS_Store` | P0, P1, P4, P6 |

## 7. Gap analysis: what the agent needs that doesn't exist

| Capability | Today | Needed |
|------------|-------|--------|
| Data acquisition | Live TomTom calls per request | Scheduled, polite, license-aware connectors with raw snapshots |
| Storage and provenance | None | Postgres with `source`, `fetch_run`, normalized domain tables, `fact`, `metric_value`, `review_item`, and `agent_run` |
| Transit model | Synthetic stops | GTFS (stops, routes, trips, stop_times, calendars), plus GTFS-RT if available |
| Traffic patterns | One snapshot per request | Corridor time-of-day profiles (sampled or licensed) plus counts (SCDOT AADT) |
| Stats | Hard-coded | Computed metrics and curated reference facts, all cited |
| Agent | One prompt → JSON | Tool-using analyst with narrow write paths into a review queue |
| Human review | None | Review states for sources, facts, reports, and campaigns, via CLI and PR export (admin UI later) |
| Quality gates | 28 unit tests | CI; connector fixtures; contract tests between the web app and the data API; LLM evals (citation and injection) |
| Ops | Shell scripts | docker-compose, scheduled jobs, freshness alerts, cost tracking |
