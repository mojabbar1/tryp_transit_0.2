## Cursor/AI Execution Prompts: Production Security, Auth, Authorization, and MVP Alignment

Timestamp: 2025-08-13 17:32:00

How to use
- Copy one PHASE prompt at a time into your AI coding tool (e.g., Cursor) and run it end-to-end before moving to the next phase.
- Each phase contains substeps. After each substep, run the verification commands provided. If anything fails, fix it before proceeding.
- Conventions: work from project root unless otherwise stated; for app commands use `cd src` first.

Global constraints (apply to all phases)
- Follow SOLID, DRY, KISS, YAGNI.
- Do not implement beyond the substeps in the current phase.
- Preserve existing indentation and code style; do not reformat unrelated code.
- Avoid logging PII/secrets. Add tests or update existing ones when feasible.

---

PHASE 0 — Repository health, environment, and safety net

Prompt
- Goal: Ensure the repo builds/tests cleanly, with clear environment requirements before changes.
- Substeps:
  1) Inspect package manager and scripts
     - Open `src/package.json` and list scripts used for build, test, lint.
     - If missing standard scripts, add minimally: `build`, `test`, `lint`, `typecheck` (only if TypeScript configs exist).
  2) Environment validation
     - Open `src/lib/config.ts`. If a central validation exists, add checks for required env keys (e.g., `GEMINI_API_KEY` if used, `TOMTOM_API_KEY` for server routes). Ensure no server route uses `NEXT_PUBLIC_*` secrets.
  3) Duplicate code scan
     - Detect duplicate directories like `src/src/*`. Create a simple report (no changes yet) listing any duplicate or shadowed paths that might cause confusion.
  4) Baseline run
     - From project root, run commands below. If any step fails, fix minimal issues to pass.
- Verification commands:
  - cd src && pnpm install || npm install
  - cd src && pnpm test || npm test
  - cd src && pnpm build || npm run build
  - cd src && pnpm exec tsc -v || echo "tsc not present"
- Definition of done:
  - Tests and build complete successfully or documented actionable failures with next steps.
  - Environment requirements captured or validated in `src/lib/config.ts`.

---

PHASE 1 — Introduce server sessions with Auth.js (NextAuth) and remove localStorage auth

Prompt
- Goal: Replace client-side `localStorage` auth with secure server sessions; keep MVP-friendly login (magic link or OAuth).
- Substeps:
  1) Dependencies
     - Add Auth.js (NextAuth) and Prisma adapter: `next-auth`, `@auth/prisma-adapter`.
     - If email provider is used, setup nodemailer or chosen provider envs; otherwise pick one OAuth provider you can configure locally.
  2) Prisma schema updates
     - In `src/prisma/schema.prisma`, add Auth.js models (`User`, `Account`, `Session`, `VerificationToken`).
     - Relate `UserProfile` to `User` via `userId`. Plan a migration that backfills `User` rows for existing `UserProfile.email`.
  3) Migrations
     - Generate and run Prisma migrations. Create a backfill script in `src/prisma/seed.ts` or a separate script to link profiles to users by email.
  4) Auth route and provider
     - Add `src/app/api/auth/[...nextauth]/route.ts` with Auth.js configuration.
     - Configure either Email (magic link) or OAuth provider(s) based on available env.
  5) Session consumption in UI
     - Add Auth provider at app root (e.g., `src/app/layout.tsx`) if not already present.
     - Update `src/contexts/auth-context-provider.tsx` to derive auth state from session rather than `localStorage`.
  6) Remove client `localStorage` auth
     - Update `src/app/register/page.tsx` and any login forms to use the new auth flow; remove writing credentials to `localStorage`.
- Verification commands:
  - cd src && pnpm prisma generate || npx prisma generate
  - cd src && pnpm exec prisma migrate dev --name auth-setup || npx prisma migrate dev --name auth-setup
  - cd src && pnpm test || npm test
  - cd src && pnpm build || npm run build
- Definition of done:
  - Server sessions working; UI reflects session state.
  - No code writes credentials to `localStorage`.

---

PHASE 2 — Authorization: stop trusting client-supplied userId; add RBAC

Prompt
- Goal: Derive identity from session on the server; implement minimal RBAC.
- Substeps:
  1) Server identity
     - In all API routes under `src/app/api/**/route.ts`, stop accepting `userId` from client. Use `getServerSession` (Auth.js) to extract `session.user.id`.
     - Update calls to services (e.g., `RewardManager`) to use `sessionUserId` from server only.
  2) RBAC minimal
     - Add a `role` field (e.g., on `User` or `UserProfile`) with enum: `user`, `admin`.
     - Gate any admin-only endpoints (e.g., partner management if present). If no admin endpoints today, add role checks scaffolding in a shared helper.
  3) Middleware guard
     - Add a simple middleware or helper that ensures session exists for state-changing routes and returns 401 otherwise.
- Verification commands:
  - cd src && pnpm test || npm test
  - cd src && pnpm build || npm run build
- Definition of done:
  - No API route uses client-provided `userId` to act on another user.
  - Role checks available and used where relevant.

---

PHASE 3 — Data model wiring for progress/trips to real user

