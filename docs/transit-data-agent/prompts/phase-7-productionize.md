# Phase 7 — Productionize, measure impact, clean up (execution prompt)

> **How to use:** once P4b, P5, and P6 are merged and Phase 7 is signed off in [05](../05-decisions-and-review.md),
> paste this whole file into your coding agent. Split it into PRs **7a** (hardening), **7b** (impact measurement),
> **7c** (ops), and **7d** (cleanup and docs).
> **Plan:** [04 §Phase 7](../04-implementation-plan.md#phase-7--productionize-measure-impact-clean-up) ·
> **Fixes:** F-13 (the rest), F-18, F-20, and the duplicated trip flows

---

## Role and mode

You're a senior platform engineer making the system safe to run in public and **measurable**: does it actually
shift trips to transit? Privacy comes first. **Stop and ask** if a decision (D-8, D-9, D-14, D-20) is missing.

## Preconditions

- [ ] P4b, P5, and P6 are merged (or D-10 = retire, with `model_service` removed), and CI is green.
- [ ] 05 sign-off records **D-8** (admin UI: yes or no), **D-9** (hosting target), **D-14** (budgets), **D-20**
      (outreach owner), and **D-23** (the privacy-review owner and the approved event schema).

## 7a — Hardening
1. **Rate limiting** on `POST /api/transit-insights` and the other LLM or TomTom-backed routes: a per-IP token
   bucket, in-memory for a single instance, or a shared store if D-9 is multi-instance. Add a body-size limit and
   return `429` with `Retry-After`.
2. **Auth:** Auth.js for admin users only; the public trip planner stays anonymous. Replace the `localStorage` demo
   auth (`register/page.tsx:45-55`) with Auth.js, or remove it if the rewards flow gets merged (7d).
3. **Admin review UI** (only if D-8 = UI): `/admin/review` lists, shows, approves, and rejects items. It calls
   data-agent admin endpoints (`/v1/admin/review/*`) that require a service token **and** the admin identity.
   Everything is audited in `review_item`.
4. **Security headers:** CSP, frame-ancestors, and referrer-policy. Alert and document text is rendered only as
   plain text (no `dangerouslySetInnerHTML`).
5. Run the dependency and security checklist in 05, and record the result.

## 7b — Impact measurement (privacy-preserving)
1. **Events:** `nudge_shown`, `cta_carta_fares_click`, `trip_planned`, and `demo_vs_live`.
   - Fields: event type, timestamp truncated to the hour, route or corridor ID, incentive variant, and `demo`
     flag. **No IP, no user ID, no precise location**.
   - Send them to a data-agent `POST /v1/events` endpoint, with a server-side rate limit and an aggregates-only
     schema.
2. **Reporting:** the weekly report gains a funnel section (shown → clicked, by corridor and variant).
   Suppress cells with fewer than **k = 10** events.
3. **Incentive experiments:** random per-session assignment across policy variants (no persistence beyond the
   session). Each experiment is a `campaign` review item that a human approves before it goes live. Results are
   read only at the end of the experiment, with a pre-registered success metric.
4. **Privacy review:** document the data flows in `docs/transit-data-agent/privacy.md`, and have the named owner
   sign it off in 05.

## 7c — Ops
1. **Hosting per D-9:** compose on a VM with systemd, or a managed container platform. Secrets come from the
   platform's secret store.
2. **Scheduling:** the worker runs in production. Stale sources trigger a freshness alert (email or Slack) after
   2 missed cadences.
3. **Backups:** a nightly `pg_dump` with 14-day retention, plus a documented, tested restore.
4. **Dependency updates:** Dependabot or Renovate for npm, uv/pip, Docker, and GitHub Actions, batched monthly.
   Add a calendar reminder to check the LLM deprecation pages (R-15).
5. **Observability:** structured logs shipped to the chosen sink. A dashboard shows request latency p95, LLM cost
   per day, TomTom calls per day against the quota, fetch success rate, and freshness.

## 7d — Cleanup and docs
1. **Merge the trip flows:** fold `/find-rides` → `/routes` into `/`, and keep redirects from the old URLs. Remove
   the duplicated `TravelContext` flow if nothing else uses it.
2. **Remove** `INSIGHTS_ENGINE=legacy` and the legacy path.
3. **Docs refresh:**
   - `README.md`: remove the "COMPLETE" and "Real-time" claims, and describe the architecture as it now stands.
   - Update `CONTEXT.md`, `SETUP.md`, and `DEMO_CHECKLIST.md`.
   - Move `changes.md` to `docs/archive/`.
   - Add a `CHANGELOG.md` entry for **[0.3.0]**.
4. **E2E:** a Playwright smoke test in CI covering the home page, one demo scenario, and a live request with mocked
   upstreams. Upload screenshots as artifacts.

## Verification (paste the output into each PR)

```bash
(cd src && npm ci && npm run lint && npm run typecheck && npm test -- --ci && npm run build && npx playwright test)
(cd data_agent && uv run ruff check . && uv run pytest -q)
# Rate limit smoke: expect some 429s
for i in $(seq 1 30); do curl -s -o /dev/null -w '%{http_code} ' -X POST localhost:3000/api/transit-insights -H 'content-type: application/json' -d '{}'; done; echo
# Light load (p95 budget from 02 §10): autocannon or k6 against a staging URL, results attached
```

## Definition of done

- [ ] The security checklist in 05 is signed off, and the privacy doc is signed off.
- [ ] The weekly report shows the funnel metrics, and the first experiment has been approved through the queue.
- [ ] Backup and restore have been tested, and the freshness alert has been tested by disabling a source.
- [ ] The docs no longer claim anything the system doesn't do.

## Rollback

Each sub-PR reverts independently. Rate limits are configurable, and setting them to `0` disables them.

## Handoff

In [../README.md](../README.md), set P7 to Done. Open the backlog for multi-region support (D-1) and the partner
data asks (03 §6).
