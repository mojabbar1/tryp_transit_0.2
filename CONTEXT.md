# Project Context — Tryp Transit

> **Purpose**: Provide context for software engineers and AI coding assistants working on this codebase.
> 
> **Last Updated**: December 5, 2025

---

## Project Overview

**Tryp Transit** is an AI-powered transit recommendation app that encourages public transportation use through personalized incentives and real-time traffic insights.

### Core Value Proposition
- Help users choose transit over driving
- Provide compelling "nudge" messages using AI
- Offer incentives (credits, discounts, rewards)
- Show real-time traffic conditions and travel estimates

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Next.js Frontend                        │
│                    (src/, port 3000)                         │
├─────────────────────────────────────────────────────────────┤
│  Pages          │  API Routes           │  Shared Libs       │
│  - /find-rides  │  - /transit-insights  │  - lib/insights/   │
│  - /dashboard   │    (v2 engine)        │  - lib/domain/     │
│  - /routes      │  - /transit-demo      │  - lib/llm/        │
│                 │    (demo mode only)   │  - lib/api/ (TomTom)│
└─────────────────┴───────────┬───────────┴────────────────────┘
                              │
                              ▼
                   ┌──────────────────────────────┐
                   │   External APIs               │
                   │  - TomTom (route, flow)       │
                   │  - Gemini/OpenAI (narration   │
                   │    by reference only)         │
                   └──────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│     Python ML Service (expansion stage; not called by the    │
│     web app since P1, F-07)  (model_service/, port 5001)     │
├─────────────────────────────────────────────────────────────┤
│  Flask App     │  Prediction Models    │  Data               │
│  - /health     │  - Hourly ridership   │  - MTA CSV files    │
│  - /predict/*  │  - Daily ridership    │  - Mock fallbacks   │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Directories

### Frontend (`src/`)

Next.js 16 (App Router, Turbopack) on React 19; requires Node.js ≥ 22 (`engines` in `src/package.json`; the `openai` 7 SDK needs it; CI uses Node 22). Lint runs through the ESLint 9 CLI (`src/eslint.config.mjs`), not `next lint`.

| Directory | Purpose |
|-----------|---------|
| `app/` | Next.js App Router pages and API routes |
| `app/api/transit-insights/` | **Main API**: a thin wrapper around the v2 engine (`lib/insights/v2.ts`); TomTom plus approved assumptions, with LLM narration by reference |
| `app/api/transit-insights-demo/` | Demo scenarios, only with `NEXT_PUBLIC_DEMO_MODE=true` (404 otherwise) |
| `app/data/` | Static data (bus stops, coordinates) |
| `components/` | Reusable React components |
| `components/ui/` | Shadcn/UI primitives |
| `contexts/` | React Context providers (auth, geolocation, travel) |
| `lib/` | Utilities and shared code |
| `lib/api/` | TomTom client (route with `arriveAt`, flow, incidents) |
| `lib/contracts/` | zod contract for `/api/transit-insights` (single source of truth) |
| `lib/domain/` | Pure deterministic math and the approved assumptions |
| `lib/llm/` | Server-only LLM seam: providers, narration, claim validator, template |
| `lib/insights/` | The v2 engine and narration facts |
| `lib/env.ts` | Server-only, zod-validated environment |
| `types/` | TypeScript interfaces |
| `validation/` | Zod schemas for form validation |
| `__tests__/` | Jest test suite |

### Backend (`model_service/`)

| File | Purpose |
|------|---------|
| `app.py` | Flask server with `/health`, `/predict/hourly/:n`, `/predict/daily/:n` |
| `bus_hourly_chronos_t5_tiny.py` | Hourly ridership prediction (Chronos or mock) |
| `bus_daily_chronos_t5_tiny.py` | Daily ridership prediction |
| `data/` | CSV files with MTA ridership data |

---

## Environment Variables

### Frontend (`src/.env.local`)
Read only on the server, through the zod-validated `src/lib/env.ts` (`getEnv()`; `import 'server-only'`).
Blank values count as unset, and validation errors name variables but never echo values.
```bash
# Narration provider: gemini | openai | none. Unset = legacy rule (USE_GEMINI="true" -> gemini, else openai).
# A selected provider without a key becomes "none" (template narration).
LLM_PROVIDER=
USE_GEMINI=true                    # Legacy selector, used only when LLM_PROVIDER is unset
GEMINI_API_KEY=your_key
OPENAI_API_KEY=your_key
GEMINI_MODEL=                      # Optional; blank/unset = gemini-3.8-flash (D-4)
OPENAI_MODEL=                      # Optional; blank/unset = gpt-5.6-terra (D-4)
LLM_TIMEOUT_MS=8000                # Narration deadline; on timeout the template is used

# Traffic Data (server-only; legacy NEXT_PUBLIC_TOMTOM_API_KEY still read as a fallback, with a warning)
TOMTOM_API_KEY=your_key
REGION_TIMEZONE=America/New_York   # Arrival times resolve in this zone
DATA_AGENT_BASE_URL=               # Unused until P4

# Demo scenarios and demo-only copy (client-readable; never gates a secret). Default off.
NEXT_PUBLIC_DEMO_MODE=false
```
The web app calls no prediction service (F-07), so there is no ridership URL here.

### Backend (`model_service/.env`)
```bash
FLASK_ENV=development
FLASK_DEBUG=false                  # Default false
API_HOST=127.0.0.1                 # Default 127.0.0.1
API_PORT=5001                      # Default 5001
```

---

## Key Patterns

### 1. Deterministic numbers, one engine (P1)
`POST /api/transit-insights` is a thin wrapper around `src/lib/insights/v2.ts`, the only engine. There is no
legacy engine and no switch back to invented numbers (D-27); rollback is reverting the PR.
- Every number comes from TomTom (`src/lib/api/tomtom.ts`: an `arriveAt` route, flows, and incidents, each
  with a 5 s timeout, settled independently) or from the approved assumptions (`src/lib/domain/assumptions.ts`,
  copied verbatim from 05 §2 and guarded by a drift test).
- Domain math in `src/lib/domain/` is pure: `resolveArrival` (DST-aware), `densityFromFlows`,
  `calculateCost` (marginal and signed; never clamped), `calculateEmissions`, `getTransitResult`, and
  `evaluateIncentivePolicy`.
- Anything unavailable is omitted and named by a snake_case code in `meta.degraded`, for example
  `parking_not_approved`, `co2_transit_distance_unavailable`, `arrival_target_too_soon` or
  `traffic_not_configured`.
- `comparison.transit.basis` is `unavailable | scheduled | realtime`. Before GTFS (P4) it is always
  `unavailable`: no minutes, no departures, a null legacy `travelTime`, and empty `additionalRides` (D-21).
- `incentiveDetails` is null unless `meta.offerActive` (D-25). Demo scenarios (`src/lib/demo/`) are the
  only source of invented figures, only with `NEXT_PUBLIC_DEMO_MODE=true`, and always with `meta.demo: true`.

### 2. Graceful Degradation
The ML service falls back to realistic mock predictions when Chronos isn't available:

```python
# bus_hourly_chronos_t5_tiny.py
if pipeline_hourly == "mock" or df_hourly.empty:
    return generate_realistic_mock_prediction(hours_future)
```

### 3. Lazy Model Loading
Models load on first use, not at import time:

```python
def predict(hours_future):
    if pipeline_hourly is None:
        load_hourly_model()  # Lazy load
    ...
```

### 4. Narration by reference, fail closed
The LLM (`src/lib/llm/`: `@google/genai` or the OpenAI Responses API, both with strict JSON output) never
emits a digit.
- It receives self-describing facts `{ id, label, phrase }` and flags. It answers `{ nudge, slots }`, where
  each clause is `{{fact_id}}`, `<label>: {{fact_id}}`, or one allowlisted phrase
  (`validate-claims.ts#allowedProse`).
- `validateNudge` rejects any of these: digits, including other Unicode numerals; unknown or unused slots; a
  label that doesn't match its fact (which catches swap, period, and unit errors); a claim the flags
  contradict; and free prose.
- Only a validated nudge is substituted. A provider error, timeout, bad JSON, schema mismatch, or rejection
  falls back to the deterministic template (`template.ts`), with `narration_fallback` recorded and the reason
  logged.
- The shared vectors in `contracts/claim-validation.vectors.json` are reused by P5's Python code.

### 5. Demo-Only Authentication
Current auth uses localStorage (MVP only). See `auth-context-provider.tsx`:

```typescript
// NOTE: Demo/MVP implementation. For production, use NextAuth.js
const currentUser = localStorage.getItem('currentUser');
```

---

## API Contracts

### POST `/api/transit-insights`

The zod contract in `src/lib/contracts/transit-insights.ts` is the single source of truth; `src/types/interfaces.ts` re-exports it.

**Request:** `{ departure: { lat, lng }, destination: { lat, lng }, timeToDestination: "HH:MM" }`. An invalid body returns 400, with the issue paths in `details`.

**Response:** the legacy fields (their types are unchanged), plus the additive `comparison` and `meta`:
```typescript
{
  travelTime: number | null;              // null until GTFS (D-21)
  trafficDensity: "Light" | "Medium" | "Heavy" | null;   // "Traffic now" (current flow)
  costSavingsPerTrip: string | null;      // signed drive − transit, e.g. "-0.51"
  nudgeMessage: string | null;            // validated narration or the template
  incentiveDetails: {...} | null;         // only while meta.offerActive (D-25)
  additionalRides: [...] | null;          // [] until GTFS
  comparison?: { drive: {...} | null; transit: { basis, minutes, nextDepartures, source };
                 costUsd?: { drive, transit, difference /* signed */, factRefs }; co2Kg?: {...} };
  meta?: { generatedAt, region, timezone, demo, offerActive, trafficDensityLabel?,
           narration: { source: "template" | "llm", provider, model?, validated }, degraded, citations };
}
```

### GET `/predict/hourly/:hours`

**Response:** `number` (predicted ridership count)

---

## Testing

```bash
cd src
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
npm run typecheck     # Type-check (tsc --noEmit)
npm run lint          # ESLint 9 CLI with src/eslint.config.mjs (next lint was removed in Next 16)
npm run lockfile:check # Lockfile must use registry.npmjs.org URLs with sha512 integrity (CI enforces this)
npm run lockfile:fix   # After installing through a registry proxy: npm-10 regen, canonical URLs, verified sha512
```

### Test Files
- `__tests__/lib/contracts/transit-insights.test.ts`: contract invariants and the legacy-type guard
- `__tests__/lib/env.test.ts`: server-only env (provider selection, defaults, secrets never printed)
- `__tests__/lib/domain/*.test.ts`: assumptions drift guard, DST arrival, density, signed cost, emissions, transit and incentive
- `__tests__/lib/llm/*.test.ts`: the claim validator plus shared vectors, narration fallbacks, and both provider adapters
- `__tests__/lib/api/tomtom.test.ts`: bbox (lon-first) and area guard, `arriveAt` routing, timeouts, partial data
- `__tests__/app/api/transit-insights.test.ts`: v2 route (happy path, degraded, template, fail-closed, 400)
- `__tests__/lib/demo/scenarios.test.ts`: demo scenarios parse and are gated by `NEXT_PUBLIC_DEMO_MODE`
- `__tests__/lib/request-state.test.ts`: request lifecycle reducer (loading always clears)
- `__tests__/lib/utils.test.ts`, `__tests__/lib/format.test.ts`: number parsing, null checks, signed cost copy
- `__tests__/app/api/health.test.ts`: `/api/health` (booleans only)
- `__tests__/data/busStops.test.ts`: data consistency

---

## Common Tasks

### Adding a New Bus Stop
1. Add coordinates to `src/app/data/busStopCoordinates.ts`
2. Add entry to `src/app/data/busStops.ts`
3. Run `npm test` to verify consistency

### Switching AI Provider
```bash
# In src/.env.local
LLM_PROVIDER=gemini   # or openai, or none (template narration only)
```

### Running Without API Keys
The live route still works: with no LLM key it uses the template, and with no TomTom key it reports
`traffic_not_configured`. For scripted walkthroughs, set `NEXT_PUBLIC_DEMO_MODE=true` and use the demo endpoint;
it returns 404 while demo mode is off:
```
POST /api/transit-insights-demo
{ "demoScenario": "rush-hour" | "weekend" | "night-out" }
```

### Adding a New API Utility
1. Create file in `src/lib/api/`
2. Export from `src/lib/api/index.ts`
3. Add tests in `src/__tests__/lib/api/`

---

## Known Limitations

| Limitation | Impact | Future Fix |
|------------|--------|------------|
| localStorage auth | Not secure for production | Migrate to NextAuth.js |
| PyTorch ~2GB | Large model service footprint | Migrate to Prophet |
| No rate limiting | API abuse possible | Add middleware |
| No caching | Repeated API calls | Add Redis/memory cache |
| CSV data source | Not scalable | Migrate to database |

---

## Code Quality Standards

- **TypeScript**: Strict mode enabled, avoid `any`
- **Testing**: Add tests for new utilities
- **API Responses**: Use typed interfaces from `types/interfaces.ts`
- **Error Handling**: Always provide fallback responses
- **Comments**: Add JSDoc for exported functions
- **Imports**: Use `@/` alias for absolute imports

---

## Related Documentation

- [REFACTORING_PLAN.md](./REFACTORING_PLAN.md) — Detailed refactoring notes
- [CHANGELOG.md](./CHANGELOG.md) — Version history
- [SETUP.md](./SETUP.md) — Installation guide
- [DEMO_CHECKLIST.md](./DEMO_CHECKLIST.md) — Investor demo guide

---

## Contact

For questions about this codebase, check the documentation or review the test files for usage examples.
