# Changelog

All notable changes to the Tryp Transit project are documented here.

## [0.3.0-alpha.1] - 2026-09-27 — Web seams and deterministic trip math (Phase 1)

P1 shipped as three PRs: #12 (contracts and env), #13 (domain math and the claim validator), and the route PR
(TomTom, the LLM seam, the route, and the UI). **Trip numbers are now computed, never invented.**

- **One engine** (`src/lib/insights/v2.ts`). The old LLM prompt that produced travel times, savings, and rewards
  is deleted, with no switch back (D-27); rollback is reverting the PR.
- **Deterministic math** from TomTom (an `arriveAt` route, current flow, and incidents, each with a 5 s timeout,
  returning partial data on failure) and the approved 05 §2 assumptions: a signed marginal trip cost that is
  never clamped, and a "Traffic now" density.
- **Honest gaps.**
  - Transit timing is `unavailable` until GTFS (D-21), so `travelTime` is null and `additionalRides` is empty.
  - CO2 is omitted because there is no bus distance yet.
  - Parking is omitted because its applicability isn't approved.
  - Each gap is a snake_case code in `meta.degraded`.
- **Narration by reference.** The LLM (Gemini via `@google/genai`, OpenAI via the Responses API, both with strict
  JSON) references facts by slot and never emits a digit. A validator rejects everything else, and the
  deterministic template takes over (fail closed).
- **Rewards and demo.** `incentiveDetails` appears only with an active offer (D-25). The demo scenarios appear
  only with `NEXT_PUBLIC_DEMO_MODE=true`, and they are badged in the UI.
- **Contract.** A zod contract in `src/lib/contracts/transit-insights.ts`. The legacy fields keep their types;
  `comparison` and `meta` are additive.
- **Env.** `src/lib/env.ts` is server-only and validated.
  - New: `LLM_PROVIDER`, `LLM_TIMEOUT_MS`, `REGION_TIMEZONE`, `DATA_AGENT_BASE_URL` and
    `NEXT_PUBLIC_DEMO_MODE`.
  - Removed: `RIDERSHIP_API_BASE_URL`. The web app calls no prediction service (F-07), so `/api/health`
    no longer probes one.
- **Dependencies.** `@google/genai` ^2.23 replaces `@google/generative-ai`; `openai` goes from ^4.52 to ^7.20;
  `server-only` is added. **Node ≥ 22 is now required** (openai 7 needs it, and Node 20 is end-of-life).
- **UI.** "Transit timing unavailable", a signed "save $x" / "costs $x more", "Traffic now", and "Live traffic
  unavailable". The routes page no longer derives a bus-stop time from an invented bus time.
- **Verification caveat.** The maintainer has no API keys, so provider behavior was verified only against a
  local simulator whose replies the builder authored (05 §7). Real-provider behavior is still unverified.

## [0.2.3] - 2026-09-25 — Framework upgrade (Phase 0B)

- **Next.js 14.2.35 → 16.3.5 and React 18 → 19.3.0** (`@types/react` 19), via `@next/codemod@16.3.5 upgrade`.
  Turbopack is now the default bundler for dev and build. No request-API, middleware, or `next.config.mjs`
  changes were needed. **16.3.5, not the public-npm latest 16.3.6:** the package proxy this was built behind
  holds back recent releases (apparently about 7 days), so 16.3.6 (2026-09-22) wasn't installable through it.
  16.3.6 fixes an RCE in `next/og` `ImageResponse` (GHSA-vcvr-r3jv-pc5j), and this app doesn't use `next/og`.
  Bumping is a follow-up.
- **Lint:** `next lint` was removed in Next 16, so lint now runs through the ESLint 9 CLI (`eslint .`) with a
  flat config (`src/eslint.config.mjs`) based on `eslint-config-next` 16 core-web-vitals. The new
  `react-hooks/set-state-in-effect` rule is a warning for three existing effects (a follow-up).
