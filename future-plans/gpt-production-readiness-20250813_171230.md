## Production Readiness Plan: Security, Authentication, Authorization, and MVP Alignment

Timestamp: 2025-08-13 17:12:30

### Executive summary
- **Critical blockers**: Client-only auth using `localStorage`, API routes trust client-supplied `userId`, no server-side session management, no authorization checks, possible exposure of server keys via `NEXT_PUBLIC_*`, inconsistent input validation, missing rate limiting/CSRF/CORS hardening, and logging of sensitive data.
- **High-impact fixes**: Introduce server-side auth (Auth.js/NextAuth or managed auth), replace client `userId` with session identity, add RBAC checks on API routes, secure secrets and headers, implement rate limits and validation, and remove sensitive data from logs.
- **MVP alignment**: Keep login simple (magic link or OAuth), measure the core reward funnel, defer nice-to-have features.

---

### 1) Authentication: replace client `localStorage` auth with server sessions

1. Why it’s happening
- Registration at `src/app/register/page.tsx` writes hashed passwords to `localStorage`, sets `currentUser` in the browser, and toggles a boolean `isLoggedIn` via `src/contexts/auth-context-provider.tsx`.
- There is no backend password verification or session; any script can set `localStorage.currentUser` to impersonate.

2. What’s happening in the code
- Client-side only: `localStorage.setItem('currentUser', JSON.stringify(newUser))` and context `isLoggedIn` flag.
- Prisma has `UserProfile` but no auth user table; APIs accept `userId` from request body/params and trust it.

3. How to fix (step-by-step)
- Choose an auth strategy optimized for speed:
  - Option A (recommended for MVP): Auth.js (NextAuth) with magic link (email) or OAuth (Google/Apple). Stores session in HTTP-only cookies; minimal UX friction.
  - Option B: Password auth (Argon2id/bcrypt) with email verification and reset flows.
- Implement server session:
  - Add `User`, `Session`, `Account`, `VerificationToken` tables via Auth.js Prisma adapter.
  - Replace all client `userId` usage with `session.user.id` on the server.
  - Remove `localStorage` user management; keep only derived UI state from session.
- Secure cookies: `HttpOnly`, `Secure`, `SameSite=Lax` (or `Strict`), short access session with rotation.
- Add email verification for new accounts; throttle sign-in attempts.

4. Trade-offs
- Auth.js + magic link reduces password management work but depends on email deliverability.
- OAuth speeds onboarding but adds dependency on identity providers and their review processes.

---

### 2) Authorization: stop trusting client-supplied `userId`; enforce RBAC on server

1. Why it’s happening
- Endpoints like `src/app/api/complete-trip/route.ts` and rewards routes accept `userId` in body/params and use it directly. Any client can spoof another user.

2. What’s happening in the code
- `userId` is passed from the client and drives reads/writes without server-side subject verification.

3. How to fix (step-by-step)
- Derive identity on server from the session only (`session.user.id`), ignore `userId` from client.
- Introduce middleware/guards for API routes to ensure authenticated requests.
- Define simple RBAC: `user`, `admin`. Gate admin-only operations (seeding, partner management).
- Add resource scoping checks so operations affect only the caller unless role is elevated.

4. Trade-offs
- Slight refactor breadth across API handlers and service layer; large security win.

---

### 3) Data model: add real `User`; link to profiles and progress

1. Why it’s happening
- `UserProfile` exists but no auth `User` entity. Progress tables reference `userId` not tied to an authenticated subject.

2. What’s happening in the code
- Prisma schema defines `UserProfile`, `UserRewardProgress`, `TripCompletion`, etc., keyed by `userId` string.

3. How to fix (step-by-step)
- Add `User` (Auth.js schema) and relate `UserProfile.userId -> User.id`.
- Migrate `UserRewardProgress.userId` and `TripCompletion.userId` to reference `User.id`.
- Backfill demo users by creating `User` rows for existing `UserProfile` emails.

4. Trade-offs
- Requires Prisma migration and seed updates; unlocks real auth and referential integrity.

---

### 4) Input validation, rate limiting, and abuse prevention

1. Why it’s happening
- Some validation exists, but coverage is inconsistent. No rate limiting present.

2. What’s happening in the code
- Zod schemas exist for some forms; endpoints have ad-hoc guards, lack comprehensive schemas and rate limits.

3. How to fix (step-by-step)
- Standardize request validation with Zod per route; reject unknown fields.
- Add rate limiting at the edge (e.g., Upstash Redis) for auth, AI, and TomTom-heavy endpoints.
- Add basic bot protections for auth flows (e.g., hCaptcha/reCAPTCHA where needed).

4. Trade-offs
- Minimal latency overhead; significant reduction in abuse risk.

---

### 5) Secrets, configuration, and external API keys

1. Why it’s happening
- `NEXT_PUBLIC_TOMTOM_API_KEY` is referenced on the server; `NEXT_PUBLIC_*` variables are exposed to the client bundle by convention.

2. What’s happening in the code
- Server calls reference `NEXT_PUBLIC_TOMTOM_API_KEY`.

3. How to fix (step-by-step)
- Use server-only env vars (`TOMTOM_API_KEY`) for server routes; remove `NEXT_PUBLIC_` from secrets.
- Validate required env at boot; fail fast in production.
- Store secrets in a secrets manager and not in `.env` for production.

