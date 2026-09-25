# Phase 0B — Framework upgrade: Next.js 16.x, React 19, Node 22 (execution prompt)

> **How to use:** once P0 is merged and Phase 0B is signed off in [05](../05-decisions-and-review.md), paste this
> whole file into your coding agent.
> **Plan:** [04 → Stabilize](../04-implementation-plan.md#stabilize) ·
> **Fixes:** F-22 · **Why now:** Next 14 has been EOL since 2025-10-26, and three 2026 high-severity Server
> Components DoS CVEs have **no 14.x fix**. Next 15 support ends 2026-10-21. (Source: 05 §Research.)

---

## Role and mode

You're a senior frontend engineer doing a **behavior-neutral** framework upgrade. Ship no features and no
refactors. The only changes allowed are the ones the upgrade requires. If a change would alter behavior,
**stop and ask**.

## Preconditions

- [ ] P0 is merged, CI on `main` is green (it runs on Next 14.2.35), and you're on
      `feat/tda-phase-0b-next16` from the latest `main`.
- [ ] Node ≥ 20.9 locally (`node -v`). CI uses Node 22 LTS.
- [ ] 05 sign-off records **D-16**; the default is Next 16.x (Active LTS).

## Facts this prompt relies on (re-check the official guide at execution time)

| Topic | Fact (verified 2026-09-24) |
|-------|----------------------------|
| Minimums | Node **≥ 20.9**, TypeScript **≥ 5.1** (the repo has TS 5.8.3) |
| Codemod | `npx @next/codemod@canary upgrade latest`, then `npx @next/codemod@canary next-async-request-api .` |
| React | 19.x is required. `@types/react` and `@types/react-dom` go to ^19. |
| Lint | **`next lint` is removed.** Use the ESLint CLI with a flat config (`eslint.config.mjs`) from `eslint-config-next`, which needs **ESLint ≥ 9**. `next build` no longer runs lint. |
| Bundler | Turbopack is the default for dev and build. The repo has **no custom webpack config** (`next.config.mjs` is empty). |
| Caching | `GET` route handlers and `fetch` are **not cached by default** (since v15). This repo's routes are `POST`, plus P0's `GET /api/health`, which is already `force-dynamic`. |
| Async APIs | `params`, `searchParams`, `cookies()`, and `headers()` are async-only in v16. The repo uses none of them today; confirm with grep. |
| `next/image` | New defaults: `qualities: [75]`, no `16` in `imageSizes`, `minimumCacheTTL` 4 h. The repo uses static imports only, with no `quality=` props. |
| Middleware | Renamed to `proxy.ts`. The repo has none, so no action. |
| Libraries | Radix select/label/slot and react-hook-form 7.x support React 19 within their current ranges. **`lucide-react` ^0.396 → ^1.x is required** for React 19 (used only in `components/ui/select.tsx`: `Check`, `ChevronDown`, `ChevronUp`). **`@hookform/resolvers` is optional**: 3.10 peers only on `react-hook-form: ^7.0.0` (verified on the npm registry), so it does not block React 19. Bump it only if `npm install` surfaces an actual peer conflict; otherwise leave it and note it as a follow-up. Keep zod at `^3.25`. |
| Tests | ts-jest 29 supports Jest 29 and 30, so no Jest bump is required. The repo has no `react-dom/test-utils` imports. |

## Tasks

1. **Baseline:** record `npm ls next react react-dom eslint lucide-react @hookform/resolvers` in the PR.
2. **Codemod:** in `src/`, run `npx @next/codemod@canary upgrade latest` and accept the upgrade to the latest 16.x.
   Then run `npx @next/codemod@canary next-async-request-api .`. Review every codemod edit, and revert any that
   aren't required.
3. **Dependencies:** make sure these are set in `src/package.json`:
   - `next@^16`, `react@^19`, `react-dom@^19`
   - `@types/react@^19`, `@types/react-dom@^19`
   - `eslint@^9` (or the latest version that `eslint-config-next` supports), `eslint-config-next@^16`
   - `@hookform/resolvers@^5.9`, `lucide-react@^1`
   - `"engines": { "node": ">=20.9" }`

   Then run `npm install` and commit the lockfile.
4. **Lint migration:**
   - Create `src/eslint.config.mjs` from `eslint-config-next`'s core-web-vitals flat config. Keep the same rule
     strength as `next/core-web-vitals` today.
   - Delete `src/.eslintrc.json`.
   - Set the `"lint"` script to `eslint .`, with ignores for `.next/`, `node_modules/`, and `coverage/`.
5. **Compile fixes:** fix only what the upgrade breaks: types, React 19 deprecations, and any lucide icon renames.
   Confirm the three icons still exist under the same names in lucide 1.x.
6. **Config:** leave `next.config.mjs` empty unless the build requires otherwise. Confirm `next/font/google`
   (Poppins) and the static `next/image` imports still work.
7. **CI:** confirm `.github/workflows/ci.yml` uses Node 22 and runs `npm run lint` as its own step, since
   `next build` doesn't lint anymore.
8. **Docs:** update the Node and lint instructions in `README.md`, `SETUP.md`, and `CONTEXT.md`. Add a
   `CHANGELOG.md` entry **[0.2.3]** (framework upgrade).

## Constraints

- No feature, refactor, or styling changes. Keep the diff to the upgrade.
- Don't upgrade zod to 4, Jest to 30, or Tailwind to 4 in this PR. Note them as follow-ups.
- Don't add middleware or proxy files.

## Verification (paste the output into the PR)

```bash
cd src && npm ci && npm run lint && npm run typecheck && npm test -- --ci && NEXT_TELEMETRY_DISABLED=1 npm run build
npm ls next react react-dom | head -5
npm audit --omit=dev --audit-level=high ; echo "audit exit=$?"   # expect no high/critical findings for next
grep -rnE "cookies\(\)|headers\(\)|searchParams|params\." app --include=*.ts --include=*.tsx || echo "no request APIs"
```

Manual smoke test (`npm run dev`):
- [ ] `/` works, and all three demo scenarios render.
- [ ] `/find-rides` → `/routes` (with demo auth) works.
- [ ] `/register` form validation works. This exercises `@hookform/resolvers` 5.
- [ ] The select dropdown icons render in `find-rides`. This exercises lucide 1.x.
- [ ] `/dashboard`, `/emissions-stats`, `/safety-cost-comparison`, `/incentives`, `/test`, and the 404 page render.
- [ ] The browser console shows no hydration errors.

## Definition of done

- [ ] CI is green on Node 22, and `next` is on 16.x.
- [ ] The smoke checklist passes, with screenshots attached for `/`, one demo result, and `/register`.
- [ ] Follow-ups are listed (zod 4, Jest 30, Tailwind 4) but not done.

## Rollback

Revert the PR, which returns to Next 14.2.35 from P0. Keeping the PR upgrade-only is what keeps this safe.

## Handoff

In [../README.md](../README.md), set P0B to Done. P1 can start. P1 also needs Node ≥ 20 for `@google/genai`.
