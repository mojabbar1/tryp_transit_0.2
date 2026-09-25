# Phase 1 — Web contracts, LLM seam, deterministic trip math (execution prompt)

> **How to use:** once P0 and P0B are merged and Phase 1 is signed off in
> [05](../05-decisions-and-review.md), paste this whole file into your coding agent.
> **Plan:** [04 §Phase 1](../04-implementation-plan.md#phase-1--web-contracts-llm-seam-deterministic-trip-math-parallel-safe-with-p2) ·
> **Design:** [02 §8](../02-target-architecture.md#8-integration-with-the-existing-app) ·
> **Fixes:** F-05 (partial), F-09, F-10, F-11, F-17, F-18 (web), F-21

---

## Role and mode

You're a senior TypeScript engineer making the insight API **trustworthy**. Numbers are computed
deterministically. The LLM only **narrates** numbers it's given, and a validator enforces that. The response
changes are **additive**: every existing field keeps its name and type. If anything here conflicts with the code
after P0B, **stop and ask**.

## Preconditions

- [ ] P0 and P0B are merged, CI on `main` is green, and you're on `feat/tda-phase-1-web-seams` from the latest `main`.
- [ ] 05 sign-off records **D-4** (default provider and model IDs), **D-15** (narration stays in the web app), and
      **D-21** (pre-GTFS transit estimate and alternatives).
- [ ] The **assumptions table** in 05 is approved: cost per mile, parking, fare, CO2 factors, density thresholds,
      the transit heuristic, and the incentive policy. **Don't invent values.** If a value isn't approved, omit that
      output and add a `meta.degraded` reason.

## Read first

`src/app/api/transit-insights/route.ts`, `src/app/api/transit-insights-demo/route.ts`, `src/lib/api/*.ts`,
`src/types/interfaces.ts`, `src/contexts/travel-context.tsx`, `src/app/page.tsx`, `src/__tests__/**`,
`src/jest.config.js`, and [02 §7.3 guardrails](../02-target-architecture.md#73-guardrails).

## Scope

**In:** contracts, env, domain utilities, the TomTom client, the LLM seam, the route orchestration, a minimal UI
badge, tests, and docs. **Out:** GTFS and the data agent (P4), new pages, auth, and styling changes beyond the badge.

## Tasks

### T1. Contracts: the single source of truth (F-17)
Create `src/lib/contracts/transit-insights.ts` with zod schemas and inferred types for:
- `LatLng` (lat in [-90, 90], lng in [-180, 180])
- `TransitInsightRequest` (`timeToDestination` matches `^([01]\d|2[0-3]):[0-5]\d$`)
- `IncentiveDetails`, `AdditionalRide`, `SourceRef`
- `Comparison` and `Meta` (shapes from [02 §8.1](../02-target-architecture.md#81-apitransit-insights-backward-compatible-evolution))
- `TransitInsightResponse`: the legacy fields unchanged, plus optional `comparison` and `meta`

`src/types/interfaces.ts` re-exports these under the existing names (`RequestBody` becomes an alias of
`TransitInsightRequest`). `src/contexts/travel-context.tsx` imports `AdditionalRide` from the contract. Delete the
duplicate interfaces and the `any` in `TrafficData`.

### T2. Server-only env
Create `src/lib/env.ts`: `import "server-only"`, a lazy `getEnv()`, validated by zod. It reads:
- `LLM_PROVIDER` (`gemini | openai | none`). If it's unset, derive it from the legacy `USE_GEMINI`. If the
  selected provider has no key, the provider is `none`.
- `GEMINI_API_KEY?`, `OPENAI_API_KEY?`, `GEMINI_MODEL`, and `OPENAI_MODEL`, with defaults from D-4.
- `LLM_TIMEOUT_MS` (default 8000).
- `TOMTOM_API_KEY?`, with the legacy fallback.
- `RIDERSHIP_API_BASE_URL`.
- `REGION_TIMEZONE` (default `America/New_York`).
- `DATA_AGENT_BASE_URL?`.
- `INSIGHTS_ENGINE` (`v2 | legacy`, default `v2`).

Add `server-only` as a dependency.

### T3. Deterministic domain (`src/lib/domain/`), pure functions with tests (F-05, F-09)
- `time.ts`: `resolveArrival(hhmm, now, tz)` → `{ arrivalUtc, minutesUntil, localHour, dayType }`. It rolls to the
  next local day if the time has already passed. Use `Intl` only, or a small tz library. Test the DST days
  **2026-03-08** and **2026-11-01** in `America/New_York`.
- `traffic.ts`: `densityFromFlows(flows, thresholds)` → `Light | Medium | Heavy | null`, from `currentSpeed/freeFlowSpeed`.
- `cost.ts`: drive cost (distance × per-mile cost + parking), transit fare, and `savings = max(0, drive − transit)`
  in cents. It returns the assumption refs it used.
- `emissions.ts`: CO2 for the car and the bus trip, with refs.
- `transit-estimate.ts`: the **D-21 heuristic** (for example, free-flow drive minutes × factor + expected wait), always
  flagged `estimated: true`.
- `incentive-policy.ts`: density → `IncentiveDetails`, taken from the approved policy table. The LLM never picks values.
- `assumptions.ts`: typed constants shaped as `{ value, unit, source: { name, url, retrieved } }`, copied **verbatim**
  from the 05 assumptions table.

### T4. TomTom client (F-10)
In `src/lib/api/tomtom.ts`:
- Type the incident response.
- Add `getDriveRoute(dep, dest, arriveAt)` using the Routing API with traffic and TomTom's **arrival-time**
  parameter (`arriveAt`; confirm the name and constraints in the TomTom docs, source S-7). The UI field is
  "Desired Arrival Time", so never send it as a departure time. It returns
  `{ minutes, delayMinutes, distanceMiles, freeFlowMinutes? }`. A test asserts the exact upstream time parameter.
- Every call gets a 5 s timeout.
- `getTrafficData` uses `Promise.allSettled` and returns partial data plus `degraded: string[]`.
- The live flow data describes **current** conditions, so label the density "Traffic now" in `meta` and in the UI.
- Keep `calculateBbox` and its tests.

### T5. LLM seam (`src/lib/llm/`) (F-11)
- `provider.ts`: `interface LlmProvider { name; model; generateJson<T>({ system, user, schema, jsonSchema, timeoutMs }): Promise<T> }`
  and `getProvider(env): LlmProvider | null`.
- `gemini.ts`: migrate to the **`@google/genai`** SDK (Node ≥ 20) and remove `@google/generative-ai`. Request JSON
  output constrained by a schema. Check the current method names in the official migration guide.
- `openai.ts`: upgrade `openai` to its current major and use the **Responses API** with **Structured Outputs**
  (a strict JSON schema). Check the current method names in the official docs.
- JSON schema from zod: if zod 4 is installed, use `z.toJSONSchema()`; otherwise add `zod-to-json-schema`.
- `narrate.ts`: build a **facts-only** prompt from `NarrationFacts` (id, value, unit, label). The output schema is
  `{ nudgeMessage, incentiveCopy, citations: string[] }`. Tone rules: 1–2 sentences; no false urgency or fear; no
  numbers that aren't in the facts; "about" for estimates.
- `validate-claims.ts`: `validateClaims(text, facts)` → `{ ok, unmatched }`. It extracts currency, decimals,
  integers, percents, and "N min" values, and ignores clock times such as `08:30` unless a departure fact matches.
  Tolerances: currency ±0.01, minutes ±1, percent ±0.5.
- Create `contracts/claim-validation.vectors.json` at the **repo root** (P5's Python code reuses it). It holds a
  `rules` header and at least 12 cases: exact, rounded, unmatched, percent, minutes, clock time, empty text, and
  multiple numbers.
- `template.ts`: deterministic nudge templates by density and savings. This is the fallback whenever the provider
  is missing, times out, returns invalid JSON, or fails validation.

### T6. Route orchestration (F-05, F-10, F-18)
1. Move the current prompt path, unchanged except for model env, into `src/lib/insights/legacy.ts`. Select it with
   `INSIGHTS_ENGINE=legacy` for one release.
2. Put v2 in `src/lib/insights/v2.ts`, with the route as a thin wrapper. The v2 flow:
   1. Parse the body with zod. Invalid input returns 400 with the issue paths.
   2. Call `resolveArrival`.
   3. Run the TomTom route (`arriveAt`), flows, and incidents calls through `allSettled`. **v2 never calls
      `model_service`**, because the ridership service returns NYC-based or random numbers until P6 (F-07). Only
      the legacy engine keeps calling it.
   4. Compute density, drive, cost, CO2, the D-21 transit estimate, and the incentive.
   5. Narrate if a provider exists, validate, and fall back to the template if needed.
   6. Assemble the legacy fields (`costSavingsPerTrip` as a string like `"4.25"`; `additionalRides: []` per D-21)
      plus `comparison` and `meta` (`narration: { provider, model, validated }`, `degraded`, `citations`,
      `timezone`).
   7. `safeParse` the outgoing response and log a warning on mismatch.
3. Add `src/lib/log.ts`, a JSON-line logger (level, msg, requestId, durationMs). Don't log raw LLM text at info
   level, and don't log key-presence flags.
4. Make the demo route contract-valid, and add `meta: { demo: true, … }`.

### T7. Minimal UI changes (`src/app/page.tsx`)
- Show an "Estimated" badge next to Travel Time when `comparison?.transit.estimated`.
- Format currency from numbers, with a single `$`.
- When `meta.degraded` includes a traffic reason, show a subtle "Live traffic unavailable" note.
- No other visual changes.

### T8. Tests (Jest)
- Route tests (mock `@/lib/api/tomtom`, `@/lib/api/ridership`, and `@/lib/llm/provider`):
  - happy path
  - TomTom down → 200 + `degraded`
  - no provider → template
  - provider timeout → template
  - unmatched number → template, `validated: false`
  - invalid body → 400
  - **v2 never calls the ridership client** (assert the mock isn't called)
  - `getDriveRoute` receives the arrival time as `arriveAt`
  - `INSIGHTS_ENGINE=legacy` still works
- Unit tests for every domain module, including DST.
- A claim-validator test that loads `../contracts/claim-validation.vectors.json` (fix the Jest `roots` if needed).
- Parse every demo scenario with the response schema.

### T9. Clean up
- Delete `src/lib/convertToUTC.ts`, its test, and the unused import (`route.ts:10`).
- Remove the streaming JSON path in the old `openai.ts`.
- Update the `lib/api/index.ts` exports.

### T10. Docs
- `CONTEXT.md`: new patterns (deterministic numbers, narration and the validator, env).
- `src/.env.example`.
- `CHANGELOG.md` **[0.3.0-alpha.1]**.

## Constraints

- Legacy response fields keep their names and types. New fields are optional.
- No numbers are invented anywhere. Every constant comes from `assumptions.ts`, and every assumption from 05.
- Nothing ships to the client that reads `process.env` secrets. `server-only` guards `env.ts` and `lib/llm/*`.
- Only add the dependencies named here (`server-only`, `@google/genai`, the `openai` upgrade, and
  `zod-to-json-schema` only if needed).

## Verification (paste the output into the PR)

```bash
cd src && npm ci && npm run lint && npm run typecheck && npm test -- --ci && NEXT_TELEMETRY_DISABLED=1 npm run build
# Local smoke (npm run dev in another shell; unset LLM and TomTom keys for the first two)
curl -s -X POST localhost:3000/api/transit-insights -H 'content-type: application/json' \
  -d '{"departure":{"lat":32.7813,"lng":-79.9306},"destination":{"lat":32.7878,"lng":-79.9512},"timeToDestination":"08:30"}' | jq '{d: .meta.degraded, n: .meta.narration}'
# expect: HTTP 200, degraded contains "traffic.unavailable", narration.provider == "template"
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/api/transit-insights -H 'content-type: application/json' -d '{"departure":{}}'
# expect: 400
```

(Human, with keys) Run one live request per provider and check that `meta.narration.validated` is `true`, or that
it fell back to the template, with the reason logged.

## Definition of done

- [ ] CI is green, and every test case listed in T8 exists and passes.
- [ ] `grep -rn "gemini-1.5\|gpt-3.5" src --include=*.ts` returns nothing.
- [ ] No `any` remains in `src/lib/**` (`grep -rn ": any" src/lib` is empty).
- [ ] The PR includes before/after sample responses (legacy vs v2) for a demo scenario and a live request.

## Rollback

`INSIGHTS_ENGINE=legacy` restores the v0.2.x behavior at runtime. If that isn't enough, revert the PR.

## Handoff

In [../README.md](../README.md), set P1 to Done. Record the remaining `estimated` fields for P4 to replace. Note
the assumptions that P3 should move into the fact store.