- **Dependencies:** `lucide-react` 0.396 → 1.47 (same `Check`/`ChevronDown`/`ChevronUp` icons),
  `@hookform/resolvers` 3.10 → 5.9, and ESLint 8 → 9 (ESLint 10 isn't supported by the bundled React/import/a11y
  plugins yet). Peer floors: zod ^3.25, react-hook-form ^7.55. `engines.node` is `>=20.9`.
- **tsconfig:** Next 16 set `jsx: react-jsx` (mandatory), `target: ES2017`, and added `.next/dev/types` to
  `include`.
- **Lockfile:** every `resolved` URL now points at `registry.npmjs.org`. Installs through a corporate proxy had
  recorded internal feed URLs.
- **Docs:** Node ≥ 20.9 and the lint command are documented in README (frontend setup and testing), SETUP
  (prerequisites and testing), and CONTEXT (frontend architecture and testing).

## [0.2.2] - 2026-09-25 — Stabilization (Phase 0)

- **T1 Health endpoint** — new `GET /api/health` reports ridership-service reachability and whether the LLM and
  traffic integrations are configured, as booleans only. `/test` now shows it instead of calling deleted endpoints.
- **T2 Type-check** — `npm run typecheck` (`tsc --noEmit`) passes and `next build` succeeds; image module types
  added, `/test` state typed, `convertToUTC` tests use fake timers.
- **T3 Find Rewards flow** — posts to `/api/transit-insights`, shows errors inline, and navigates to `/routes` only
  on success.
- **T4 Demo scenarios & loading** — demo buttons use real stop keys near CARTA service (weekend goes to Isle of
  Palms, not Folly Beach) and skip coordinate validation; a request-state reducer makes the loader clear on every
  terminal state; demo savings no longer render as `$$`.
- **T4b Zero savings** — `/routes` renders a legitimate `0` saving instead of redirecting.
- **T4c TomTom bbox** — incident bounding box is longitude-first (`minLon,minLat,maxLon,maxLat`).
- **T5 Hygiene** — targeted data `.gitignore` rules replace the global `*.csv`/`*.json`/`*.parquet`/`public`
  rules; `.DS_Store`, `__pycache__`, and `model_service/.env` untracked; `model_service/.dockerignore` added;
  the Dockerfile runs gunicorn on port 5001.
- **T6 Secret scanning** — the revoked Gemini key is redacted from `REFACTORING_PLAN.md` (at G0); CI scans each
  PR diff with gitleaks, with a history-only allowlist in `.gitleaks.toml` (D-13).
- **T7 Security quick wins** — model service reads `FLASK_DEBUG` (default false), `API_HOST` (default
  `127.0.0.1`), and `API_PORT` (default 5001); API errors return generic messages; the TomTom key is now the
  server-only `TOMTOM_API_KEY` (legacy `NEXT_PUBLIC_TOMTOM_API_KEY` still read, with a warning); Next.js 14.2.4 →
  14.2.35.
- **T8 LLM models** — model IDs come from `GEMINI_MODEL` (default `gemini-3.8-flash`) and `OPENAI_MODEL` (default
  `gpt-5.6-terra`), replacing `gemini-1.5-flash` (shut down) and `gpt-3.5-turbo` (shuts down 2026-10-23).
- **T9 CI** — GitHub Actions runs web (lint, typecheck, test, build on Node 22), python (compile on 3.11), and
  secrets jobs on every PR and push to `main`.
- **T10 Docs** — setup docs point at the health-based `/test` page and document the new env vars and the
  `typecheck` script; the 0.2.1 stop count is corrected to 62.

## [0.2.1] - 2025-12-05

### 🔴 Security Fixes
- **Removed hardcoded API key** from `simple-gemini-test/route.ts` (key was revoked)

### ✅ Code Quality Improvements

#### API Consolidation
- **Created shared API utilities** in `src/lib/api/`:
  - `gemini.ts` — Gemini AI client with JSON parsing and markdown extraction
  - `openai.ts` — OpenAI client with streaming support
  - `tomtom.ts` — TomTom traffic API client with typed responses
  - `ridership.ts` — Python ML service client with error handling
  - `index.ts` — Barrel export for clean imports
