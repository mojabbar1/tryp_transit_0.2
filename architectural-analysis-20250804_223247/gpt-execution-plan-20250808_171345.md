## GPT Execution Plan for MVP/Investor Demo Hardening — Tryp Transit v0.2

Generated: 2025-08-08 17:13:45

### How to use this plan

- Paste one PHASE at a time into your AI coding tool (e.g., Cursor) and let it execute each substep sequentially.
- For every substep: implement edits, run the listed commands, verify acceptance criteria, and only then proceed.
- Keep changes scoped to the current substep (KISS/YAGNI). Avoid cross-phase refactors unless required to get green tests/build.

### Conventions

- Monorepo root: `tryp_transit_0.2/`
- App root: `tryp_transit_0.2/src/`
- ML service: `tryp_transit_0.2/model_service/`
- Duplicate tree to avoid: `tryp_transit_0.2/src/src/` (do not delete yet; remove from build/test scope first)

---

## PHASE 0 — Preflight and Baseline

Goal: Establish a clean baseline, determine package manager, and capture current test/build status.

DoD: Package manager detected; dependencies installed; baseline tests/build results captured; no code changes yet.

Substep 0.1 — Detect toolchain and install

PROMPT
```
Status update: Detect toolchain and install deps without interactive prompts.

Actions:
1) Detect lockfile. If `pnpm-lock.yaml` exists, use pnpm; if `yarn.lock`, use yarn; else use npm.
2) Install dependencies at repo root.
3) Print node and package manager versions.

Commands (choose one set based on lockfile):
- npm: npm ci || npm install
- pnpm: corepack enable && pnpm install
- yarn: corepack enable && yarn install --immutable || yarn install

Verification:
- Print the chosen package manager.
- Print `node -v` and manager version.
```

Substep 0.2 — Baseline tests and build

PROMPT
```
Status update: Run baseline tests/build to capture current state.

Actions:
1) Try: npm test || pnpm test || yarn test; if not found, run: npx jest --runInBand || npx jest
2) Attempt a build: npm run build || pnpm build || yarn build
3) Save summarized results to `TEST_COMPLETION_SUMMARY.md` footer (append).

Verification:
- Report number of passing/failing tests.
- Report if build succeeded.
```

---

## PHASE 1 — Eliminate duplicate source tree from build/test scope (no deletions)

Why: Avoid ambiguous imports and fragile builds (DRY/KISS).

DoD: `src/src/` excluded from tsconfig and tests; app builds and tests pass as before or better.

Substep 1.1 — Align TypeScript path mapping to canonical `src/`