Prompt
- Goal: Ensure all `userId` foreign keys reference the authenticated `User` and not arbitrary strings.
- Substeps:
  1) Prisma updates
     - Update `UserRewardProgress.userId` and `TripCompletion.userId` to reference `User.id`.
     - Adjust relations and regenerate Prisma client.
  2) Migration and backfill
     - Write a migration/backfill script to map existing progress/trips by `UserProfile.email` to the new `User.id`.
  3) Service layer
     - Update `RewardManager` and related services to accept `userId: string` that is always `User.id` from session.
- Verification commands:
  - cd src && pnpm exec prisma migrate dev --name rekey-to-user || npx prisma migrate dev --name rekey-to-user
  - cd src && pnpm test || npm test
  - cd src && pnpm build || npm run build
- Definition of done:
  - All progress/trips point to `User.id` with referential integrity.

---

PHASE 4 — Request validation and rate limiting

Prompt
- Goal: Standardize per-route validation and add rate limiting to sensitive endpoints.
- Substeps:
  1) Validation schemas
     - For each API route, define a Zod schema for request body/params. Reject unknown fields by default.
  2) Rate limiting
     - Add an edge-compatible rate limiter (e.g., Upstash Redis) for login, AI-backed, and TomTom-heavy endpoints.
     - Centralize limiter utility and apply it in handlers before expensive work.
- Verification commands:
  - cd src && pnpm test || npm test
  - cd src && pnpm build || npm run build
- Definition of done:
  - All routes validate input and critical routes are rate limited.

---

PHASE 5 — Secrets and configuration hygiene

Prompt
- Goal: Ensure server-only secrets are not exposed and validated at boot.
- Substeps:
  1) Replace `NEXT_PUBLIC_*` usage for server secrets
     - In server-only routes, replace `NEXT_PUBLIC_TOMTOM_API_KEY` with `TOMTOM_API_KEY`.
  2) Config validation
     - Enhance `src/lib/config.ts` to validate required envs for the active feature set; fail fast in production.
  3) Docs
     - Update `README.md` with required envs for local/staging/prod.
- Verification commands:
  - cd src && pnpm build || npm run build
- Definition of done:
  - No server code relies on `NEXT_PUBLIC_*` for secrets.

---

PHASE 6 — Logging, PII scrubbing, and correlation IDs

Prompt
- Goal: Improve observability while protecting user privacy.
- Substeps:
  1) PII scrubbing
     - Update `src/lib/logger.ts` to ensure emails, tokens, and redemption codes are never logged.
  2) Correlation IDs
     - In each API route, generate/propagate `requestId`; include it in all logs for that request.
  3) Error reporting
     - Integrate Sentry (or leave hooks in place) with PII scrubbing enabled and environment separation.
- Verification commands:
  - cd src && pnpm test || npm test
  - cd src && pnpm build || npm run build
- Definition of done:
  - Logs are structured, non-PII, and include `requestId`; error reporting connected or stubbed with TODO.

---

PHASE 7 — Security headers, CSRF, and CORS

Prompt
- Goal: Harden the web surface.
- Substeps:
  1) Security headers
     - In `src/next.config.mjs` or via middleware, add HSTS, CSP (no inline scripts), X-Content-Type-Options, X-Frame-Options, Referrer-Policy.
  2) CSRF
     - If using cookie-based sessions, add anti-CSRF tokens for state-changing routes or ensure SameSite+double-submit protection.
  3) CORS
     - Restrict origins to known domains; avoid `*` when credentials are involved.
- Verification commands:
  - cd src && pnpm build || npm run build
  - Manually verify headers via local requests (document sample curl commands).
- Definition of done:
  - Secure defaults applied; state-changing endpoints protected from CSRF.

---

PHASE 8 — MVP funnel analytics and product validation

Prompt
- Goal: Measure the critical reward funnel end-to-end.
- Substeps:
  1) Event taxonomy
     - Define and document events: `sign_up`, `sign_in`, `trip_complete`, `progress_updated`, `reward_earned`, `reward_redeemed`.
  2) Server-side event logging
     - Emit structured analytics events server-side (scrub PII; use user UUIDs).
  3) Dashboards
     - Add minimal dashboards or export dataset for analysis.
- Verification commands:
  - cd src && pnpm test || npm test
  - cd src && pnpm build || npm run build
- Definition of done:
  - Events emitted at critical points; basic analysis possible.

---

PHASE 9 — Cleanup and duplicates removal

Prompt
- Goal: Remove dead/duplicate code to reduce risk.
- Substeps:
  1) Identify duplicate trees like `src/src/*` vs `src/*`. Choose the canonical path (prefer `src/*`).
  2) Remove duplicates carefully; update imports; run the full test suite.
  3) Ensure CI/build scripts reference canonical paths only.
- Verification commands:
  - cd src && pnpm test || npm test
  - cd src && pnpm build || npm run build
- Definition of done:
  - No duplicate modules or ambiguous imports remain.

---

Appendix — Example terminal snippets (adjust per environment)
- Run tests: `cd src && pnpm test || npm test`
- Build: `cd src && pnpm build || npm run build`
- Prisma generate: `cd src && pnpm prisma generate || npx prisma generate`
- Prisma migrate: `cd src && pnpm exec prisma migrate dev --name <name> || npx prisma migrate dev --name <name>`