- **Refactored `/api/transit-insights`** to use shared utilities (reduced from 280 → 180 lines)
- **Preserved multi-provider support** — toggle between Gemini/OpenAI via `USE_GEMINI` env var

#### Deleted Redundant Endpoints
- `/api/getTravelTime` — duplicate of transit-insights
- `/api/simple-gemini-test` — test endpoint with security issue
- `/api/test-gemini` — redundant test
- `/api/test` — debug endpoint
- `/api/test-env` — exposed env vars
- `/api/test-tomtom` — debug endpoint
- `/api/transit-insights-simple` — merged into transit-insights-demo

#### Python Service Improvements
- **Fixed module-level loading** — models now lazy load on first `predict()` call
- **Pinned dependencies** in `requirements.txt`:
  - Flask==3.0.0
  - pandas==2.1.4
  - torch==2.1.2
  - numpy==1.26.2
  - python-dotenv==1.0.0
  - gunicorn==21.2.0
- **Deleted unused files**:
  - `bus_commuters_regression.py`
  - `bus_daily_chronos_t5_tiny.py.backup`
  - `bus_hourly_chronos_t5_tiny.py.backup`

#### Data Sync
- **Synced bus stops** — `busStops.ts` now has 62 stops (was 10), matching `busStopCoordinates.ts`
- Added region comments (Downtown, North Charleston, Mount Pleasant, etc.)

### 🧪 Testing Infrastructure
- **Added Jest testing framework** with ts-jest
- **Created test suite** with 28 tests:
  - `__tests__/lib/convertToUTC.test.ts` — 6 tests for time parsing
  - `__tests__/lib/api/gemini.test.ts` — 11 tests for JSON extraction
  - `__tests__/lib/api/tomtom.test.ts` — 5 tests for bbox calculation
  - `__tests__/data/busStops.test.ts` — 6 tests for data consistency
- **Added test scripts** to package.json:
  - `npm test` — run all tests
  - `npm run test:watch` — watch mode
  - `npm run test:coverage` — coverage report

### 📚 Documentation
- **Added demo-only comment** to `auth-context-provider.tsx`
- **Added JSDoc comments** to API utility functions
- **Updated `transit-insights-demo/route.ts`** with usage documentation

### 🗑️ Deleted Files
| File | Reason |
|------|--------|
| `src/app/api/getTravelTime/` | Duplicate functionality |
| `src/app/api/simple-gemini-test/` | Security risk |
| `src/app/api/test-gemini/` | Redundant |
| `src/app/api/test/` | Debug only |
| `src/app/api/test-env/` | Security risk |
| `src/app/api/test-tomtom/` | Debug only |
| `src/app/api/transit-insights-simple/` | Merged into demo |
| `model_service/bus_commuters_regression.py` | Never used |
| `model_service/*.py.backup` | Backup clutter |
| `test-gemini.js` | Root test script |
| `test-gemini.sh` | Root test script |

### 📁 New Files
| File | Purpose |
|------|---------|
| `src/lib/api/gemini.ts` | Gemini AI client |
| `src/lib/api/openai.ts` | OpenAI client |
| `src/lib/api/tomtom.ts` | TomTom API client |
| `src/lib/api/ridership.ts` | ML service client |
| `src/lib/api/index.ts` | Barrel export |
| `src/jest.config.js` | Jest configuration |
| `src/__tests__/` | Test suite |
| `REFACTORING_PLAN.md` | Refactoring documentation |
| `CHANGELOG.md` | This file |
| `CONTEXT.md` | Project context for devs/AI |

---

## [0.2.0] - 2025-11-XX (Previous Release)

### Features
- Initial  implementation
- AI-powered transit recommendations
- Gemini and OpenAI integration
- TomTom traffic data
- Python ML service with Chronos forecasting
- Next.js 14 frontend with Shadcn/UI
- Demo scenarios for investor presentations

---

## Version History

| Version | Date | Summary |
|---------|------|---------|
| 0.2.1 | 2025-12-05 | Refactoring, security fixes, testing |
| 0.2.0 | 2025-11-XX | Initial  release |
