# Phase 0 — Stabilize & secure the baseline (execution prompt)

> **How to use:** once a human has signed off Phase 0 in
> [05-decisions-and-review.md](../05-decisions-and-review.md), paste this whole file into your coding agent.
> **Plan:** [04 §Phase 0](../04-implementation-plan.md#phase-0--stabilize--secure-the-baseline) ·
> **Fixes:** F-01, F-02, F-03, F-04, F-11 (stopgap), F-12, F-13 (partial), F-14, F-15 (port), F-16, F-21 (demo), F-22 (stopgap)

---

## Role and mode

You're a senior full-stack engineer executing a **pre-approved** plan in the Tryp Transit repo. Change only what
this prompt scopes. If a precondition fails, an instruction conflicts with the code, or a decision is missing,
**stop and ask**. Don't improvise. Keep behavior identical except for the fixes listed here.

## Preconditions (check them all before editing)

- [ ] `git status --short` is empty. The maintainer's pending edits to `CHANGELOG.md`, `CLEAN_SUMMARY.md`, and
      `REFACTORING_PLAN.md` are already committed.
- [ ] You're on a new branch from the latest `main`: `git switch -c feat/tda-phase-0-stabilize`.
- [ ] 05 sign-off records **D-13**: a human confirmed the leaked Gemini key is **revoked**, and the table records
      whether to rewrite history.
- [ ] 05 sign-off records **D-16**; the default is the Next 14.2.35 stopgap now and Next 16 in P0B.
- [ ] 05 sign-off records **D-4**, the provider and model IDs used by T8.
- [ ] Node ≥ 20 is available (`node -v`), and `cd src && npm ci` succeeds.

## Read first

`src/app/test/page.tsx`, `src/app/find-rides/page.tsx`, `src/app/page.tsx` (lines 30–160 and 480–500),
`src/app/api/transit-insights/route.ts`, `src/app/api/transit-insights-demo/route.ts`, `src/lib/api/*.ts`,
`src/__tests__/lib/convertToUTC.test.ts`, `src/package.json`, `.gitignore`, `model_service/app.py`,
`model_service/Dockerfile`, `SETUP.md`, `DEMO_CHECKLIST.md`, `start-app.sh`, `README.md`, `CONTEXT.md`.

## Scope

**In:** the tasks below. **Out:** any refactor of the insight logic (P1), any new data features (P2+), a Next
**major** upgrade (P0B), and UI redesign.

## Tasks

### T1. Health endpoint and `/test` page (F-04, F-01)
1. Create `src/app/api/health/route.ts` with `GET` returning
   `{ status: "ok", checks: { ridershipService: "up" | "down" }, configured: { llm: boolean, traffic: boolean } }`.
   Use `checkRidershipServiceHealth()` from `@/lib/api/ridership`. Only **booleans** for configuration: never
   values, lengths, or prefixes. Add `export const dynamic = "force-dynamic"`.
2. Rewrite `src/app/test/page.tsx` to call only `/api/health`, with typed state (no `any`, no implicit `any`).
   Remove every reference to `/api/test-env`, `/api/test-gemini`, and `/api/test-tomtom`.

### T2. Type-check and tests (F-01)
1. Add `src/types/next-image.d.ts` containing `/// <reference types="next/image-types/global" />`.
2. Add `"typecheck": "tsc --noEmit"` to `src/package.json` scripts.
3. In `src/__tests__/lib/convertToUTC.test.ts`, replace the `jest.spyOn(global, 'Date')` mocks (lines 51, 69) with
   `jest.useFakeTimers(); jest.setSystemTime(new Date(2025, 11, 5, 15, 0, 0));` and `afterEach(() => jest.useRealTimers())`.
   The assertions must stay the same.

### T3. Repair the "Find Rewards" flow (F-02)
In `src/app/find-rides/page.tsx`:
1. Replace `axios.post('/api/getTravelTime', …)` (line 76) with `POST /api/transit-insights`, sending exactly
   `{ departure, destination, timeToDestination }`. Drop `currentLocation`.
2. On a non-2xx response or an exception, set an error state, render it inline, and **don't** call
   `router.push('/routes')`. Navigate only on success.
3. Map the response into `setTravelData`, with `costSavings: Number(data.costSavingsPerTrip)` (NaN → null).

### T4. Fix the demo scenarios (F-03, F-21)
In `src/app/page.tsx`:
1. At lines 138–150, set departure and destination to existing keys from `src/app/data/busStopCoordinates.ts`:
   - rush-hour: departure `King Street / Morris Street`, destination `Spring Street / Ashley Avenue`
   - weekend: departure `Market Street / Meeting Street`, destination `Folly Beach / Center Street`
   - night-out: departure `King Street / Wentworth Street`, destination `Calhoun Street / King Street`

   Confirm each key exists before using it.
2. In `handleSubmit`, skip the coordinate lookup and validation when `demoMode` is set. Clear `loadingInterval`
   on **every** early return.

In `src/app/api/transit-insights-demo/route.ts` (lines 22, 45, 68), return `costSavingsPerTrip` without a `$`
(`"4.25"`, `"2.75"`, `"3.50"`) to match the live contract, because the UI prepends `$`.

### T5. Repository hygiene (F-14, F-15)
1. `.gitignore`: delete the global `*.csv`, `*.json`, and `*.parquet` rules (lines 42–44) and `public` (line 100).
   Add targeted rules: `data_agent/raw/`, `data_agent/inbox/`, `data_agent/.cache/`, `*.local.json`, `*.local.yaml`.
   Keep every `.env*` rule.
2. Untrack the artifacts while keeping them on disk:
   `git rm -r --cached model_service/.env model_service/__pycache__ .DS_Store model_service/.DS_Store`.
3. Create `model_service/.dockerignore` containing `venv/`, `__pycache__/`, `*.pyc`, `.env`, and `.DS_Store`.
4. `model_service/Dockerfile`: set `EXPOSE 5001` and
   `CMD ["gunicorn", "-b", "0.0.0.0:5001", "--timeout", "120", "app:app"]`. The base-image bump belongs to P6.

### T6. Secret redaction and scanning (F-12)
1. In `REFACTORING_PLAN.md`, replace the literal key string in the Phase 1.1 code sample with
   `'<REDACTED: revoked key>'`. **Never print the key** in output, commits, or the PR.
2. Add a CI secret-scan job that scans the **PR diff** (gitleaks or TruffleHog OSS). Put any history-only
   allowlist in the tool's config file, with a comment that references D-13.
3. If D-13 says "rewrite history", **stop**. A human must coordinate that separately; this prompt doesn't do it.

### T7. Security quick wins (F-13, F-22 stopgap)
1. `model_service/app.py:83`: read `debug`, `host`, and `port` from env: `FLASK_DEBUG` (default `false`),
   `API_HOST` (default `127.0.0.1`), and `API_PORT` (default `5001`).
2. `model_service/app.py:54,77` and `src/app/api/transit-insights/route.ts:212`: return generic error messages and
   log the details server-side. Keep the status codes.
3. `src/lib/api/tomtom.ts:8`: read `process.env.TOMTOM_API_KEY ?? process.env.NEXT_PUBLIC_TOMTOM_API_KEY`. Warn
   once if the legacy name is used, and update the error messages. Update `src/.env.example`.
4. `cd src && npm i next@14.2.35 eslint-config-next@14.2.35`. That's the final 14.x release; P0B moves to 16.

### T8. LLM model-ID stopgap (F-11) ⏰ `gpt-3.5-turbo` shuts down on 2026-10-23
1. `src/lib/api/gemini.ts:32`: `model: process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL`.
2. `src/lib/api/openai.ts:27,47`: default the parameter from `process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL`.
3. Set the defaults to the IDs recorded in 05 §Research: `gemini-3.8-flash` and `gpt-5.6-terra`, as verified on
   2026-09-24. **Re-check both providers' model pages before committing**, and record the check in the PR.
4. Add `GEMINI_MODEL=` and `OPENAI_MODEL=` to `src/.env.example`.
5. If the legacy `@google/generative-ai` SDK rejects the new Gemini model, **stop and ask**. The fix would be
   pulling the P1 `@google/genai` migration of `gemini.ts` forward.

### T9. CI (F-16)
Create `.github/workflows/ci.yml` that runs on `pull_request` and on `push` to `main`, with
`permissions: contents: read`.
- **web** job: Node 22, npm cache keyed on `src/package-lock.json`, `working-directory: src`. Run `npm ci`,
  `npm run lint`, `npm run typecheck`, `npm test -- --ci`, and `npm run build` with `NEXT_TELEMETRY_DISABLED=1`.
- **python** job: Python 3.11, `python -m py_compile model_service/*.py`.
- **secrets** job: from T6.

### T10. Docs
- Point `SETUP.md` lines 27 and 76 and `start-app.sh:156` at the health-based `/test` page.
- `DEMO_CHECKLIST.md:21`: `curl http://localhost:3000/api/health`.
- `README.md` and `CONTEXT.md`: the renamed env var, the model env vars, and the `typecheck` script.
- `CHANGELOG.md`: add **[0.2.2]** (Stabilization) listing T1–T9.

## Constraints

- No new runtime dependencies beyond the Next patch bump.
- Don't touch `data_agent/`, the P1 files, or the UI styling.
- Don't log, echo, or commit secrets. Don't read `src/.env.local` values.
- Keep the diff reviewable, with one logical commit per task (T1…T10), then squash-merge.

## Verification (paste the output into the PR)

```bash
cd src && npm ci && npm run lint && npm run typecheck && npm test -- --ci && NEXT_TELEMETRY_DISABLED=1 npm run build
cd .. && git ls-files | grep -cE '__pycache__|\.DS_Store|model_service/\.env$'   # expect 0
git grep -nE 'AIza[0-9A-Za-z_-]{20,}' ; echo "exit=$?"                              # expect exit=1 (no matches)
grep -n "debug=True" model_service/app.py ; echo "exit=$?"                          # expect exit=1
python3 -m py_compile model_service/*.py && echo py-ok
```

Manual (run `npm run dev` in `src/`):
- [ ] All three demo buttons render results, and "You Save" shows a single `$`.
- [ ] `/test` shows health JSON, and `/api/health` exposes no secrets.
- [ ] `/find-rides`: a failure shows an inline error; a success reaches `/routes` with values. (Set
      `localStorage.currentUser` to pass demo auth.)
- [ ] (Human, with keys) `POST /api/transit-insights` returns 200 for each configured provider.

## Definition of done

- [ ] Every verification command matches its expected output, and CI is green.
- [ ] Findings F-01, F-02, F-03, F-04, F-12, F-14, and F-21 are closed. F-11, F-13, F-15, and F-22 are
      partially closed, as noted.
- [ ] The PR description lists what changed, the verification output, and the D-13 and D-16 outcomes.

## Rollback

Revert the squash-merge commit. The env rename keeps the fallback read, so nothing breaks if only part of it is
reverted.

## Handoff

- In [../README.md](../README.md), set P0 to **Done**, with the PR link.
- Note follow-ups for P0B, such as lint warnings to revisit after the upgrade.