4. Trade-offs
- Requires separating client-only vs server-only use. If client needs TomTom directly, proxy via server or use a restricted public key.

---

### 6) Logging and observability: remove sensitive data, add correlation

1. Why it’s happening
- Custom logger logs events; some events include redemption info and possibly PII.

2. What’s happening in the code
- Event logs may include `redemptionCodes`; general logger writes to console, with optional “beer analytics”.

3. How to fix (step-by-step)
- Never log secrets/PII (emails, tokens, redemption codes). Replace with opaque IDs.
- Add `requestId` correlation in API handlers and include timing/route metadata.
- Send structured logs to a provider (e.g., Datadog/Logtail); add error reporting (Sentry) with PII scrubbing.
- Configure log levels by env; disable verbose logs in prod.

4. Trade-offs
- Slightly reduced debugging fidelity; mitigated by correlation IDs and structured context.

---

### 7) Web security controls: CSRF, CORS, and headers

1. Why it’s happening
- With cookie sessions, CSRF becomes relevant. CORS and headers are not explicitly configured.

2. What’s happening in the code
- No CSRF tokens, permissive default headers, no explicit CORS policy.

3. How to fix (step-by-step)
- CSRF: Use same-site cookies and anti-CSRF tokens for state-changing routes if cookies are used.
- CORS: Restrict to known origins; block credentials for cross-origin unless necessary.
- Security headers: Add HSTS, CSP (restrict scripts, disallow inline), X-Content-Type-Options, X-Frame-Options, Referrer-Policy via Next.js headers config.

4. Trade-offs
- CSP can break inline scripts/styles; requires auditing and nonces or hashed assets.

---

### 8) Dependency and platform hygiene

- Pin Node and package versions; ensure lockfile is committed.
- Run audits and patch critical issues.
- Update Prisma, Next.js, React for security fixes.
- If serverless with Postgres, use a connection pooler or Prisma Accelerate.
- Configure environment separation (dev/staging/prod) and automated migrations.

---

### 9) Privacy, compliance, and product constraints

- Minimize PII: store only what you need for MVP. Avoid logging PII.
- Data retention policy: define deletion/retention for user data and analytics.
- Age gating for alcohol rewards if applicable; verify eligibility per region.
- Terms of Service and Privacy Policy presented at registration.

---

### 10) Monitoring, alerting, and SLOs

- Error tracking: Sentry with release tags and env separation.
- Health checks: expose app and model-service `/health`; integrate uptime monitoring.
- Metrics: request rate, error rate, latency; cost metrics for AI/TomTom.
- Dashboards: reward funnel conversion, trip completion, nudge performance.

---

### 11) MVP alignment to validate PMF

- Focus MVP on the core funnel:
  - User signs in (magic link/OAuth), completes trips, sees progress, earns a reward, redeems.
- Instrument the funnel:
  - Track: sign_up, sign_in, trip_complete, progress_updated, reward_earned, reward_redeemed.
  - Use server-side event ingestion with non-PII identifiers.
- De-scope until after validation:
  - Advanced AI messaging, complex partner discovery, multi-reward catalogs.
- Run A/B tests on copy and thresholds once initial data exists.

---

### 12) Phased adoption plan

- Phase 0 (1–2 days):
  - Introduce Auth.js with magic link or OAuth; add `User` and session tables.
  - Replace client `userId` with `session.user.id` in all API handlers.
  - Hide server secrets, add env validation, and remove sensitive logging.

- Phase 1 (2–4 days):
  - Implement RBAC checks and per-route validation schemas.
  - Add rate limiting for auth and heavy endpoints; restrict CORS; add security headers.
  - Update Prisma relations to link progress/trips to `User.id`; migration + backfill demo users.

- Phase 2 (3–5 days):
  - Add email verification and password reset (if using password auth).
  - Integrate Sentry and structured logs with request IDs.
  - Add dashboards for the core funnel and cost telemetry.

- Phase 3 (ongoing):
  - Privacy/age gating adjustments, dependency updates, infra hardening, and A/B experimentation.

---

### 13) Targeted code hotspots to address (by path)

- `src/app/register/page.tsx`: remove client-side credential storage; replace with server-driven auth flow.
- `src/contexts/auth-context-provider.tsx`: derive UI state from server session; remove `localStorage` coupling.
- `src/app/api/*/route.ts`: stop accepting `userId` from the client; require server session; add RBAC and validation.
- `src/prisma/schema.prisma`: add `User`, relate to `UserProfile`; re-key progress/trip models to `User.id`.
- `src/lib/logger.ts`: scrub PII/secrets and add request correlation; route logs to provider in production.
- `src/lib/config.ts`: strict env checks; no `NEXT_PUBLIC_*` for server secrets.

---

### Acceptance criteria (production readiness)

- All state-changing API routes require an authenticated session.
- `userId` is never accepted from the client to act on behalf of another user.
- Secrets are server-only and validated at boot; CSP/HSTS and other headers enforced.
- Rate limiting protects auth and external-API-heavy routes.
- Logs contain no PII/secrets and include request IDs; Sentry captures errors.
- MVP analytics track the reward funnel end-to-end.

---

### Next steps request (you pick what to run next)

- Choose auth mode: Auth.js with magic link vs OAuth vs password.
- Approve schema changes (add `User`, link to `UserProfile`, re-key progress/trips).
- Confirm hosting environment to set up secrets, rate limits, and logging provider.
