# Phase 1 — Web contracts, LLM seam, deterministic trip math (execution prompt)

> **How to use:** once P0 and P0B are merged and Phase 1 is signed off in
> [05](../05-decisions-and-review.md), paste this whole file into your coding agent.
> **Plan:** [04 → Pilot](../04-implementation-plan.md#pilot) ·
> **Design:** [02 §8](../02-target-architecture.md#8-integration-with-the-existing-app) ·
> **Fixes:** F-05 (partial), F-09, F-10, F-11, F-17, F-18 (web), F-21, F-26 (gate)

---

## Role and mode

You're a senior TypeScript engineer making the insight API **trustworthy**. Numbers are computed
deterministically. The LLM **never emits a digit** — it narrates by referencing self-describing facts, and a
validator enforces that (numbers by reference; see [02 §7.3](../02-target-architecture.md#73-guardrails)). The
response changes are **additive**: every existing field keeps its name and type. There is **no legacy engine and
no runtime switch back to invented numbers** (D-27). If anything here conflicts with the code after P0B, **stop and
ask**.

## Preconditions

- [ ] P0 and P0B are merged, CI on `main` is green, and you're on `feat/tda-phase-1-web-seams` from the latest `main`.
- [ ] The **D-24 named baseline** is on `main` (P0's precondition), so the code paths referenced here exist.
- [ ] 05 sign-off records **D-4** (default provider and model IDs), **D-15** (narration stays in the web app),
      **D-21** (pre-GTFS transit result is **`unavailable`**, not an invented estimate), **D-25** (rewards render
      only when an approved offer inventory exists), and **D-27** (rollback is reverting the PR; no legacy engine).
- [ ] The **assumptions table** in 05 is approved: cost per mile, parking, fare, and CO2 factors. **Don't invent
      values.** If a value isn't approved, omit that output and add a `meta.degraded` reason. Density thresholds and
      the incentive policy are only used where an approved source backs them.

## Read first

`src/app/api/transit-insights/route.ts`, `src/app/api/transit-insights-demo/route.ts`, `src/lib/api/*.ts`,
`src/types/interfaces.ts`, `src/contexts/travel-context.tsx`, `src/app/page.tsx`, `src/__tests__/**`,
`src/jest.config.js`, and [02 §7.3 guardrails](../02-target-architecture.md#73-guardrails).

## Scope

**In:** contracts, env, domain utilities, the TomTom client, the LLM seam, the route orchestration, minimal UI
copy (basis/cost notes, a demo badge), tests, and docs. **Out:** GTFS and the data agent (P4), new pages, auth,
and styling changes beyond those notes.

## Tasks

### T1. Contracts: the single source of truth (F-17)
Create `src/lib/contracts/transit-insights.ts` with zod schemas and inferred types for:
- `LatLng` (lat in [-90, 90], lng in [-180, 180])
- `TransitInsightRequest` (`timeToDestination` matches `^([01]\d|2[0-3]):[0-5]\d$`)
- `IncentiveDetails`, `AdditionalRide`, `SourceRef`
- `Comparison` and `Meta` (shapes from [02 §8.1](../02-target-architecture.md#81-apitransit-insights-backward-compatible-evolution)).
  Note the two invariants from 02: `comparison.transit.basis` is the enum `unavailable | scheduled | realtime`
  (**not** an `estimated` boolean), and `comparison.costUsd.difference` is a **signed** number (negative = the trip
  costs more). Rewards fields are optional and present only when `offerActive`.
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
- `REGION_TIMEZONE` (default `America/New_York`).
- `DATA_AGENT_BASE_URL?` (unused until P4; the web app never calls `model_service`).

There is **no `INSIGHTS_ENGINE` switch** (D-27) and no `RIDERSHIP_API_BASE_URL` — the live app doesn't call the
ridership service. A separate **`NEXT_PUBLIC_DEMO_MODE`** flag (default off, client-readable) is read where the UI
needs it; it never gates a secret. Add `server-only` as a dependency.

### T3. Deterministic domain (`src/lib/domain/`), pure functions with tests (F-05, F-09)
- `time.ts`: `resolveArrival(hhmm, now, tz)` → `{ arrivalUtc, minutesUntil, localHour, dayType }`. It rolls to the
  next local day if the time has already passed. Use `Intl` only, or a small tz library. Test the DST days
  **2026-03-08** and **2026-11-01** in `America/New_York`.
- `traffic.ts`: `densityFromFlows(flows, thresholds)` → `Light | Medium | Heavy | null`, from `currentSpeed/freeFlowSpeed`.
- `cost.ts`: drive cost (distance × per-mile cost + parking) and transit fare in cents, returning a **signed**
  `differenceCents` (drive − transit; negative means transit costs more) plus the assumption refs it used. Never
  clamp to zero — a zero or negative saving is a valid, honest result (F-25).
- `emissions.ts`: CO2 for the car and the bus trip, with refs.
- `transit-result.ts`: pre-GTFS, the transit leg is **`basis: "unavailable"`** (D-21). Return no minutes and no
  invented fare; the response says transit timing isn't known yet. **Do not** synthesize a heuristic bus time.
- `incentive-policy.ts`: returns an `IncentiveDetails` **only when an approved offer inventory is present**
  (D-25). With no active offer it returns `null` and sets the `offerActive` flag false. The LLM never picks values.
- `assumptions.ts`: typed constants shaped as `{ value, unit, source: { name, url, retrieved } }`, copied **verbatim**
  from the 05 assumptions table.

### T4. TomTom client (F-10)
In `src/lib/api/tomtom.ts`:
- Type the incident response.
- `calculateBbox` already emits `minLon,minLat,maxLon,maxLat` after the P0 F-23 fix. **Add an area guard**: if the
  computed box is degenerate or spans more than a sane maximum (e.g. > ~0.5°), widen/clamp to a valid minimum box
  and record a `degraded` reason rather than sending a bad box. Keep the corrected `calculateBbox` tests.
- Add `getDriveRoute(dep, dest, arriveAt)` using the Calculate Route API with traffic and TomTom's **arrival-time**
  parameter (`arriveAt`, a dateTime; it defaults to the destination's time zone and **can't** be combined with
  `departAt` — source S-7). The UI field is "Desired Arrival Time", so never send it as a departure time. It returns
  `{ minutes, delayMinutes, distanceMiles, freeFlowMinutes? }`. A test asserts the exact upstream time parameter.
- **Arrival target too soon** (A10): if `arriveAt` is at or before `now + minimum travel`, TomTom can't plan it.
  Fall back to a free-flow/`departAt: now` route and set a `degraded` reason `arrival_target_too_soon`.
- Every call gets a 5 s timeout.
- `getTrafficData` uses `Promise.allSettled` and returns partial data plus `degraded: string[]`.
- The live flow data describes **current** conditions, so label the density "Traffic now" in `meta` and in the UI.

### T5. LLM seam (`src/lib/llm/`) (F-11) — numbers by reference
- `provider.ts`: `interface LlmProvider { name; model; generateJson<T>({ system, user, schema, jsonSchema, timeoutMs }): Promise<T> }`
  and `getProvider(env): LlmProvider | null`.
- `gemini.ts`: migrate to the **`@google/genai`** SDK (Node ≥ 20) and remove `@google/generative-ai`. Request JSON
  output constrained by a schema. Check the current method names in the official migration guide.
- `openai.ts`: upgrade `openai` to its current major and use the **Responses API** with **Structured Outputs**
  (a strict JSON schema). Check the current method names in the official docs.
- JSON schema from zod: if zod 4 is installed, use `z.toJSONSchema()`; otherwise add `zod-to-json-schema`.
- `narrate.ts`: build a **facts-only** prompt. The model receives:
  - `facts`: `{ id, label, phrase }[]`, where `phrase` is a self-describing rendered string such as
    `"about 25 min by car"` or `"$4.25 less than driving"`. **The model never sees or emits a raw number.**
  - `flags`: `{ transitServiceKnown, transitFaster, transitCheaper, offerActive, trafficNow }`.
  - The output schema is `{ nudge, slots }`. `nudge` is 1–2 sentences containing **no digits**; it references facts
    only through `{{fact_id}}` slots. `slots` lists the fact ids used. Tone rules: no false urgency or fear.
- `validate-claims.ts`: `validateNudge(nudge, slots, facts, flags)` → `{ ok, reason? }`. It rejects the output if:
  the `nudge` contains any digit, an unknown slot id, a slot not present in `slots`, or a comparative/claim word
  that contradicts the flags (e.g. "faster" while `transitFaster` is false, "next bus" while
  `transitServiceKnown` is false, "reward/credit" while `offerActive` is false). Only on success does code
  substitute each `{{fact_id}}` with its `phrase`. **Fail closed**: any rejection, timeout, invalid JSON, or schema
  mismatch falls back to the deterministic template.
- Create `contracts/claim-validation.vectors.json` at the **repo root** (P5's Python code reuses it). It holds a
  `rules` header and at least 12 cases, and **must** include the counterexamples that a naive
  "does the number appear" check would pass: a **swap** (transit/drive phrases swapped), a **period** mismatch
  (weekly vs daily), a **negation** ("not faster"), a **unit** mismatch (minutes vs miles), plus exact, unknown
  slot, digit-in-nudge, and empty-nudge cases.
- `template.ts`: deterministic nudge templates by density, signed savings, and `basis`. This is the fallback
  whenever the provider is missing, times out, returns invalid JSON, or fails validation.

### T6. Route orchestration (F-05, F-10, F-18)
There is **one engine** (D-27). Put it in `src/lib/insights/v2.ts`, with the route as a thin wrapper. **Delete the
old invented-number prompt path** — do not move it into a `legacy.ts`, and there is no `INSIGHTS_ENGINE` switch.
The v2 flow:
1. Parse the body with zod. Invalid input returns 400 with the issue paths.
2. Call `resolveArrival`.
3. Run the TomTom route (`arriveAt`), flows, and incidents calls through `allSettled`. **v2 never calls
   `model_service`** (F-07) — the ridership service returns NYC-based or random numbers, so no code path touches it.
4. Compute density, drive, cost (signed difference), CO2, the D-21 transit result (`basis: "unavailable"`), and
   the incentive **only if an offer is active** (D-25).
5. Build the narration facts and flags, narrate if a provider exists, validate (numbers by reference), and fall
   back to the template on any failure (fail closed).
6. Assemble the legacy fields (`costSavingsPerTrip` as a string; `additionalRides: []` per D-21) plus `comparison`
   (`transit.basis`, signed `costUsd.difference`) and `meta` (`narration: { provider, model, validated }`,
   `degraded`, `citations`, `timezone`, `demo: false`).
7. `safeParse` the outgoing response and log a warning on mismatch.

Also:
- Add `src/lib/log.ts`, a JSON-line logger (level, msg, requestId, durationMs). Don't log raw LLM text at info
  level, and don't log key-presence flags.
- Make the demo route contract-valid, and add `meta: { demo: true, … }`. Demo scenarios are the only place invented
  timings appear, and only when `NEXT_PUBLIC_DEMO_MODE` is on.

### T7. Minimal UI changes (`src/app/page.tsx`)
- Show a "Transit timing unavailable" note when `comparison?.transit.basis === "unavailable"` instead of a fake
  travel time. No "Estimated" badge — there's no estimate to badge.
- Format the signed cost from `comparison.costUsd.difference`: "save $x", "about the same", or "costs $x more".
  Single `$`, formatted from a number.
- When `meta.degraded` includes a traffic reason, show a subtle "Live traffic unavailable" note.
- Reward copy renders only when the response carries an active incentive (D-25). In `NEXT_PUBLIC_DEMO_MODE`, show a
  small "Demo" badge next to any demo-sourced figure.
- No other visual changes.

### T8. Tests (Jest)
- Route tests (mock `@/lib/api/tomtom` and `@/lib/llm/provider`):
  - happy path
  - TomTom down → 200 + `degraded`
  - no provider → template
  - provider timeout → template
  - **numbers-by-reference**: a nudge containing a digit → rejected → template, `validated: false`
  - **swap counterexample**: transit/drive phrases swapped → rejected (from the vectors file)
  - invalid body → 400
  - **v2 never imports or calls the ridership client** (assert no such module is referenced)
  - `getDriveRoute` receives the arrival time as `arriveAt`; `arrival_target_too_soon` falls back
  - `comparison.costUsd.difference` is negative when transit costs more (no zero-clamp)
- Unit tests for every domain module, including DST and the `basis: "unavailable"` transit result.
- A claim-validator test that loads `../contracts/claim-validation.vectors.json` (fix the Jest `roots` if needed),
  asserting the swap/period/negation/unit counterexamples are rejected.
- Parse every demo scenario with the response schema.

### T9. Clean up
- Delete `src/lib/convertToUTC.ts`, its test, and the unused import (`route.ts:10`).
- Remove the streaming JSON path in the old `openai.ts`.
- Update the `lib/api/index.ts` exports.

### T10. Docs
- `CONTEXT.md`: new patterns (deterministic numbers, narration by reference and the validator, env, no legacy
  engine, `basis` semantics).
- `src/.env.example`: add `NEXT_PUBLIC_DEMO_MODE`; remove any `INSIGHTS_ENGINE`/`RIDERSHIP_API_BASE_URL`.
- `CHANGELOG.md` **[0.3.0-alpha.1]**.

## Constraints

- Legacy response fields keep their names and types. New fields are optional.
- No numbers are invented anywhere in live mode. Every constant comes from `assumptions.ts`, and every assumption
  from 05. The LLM emits no digits.
- Nothing ships to the client that reads `process.env` secrets. `server-only` guards `env.ts` and `lib/llm/*`.
- Only add the dependencies named here (`server-only`, `@google/genai`, the `openai` upgrade, and
  `zod-to-json-schema` only if needed).

## Verification (paste the output into the PR)

```bash
cd src && npm ci && npm run lint && npm run typecheck && npm test -- --ci && NEXT_TELEMETRY_DISABLED=1 npm run build
# Local smoke (npm run dev in another shell; unset LLM and TomTom keys for the first two)
curl -s -X POST http://localhost:3000/api/transit-insights -H 'content-type: application/json' \
  -d '{"departure":{"lat":32.7813,"lng":-79.9306},"destination":{"lat":32.7878,"lng":-79.9512},"timeToDestination":"08:30"}' \
  | jq -e '.meta.narration.provider=="template" and .comparison.transit.basis=="unavailable"' && echo "OK: template + unavailable"
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/transit-insights \
  -H 'content-type: application/json' -d '{"departure":{}}'   # expect: 400
grep -rn "INSIGHTS_ENGINE\|RIDERSHIP_API_BASE_URL\|model_service\|model-service" src ; test $? -eq 1 && echo "OK: no legacy engine / ridership refs"
```

(Human, with keys) Run one live request per provider and check that `meta.narration.validated` is `true`, or that
it fell back to the template with the reason logged.

## Definition of done

- [ ] CI is green, and every test case listed in T8 exists and passes.
- [ ] `grep -rn "gemini-1.5\|gpt-3.5" src --include=*.ts` returns nothing.
- [ ] `grep -rn "INSIGHTS_ENGINE\|model_service" src` returns nothing (D-27; F-07).
- [ ] No `any` remains in `src/lib/**` (`grep -rn ": any" src/lib` is empty).
- [ ] The PR includes a sample v2 response for a demo scenario and a live request.

## Rollback

Per **D-27**, rollback is reverting this PR. There is no runtime switch back to invented numbers.

## Handoff

In [../README.md](../README.md), set P1 to Done. Record that the transit leg stays `basis: "unavailable"` until P4
supplies `scheduled` timing, and note the assumptions that P3 should move into the fact store.