PROMPT
```
Goal: Ensure alias `@/*` resolves only to `src/*`; exclude `src/src/*` from compilation.

Actions:
1) Open `src/tsconfig.json` or root `tsconfig.json`. Ensure:
   - `baseUrl` points to project root (or `src` if that’s the established convention).
   - `paths` has { "@/*": ["src/*"] } and does NOT include `src/src/*`.
2) If `next.config.mjs` has `experimental.tsconfigPaths`, ensure it resolves to canonical `src/`.
3) If needed, add an `exclude` array to tsconfig including `src/src/**`.

Verification:
- Run: npm run build || pnpm build || yarn build — should succeed.
```

Substep 1.2 — Scope Jest to canonical tree

PROMPT
```
Goal: Ensure tests do not import from `src/src/`.

Actions:
1) Open `src/jest.config.js` (or root config). Ensure test match patterns only cover `src/**` (not `src/src/**`).
2) If using `moduleNameMapper` for `@/(.*)`, map to `<rootDir>/src/$1`.
3) Run tests.

Commands:
- npm test || pnpm test || yarn test

Verification:
- No tests import from `src/src/`.
```

---

## PHASE 2 — PrismaClient singleton

Why: Prevent per-request client instantiation; reduce connection pressure.

DoD: A shared `lib/prisma.ts` with `globalThis` guard; all API routes/services import it; tests/build pass.

Substep 2.1 — Create `src/lib/prisma.ts`

PROMPT
```
Goal: Add Prisma singleton with `globalThis` guard.

Actions:
1) Create `src/lib/prisma.ts` per Next.js best practice (Node ESM/TS). Example shape:
   import { PrismaClient } from '@prisma/client';
   const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
   export const prisma = globalForPrisma.prisma ?? new PrismaClient();
   if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
2) Do not change env config yet.

Verification: Typecheck succeeds.
```

Substep 2.2 — Replace route-level `new PrismaClient()`

PROMPT
```
Goal: Use shared prisma in API routes/services.

Actions:
1) Find occurrences of `new PrismaClient()` in `src/app/api/**` and `src/lib/**`.
2) Replace with `import { prisma } from '@/lib/prisma';`.
3) Run tests.

Commands:
- npm test || pnpm test || yarn test

Verification:
- No `new PrismaClient()` remains outside `lib/prisma.ts`.
```

---

## PHASE 3 — Unified AI provider abstraction

Why: Single interface to toggle Gemini/OpenAI; reduce divergence.

DoD: `src/lib/aiClient.ts` with `generateTextJSON(prompt): Promise<string>`; API route and `NudgeGenerator` use it; provider selected via env.

Substep 3.1 — Introduce `src/lib/aiClient.ts`

PROMPT
```
Goal: Add provider-agnostic AI client.

Actions:
1) Create `src/lib/aiClient.ts` exporting an interface:
   - `generateTextJSON(prompt: string, options?: { timeoutMs?: number }): Promise<string>`
2) Internally switch on env `AI_PROVIDER` in { 'gemini', 'openai', 'mock' }.
3) Enforce a strict "return-only-JSON" prompt adapter and 10s timeout.

Verification: Unit test a small mock provider returning valid JSON string.
```

Substep 3.2 — Refactor consumers to use `aiClient`

PROMPT
```
Goal: Replace direct provider calls.

Actions:
1) Update `src/app/api/transit-insights/route.ts` to call `generateTextJSON`.
2) Update `src/lib/services/nudgeGenerator.ts` to call `generateTextJSON`.
3) Keep behavior identical otherwise; no prompt changes beyond return-only-JSON wrapper.
4) Run tests.

Verification: Tests pass; feature parity maintained.
```

---

## PHASE 4 — Schema validation + deterministic fallback

Why: LLMs can return malformed JSON; enforce contract and graceful fallback.

DoD: Zod schema validates AI output; on failure, use deterministic template; errors logged via `logger`.

Substep 4.1 — Add Zod schemas for insights

PROMPT
```
Goal: Validate AI insights JSON.

Actions:
1) Add `zod` to deps if missing.
2) Create `src/lib/schemas/transitInsights.ts` with Zod schema matching existing contract.
3) Export types inferred from schema.

Commands:
- npm i zod || pnpm add zod || yarn add zod

Verification: Typecheck ok.
```

Substep 4.2 — Wrap parsing with validation and fallback

PROMPT
```
Goal: Strict parse and fallback.

Actions:
1) In `transit-insights` API, parse AI JSON via Zod; on failure, log via `logger.apiEvent` and use a deterministic fallback template.
2) Gate with `DEMO_MODE=true` to prefer fallback unless AI returns valid JSON within 2–3s.
3) Add unit tests for: valid AI, invalid AI→fallback, demo mode forces fallback.
4) Run tests.

Verification: All new tests pass.
```

---

## PHASE 5 — Centralized config

Why: Reduce scattered `process.env.*`; enable safer toggles.

DoD: `src/lib/config.ts` centralizes env reads; routes/services import from it.

Substep 5.1 — Create `src/lib/config.ts`

PROMPT
```
Goal: Central config with asserts.

Actions:
1) Export functions/consts: `AI_PROVIDER`, `DEMO_MODE`, `USE_GEMINI` (deprecated), keys, URLs.
2) Provide safe defaults for demo; never expose server keys with `NEXT_PUBLIC_*` unless required.
3) Add small helpers like `assertRequired(name, value)`.

Verification: Typecheck ok.
```

Substep 5.2 — Replace ad-hoc env reads

PROMPT
```
Goal: Use `config` everywhere.

Actions:
1) Replace `process.env.*` reads in API routes/services with `config` imports.
2) Update `/api/test-env` to report key toggles via `config`.
3) Run tests.

Verification: Behavior unchanged; tests pass.
```

---

## PHASE 6 — ML service health endpoint

Why: Health checks improve demo reliability.

DoD: `/health` returns `{ status: 'ok', time: <iso> }` with HTTP 200.

Substep 6.1 — Implement `/health` in Flask app

PROMPT
```
Goal: Add JSON health response.

Actions:
1) In `model_service/app.py`, implement `@app.route('/health')` returning JSON payload and 200.
2) Start the service (e.g., `python app.py` or docker). Ensure port matches config.
3) Verify with: curl -s http://localhost:5001/health

Verification: Valid JSON with status ok.
```

---

## PHASE 7 — Time/locale normalization

Why: Consistent time display for demo.

DoD: Server outputs normalized to UTC or fixed demo TZ; client renders consistently.

Substep 7.1 — Normalize server-side time strings

PROMPT
```
Goal: Use UTC/fixed TZ.

Actions:
1) Audit `src/lib/services/timeContext.ts` and relevant API routes.
2) Replace `toLocaleTimeString()` with a util based on `convertToUTC.ts` or a fixed formatter.
3) Unit test formatting determinism.

Verification: Tests pass; snapshot stable.
```

---

## PHASE 8 — Logging centralization

Why: Consistent observability and demo debugging.

DoD: `logger` used instead of `console.*`; option to include request-scoped IDs.

Substep 8.1 — Replace `console.*` with `logger.*`

PROMPT
```
Goal: Centralize logging.

Actions:
1) Search `src/**` for `console.`; replace with `logger` methods.
2) Where feasible, include a simple correlation id per request (header or generated).
3) Run tests.

Verification: No stray `console.*` usages (except allowed in tests).
```

---

## PHASE 9 — One-click demo scripts and smoke

Why: Deterministic demo flow and easy recovery.

DoD: `demo:prep` script warms and verifies; smoke tests runnable quickly.

Substep 9.1 — Add `demo:prep` and smoke script

PROMPT
```
Goal: One-click demo preparation.

Actions:
1) In `package.json`, add scripts:
   - "demo:prep": runs `ts-node src/scripts/setupDemo.ts` (or `node`), calls `/api/test-env`, warms caches, and prints pass/fail summary.
   - "test:smoke": run only unit/integration suites (exclude E2E directories).
2) Ensure `start-app.sh` invokes `npm run demo:prep` and prints friendly status.
3) Run: npm run demo:prep && npm run test:smoke

Verification: Both scripts succeed locally.
```

---

## PHASE 10 — Temporary E2E handling for demo window

Why: Reduce live-demo flakiness.

DoD: Known flaky E2E tests are skipped or gated; CI unaffected unless desired.

Substep 10.1 — Mark flaky tests and gate E2E

PROMPT
```
Goal: Stabilize demo.

Actions:
1) Identify the 2 failing E2E tests; mark as `it.skip` with a TODO and link to issue.
2) Ensure `test:smoke` does not include E2E.
3) Document the temporary gating in `DEMO_CHECKLIST.md`.

Verification: `npm run test:smoke` green; E2E excluded in demo runs.
```

---

## PHASE 11 — Security preflight

Why: Prevent accidental key exposure and fail-fast on missing config.

DoD: Preflight at startup validates required server-side keys (or confirms demo fallbacks); no server keys are exposed with `NEXT_PUBLIC_*`.

Substep 11.1 — Add config preflight

PROMPT
```
Goal: Validate configuration on startup.

Actions:
1) In `src/lib/config.ts`, add `preflight()` to assert required envs or confirm demo fallbacks.
2) Call `preflight()` in server startup path (e.g., from key API routes during first request) and log a clear status.
3) Confirm AI keys are NOT exposed as `NEXT_PUBLIC_*`.

Verification: Startup logs show preflight OK; server does not crash in demo mode.
```

---

## Appendix — Quick commands reference

```
# Tests
npm test
pnpm test
yarn test

# Build
npm run build
pnpm build
yarn build

# ML health
curl -s http://localhost:5001/health | jq .

# Demo scripts
npm run demo:prep
npm run test:smoke
```

## Definition of Done (overall)

- All phases through PHASE 11 complete.
- Unit/integration tests green; build succeeds.
- One-click demo prep script and health checks pass consistently.
- Duplicate `src/src/` not used by compiler/tests (actual deletion can be a post-demo task).


