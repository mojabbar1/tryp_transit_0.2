# Phase 4 — Metrics, facts, read API, app integration (execution prompt)

> **How to use:** PR **4a** (data agent metrics and API) needs the P3 connectors 3.1, 3.2, and 3.5. PR **4b** (web
> integration) also needs P1 and the demo-stop mapping in 05 §2b. Once the matching rows are signed off in
> [05](../05-decisions-and-review.md), paste this whole file into your coding agent.
> **Plan:** [04 → Pilot](../04-implementation-plan.md#pilot) ·
> **Design:** [02 §8](../02-target-architecture.md#8-integration-with-the-existing-app) · **Fixes:** F-05 (fully), F-06, F-08

---

## Role and mode

You're a senior full-stack and data engineer replacing every **unavailable or invented** number in the app with
**schedule-based or approved-fact** numbers, with citations. Schedule-based transit is `basis: "scheduled"` (not an
`estimated` boolean). The data agent owns the facts and the transit schedule logic. The web app composes
per-request answers, using live TomTom for the drive side. **Stop and ask** if a stop mapping, a fact, or a
decision is missing.

## Preconditions

- [ ] **4a:** P3 connectors 3.1 (GTFS), 3.2 (NTD), and 3.5 (reference facts) are merged, with the reference facts
      **approved** by a human (`tda review list --kind fact --status approved`).
- [ ] **4b:** P1 and P4a are merged, and the **demo-stop mapping table in 05 §2b** is signed.
- [ ] 05 sign-off records **D-6** (direct-route lookup first) and **D-17** (demo-mode handling).
- [ ] Branches: `feat/tda-phase-4a-metrics-api`, then `feat/tda-phase-4b-web-integration`.

## PR 4a — Data agent metrics and read API

### Tasks
1. **`tda/metrics/service.py`:** active `service_id`s for a local date (calendar plus calendar_dates exceptions),
   and headways by route, direction, and time band. Bands: AM 06–09, Mid 09–15, PM 15–19, Eve 19–24, Night.
   Write `metric_value` rows as `route.headway_min.<band>.<daytype>`.
2. **`tda/metrics/compare.py`:** direct-route stop-pair lookup (D-6) with **boardability rules** (REV-06).
   - **Inputs:** `origin_stop_id`, `dest_stop_id`, `date`, and either `arrive_by` or `depart_at` (local `HH:MM`),
     plus the access-buffer minutes (05 assumption `transit.access_buffer_min`).
   - **Logic:** find trips that serve the origin before the destination (by `stop_sequence`) on an active service.
     A trip is **boardable** only when its origin departure ≥ `now + access_buffer` (you can't catch a bus that has
     already left), its origin `pickup_type` and destination `drop_off_type` allow it, and — for early times —
     previous-service-day trips that run past midnight are considered. For `arrive_by`, choose the latest boardable
     arrival ≤ the target; for `depart_at`, the earliest boardable departure ≥ the target. Handle times ≥ 24:00.
     Also return the next 3 boardable alternatives.
   - **Output:** in-vehicle minutes, `leave_by` or `wait_min`, route short name, trip IDs, and
     **`basis: "scheduled"`**. When no boardable direct trip exists, return a reason: `no_boardable_trip`,
     `transfer_required`, `no_service`, or `unknown_stop`.
3. **`tda/metrics/volume.py`:** hourly **traffic-volume** profiles (median by hour and day type over the last N
   weeks) from `traffic_count_hourly` — this is vehicle count, not a congestion index. Corridor mapping uses the
   stations within X m of the corridor probe points, and only the corridors a human completed in
   `regions/charleston.yaml`.
4. **`tda/metrics/ridership.py`:** the monthly UPT series, the rolling 12-month total, and year-over-year change.
   Facts are promoted by rule.
5. **`tda/metrics/emissions.py`** (optional): the CARTA-derived bus CO2 per passenger-mile (S-14b), **only if** the
   NTD annual energy and passenger-mile datasets are confirmed. Otherwise leave it unimplemented, with a TODO that
   references the catalog.
6. **API (read-only, `tda_reader` role).** Build **only the endpoints whose backing connector is merged** — an
   endpoint whose data source doesn't exist yet is not shipped as an empty stub:
   - `GET /v1/stops?query=&limit=` and `GET /v1/stops/nearest?lat=&lng=&limit=` (active feed; id, name, lat, lng,
     `route_short_names`) — needs 3.1
   - `GET /v1/compare?...` (the task 2 contract) — needs 3.1
   - `GET /v1/assumptions`: the **approved** facts the web cost and CO2 model needs, with IDs and attribution —
     needs 3.5
   - `GET /v1/stats`: curated headline stats (ridership trend, mode share, and — when present — a volume headline
     and an example CO2 per trip), each with `citations[]` — needs 3.2/3.3, other stats gated on their connectors
   - `GET /v1/alerts?route_id=`: active alerts, returned as plain-text fields — **only if 3.7 is merged**
   - `GET /v1/corridors` and `GET /v1/corridors/{id}/profile` (volume) — **only if 3.6 is merged**
   - Any table these endpoints read that isn't yet granted to `tda_reader` gets its grant in this PR's migration.
     Extend the reader-role integration test to cover it.

   **No `/v1/series/*` here.** The monthly-ridership and hourly-traffic series endpoints belong to **P6**, which
   builds them alongside the forecasting service that consumes them (they don't exist until forecasting does).
7. **`tda gtfs export-stops --format ts`:** add this command here (P4b consumes its output). It writes
   `src/app/data/stops.fallback.generated.ts` (id, name, lat, lng) from the active feed; the P4b PR commits the
   generated file.
8. **OpenAPI:** regenerate `contracts/data-agent.openapi.json`, and commit it.

### Tests
- Metrics on the fixture GTFS with **known answers**:
  - a direct trip (exact minutes)
  - `arrive_by` and `depart_at`
  - a calendar_dates removal
  - a trip after midnight (previous-service-day boardability)
  - a bus that already left → **`no_boardable_trip`** (not returned as boardable)
  - `transfer_required`
- API tests for every built endpoint. `/v1/assumptions` and `/v1/stats` must never include non-approved facts, and
  an endpoint whose connector isn't merged returns 404, not an empty 200.
- A performance smoke test: `/v1/compare` p95 under 300 ms on the fixture (run locally).

## PR 4b — Web integration

**Scope: `src/` only.** 4b touches no files under `data_agent/` (the `export-stops` command is P4a); it only
consumes the read API and the committed fallback file.

### Tasks
1. **Typed client:** `npm run gen:data-agent` runs from `src/`, which is the package root:
   `openapi-typescript ../contracts/data-agent.openapi.json -o lib/api/data-agent.types.ts`. CI regenerates the
   file and runs `git diff --exit-code lib/api/data-agent.types.ts`, which is the contract test.
   `lib/api/data-agent.ts` is a server-only client with 3 s timeouts.
2. **Request contract:** add optional `departureStopId` and `destinationStopId` to `TransitInsightRequest`. Keep the
   lat/lng fields. When only lat/lng arrive, map them to the nearest stops with `/v1/stops/nearest`.
3. **Insights (single v2 engine):** with `DATA_AGENT_ENABLED=true` and a healthy agent:
   - Transit comes from `/v1/compare`: `comparison.transit.basis = "scheduled"`, `travelTime` is the in-vehicle
     minutes plus the wait (or uses `leave_by`), and `additionalRides` holds the next boardable alternatives.
   - The cost and CO2 constants come from `/v1/assumptions` (cached for 1 h) instead of `assumptions.ts`. Keep
     `assumptions.ts` only as a flagged fallback.
   - Active alerts for the route go into the narration facts as **plain text only**. Don't let them drive
     instructions (injection-safe).

   Without the agent, keep the P1 behavior (`basis: "unavailable"`) plus `meta.degraded: ["data_agent.unavailable"]`.
4. **Routes:** `/api/stops` proxies `/v1/stops`, revalidating daily. When `DATA_AGENT_ENABLED=false` or the agent
   is unreachable, it serves `src/app/data/stops.fallback.generated.ts` instead (task 6). `/api/stats` proxies
   `/v1/stats`, revalidating every hour.
5. **UI:**
   - The stop pickers on `/` and `/find-rides` become a searchable combobox, using the shadcn Popover + Command
     pattern (this adds `cmdk` and `@radix-ui/react-popover`), fed by `/api/stops`.
   - A `src/components/citations.tsx` footnote renders `meta.citations` or fact citations, with `attribution_text`.
   - `/dashboard` uses `/api/stats` unless `NEXT_PUBLIC_DEMO_MODE=true`. The demo mode shows a visible "Demo data"
     badge (D-17).
   - `/emissions-stats` and `/safety-cost-comparison` render approved facts with citations. The inconsistent
     hard-coded table goes away, which fixes "2.680 grams". **If a page has no approved facts** (for example, the
     safety facts before S-18 or reference facts exist), it shows a "data unavailable" state, and every uncited
     number is removed. Never keep an uncited number.
   - `/routes` takes incentive values from the P1 policy (rendered only when an offer is active, D-25), not the
     hard-coded tiers at `routes/page.tsx:26-40`.
   - The demo scenarios use the GTFS stop IDs from **05 §2b**. The weekend scenario maps to **Isle of Palms /
     14th Ave** (~342 m from a real CARTA stop), since Folly Beach and Sullivan's Island have no nearby service.
     Add `src/app/data/demo-stops.ts` for offline demo mode.
6. **Stops fallback, then retire** (the `export-stops` command ships in P4a):
   1. Run `tda gtfs export-stops --format ts` (P4a) to write `src/app/data/stops.fallback.generated.ts`
      (id, name, lat, lng) from the active feed. Commit the output, and note that it needs regenerating on each
      feed change.
   2. Only after the fallback works, **and** the rollback test (below) passes, remove `src/app/data/busStops.ts`
      and `busStopCoordinates.ts`.
   3. Replace `__tests__/data/busStops.test.ts` with tests for `demo-stops.ts`, the fallback file, and the stops
      client.

### Tests
- Route tests: agent healthy (`basis: "scheduled"`, real boardable alternatives), agent down (degraded fallback),
  lat/lng-only →
  nearest-stop mapping, alert text containing instructions (must be treated as data, and the validator still
  applies).
- **Rollback test:** with the data-agent client mocked as unreachable, or `DATA_AGENT_ENABLED=false`, `/api/stops`
  serves the fallback file, and `/api/transit-insights` returns a 200 degraded response built from the fallback
  coordinates.
- Unit tests for the citations component logic, if there's any non-trivial formatting.

## Constraints

- Every number on a page is an approved fact or a deterministic computation from them, and it has a visible
  citation. The **only** exception is demo mode with its badge.
- The web app never talks to Postgres directly, only to the read API.
- Keep the legacy response fields. New fields are optional.

## Verification (paste the output into the PR)

```bash
# 4a (from the repo root)
(cd data_agent && uv run ruff check . && uv run pytest -q && uv run tda api openapi) && git diff --exit-code contracts/
docker compose up -d --build postgres data-agent-api && (cd data_agent && uv run tda db bootstrap && uv run alembic upgrade head) && sleep 3
curl -s "localhost:8081/v1/compare?origin_stop_id=<A>&dest_stop_id=<B>&date=$(date +%F)&arrive_by=08:30" \
  | jq -e '.transit.basis=="scheduled" and (.alternatives|length)>=0'
# 4b (from the repo root)
(cd src && npm run gen:data-agent && git diff --exit-code lib/api/data-agent.types.ts && npm run lint && npm run typecheck && npm test -- --ci && npm run build)
```

Manual checklist (a human, with a live GTFS feed loaded):
- [ ] A known direct-route pair shows schedule-based minutes (`basis: "scheduled"`), a "leave by" time, and 3
      boardable alternatives — and never a bus that has already left.
- [ ] A pair that needs a transfer or has no boardable trip shows the reason text, not a fake number.
- [ ] Every number on the dashboard, emissions, and safety pages has a citation. Pages without approved facts show
      "data unavailable".
- [ ] Demo mode shows its badge and the demo numbers; the weekend scenario resolves to Isle of Palms.
- [ ] With `data-agent-api` stopped, stops still load from the fallback, and trip results are degraded but work.

## Definition of done

- [ ] Both PRs are green, including the contract diff checks and the rollback test.
- [ ] `grep -rn "busStopCoordinates\|busStops\b" src --include=*.ts*` returns nothing but migration notes.
- [ ] `grep -n "2.680" src/app/emissions-stats/page.tsx` returns nothing, and no page renders an uncited number.
- [ ] Screenshots of `/`, `/dashboard`, and `/emissions-stats` are in the PR.

## Rollback

`DATA_AGENT_ENABLED=false` gives the P1 behavior, with stops served from the fallback file. `NEXT_PUBLIC_DEMO_MODE=true`
gives the demo dashboard. If needed, revert 4b first, then 4a.

## Handoff

- In [../README.md](../README.md), set P4a and P4b to Done. **This is the G1 pilot gate** (see 05): the app now
  shows only honest, cited numbers.
- P5 can use the `/v1/*` tools. P6 (expansion) will **add** its own `/v1/series/*` endpoints.
- For each page left in "data unavailable", list the facts it needs as P3.9 or reference-fact follow-ups.
