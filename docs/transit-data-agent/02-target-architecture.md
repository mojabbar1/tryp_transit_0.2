# 02 — Target Architecture: Transit Intelligence Agent (TIA)

> Status: **proposal for review.** Choices marked **D-n** are open decisions with defaults; see
> [05-decisions-and-review.md](./05-decisions-and-review.md). Data sources are listed in
> [03-data-source-catalog.md](./03-data-source-catalog.md).

---

## 1. Goals and non-goals

**Goals**
1. Acquire public transit, traffic, and supporting data on a schedule, lawfully and politely, with full provenance.
2. Turn that data into **deterministic metrics** and **cited facts**. Examples: where and when transit is
   competitive with driving, congestion by corridor and hour, cost and CO2 savings, ridership trends.
3. Use an **LLM agent** only where it adds value: narrating facts (nudges), analyzing and summarizing (weekly
   opportunity reports), extracting facts from unstructured public documents, and proposing new sources.
4. Put **humans in the loop** for anything new or externally visible.
5. Feed the existing app: `/api/transit-insights`, the dashboard, and the stats pages. Don't break the current UX.

**Non-goals (for now)**
- Personal trip tracking, user location history, or any PII collection.
- Scraping sources whose terms forbid automated access (for example, the Google Maps or Waze consumer apps).
- Real-time multi-modal routing across agencies. A GTFS direct-route lookup comes first; OTP2 is optional (D-6).
- Replacing the Next.js UI or the Shadcn component library.

## 2. Architecture overview

```
                          ┌───────────────────────────── Public sources ─────────────────────────────┐
                          │ CARTA GTFS / GTFS-RT · NTD (Socrata) · Census ACS · SCDOT counts (ArcGIS) │
                          │ TomTom (flow/incidents/routing) · EIA · EPA/AAA refs · NWS · NOAA tides    │
                          │ Public HTML/PDF docs (CARTA/BCDCOG/City reports) — robots/ToS-gated        │
                          └───────────────┬───────────────────────────────────────────────┬──────────┘
                                          │ polite fetcher (robots, rate-limit, ETag, UA)  │
┌─────────────────────────────────────────▼───────────────────────────────────────────────▼──────────┐
│  data_agent/  (Python ≥3.12, uv)                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │ Source       │→ │ Connectors   │→ │ Raw landing   │→ │ Normalize +  │→ │ Metrics & Facts      │ │
│  │ registry     │  │ (determin-   │  │ (immutable    │  │ validate     │  │ (congestion, compare,│ │
│  │ sources.yaml │  │  istic)      │  │  snapshots)   │  │ (schemas)    │  │  cost, CO2, trends)  │ │
│  └──────────────┘  └──────────────┘  └───────────────┘  └──────────────┘  └──────────┬───────────┘ │
│         ▲                                                                           │             │
│         │ proposals (HITL)        ┌─────────────────────────────────────────────┐   │             │
│         └─────────────────────────┤ Agent runtime (provider-agnostic, D-3)       │◄──┘ read-only   │
│                                   │ Analyst · Narrator · Extractor · Scout       │     tools       │
│                                   │ guardrails: citations, numeric-claim check,  │                 │
│                                   │ injection isolation, budgets                 │──► review queue │
│                                   └─────────────────────────────────────────────┘      (HITL)     │
│  Read API (FastAPI): /v1/health /v1/facts /v1/stats /v1/stops /v1/compare /v1/corridors …          │
│  CLI (Typer): tda ingest|metrics|agent|review|publish        Scheduler worker (APScheduler, D-9)   │
└───────────────┬───────────────────────────────────────────────────────────────┬───────────────────┘
                │ SQL (least-privilege roles)                                   │ HTTP (typed client)
        ┌───────▼────────┐                                          ┌───────────▼──────────────────────┐
        │ Postgres 16    │                                          │ Next.js app (src/)               │
        │ (+PostGIS opt.)│                                          │ /api/transit-insights (orchestr.)│
        └────────────────┘                                          │ /api/stats, /api/health          │
        ┌────────────────┐   reads curated series                   │ lib/llm (narration, validated)   │
        │ model_service/ │◄──────────────────────────────────────── │ pages: /, dashboard, stats pages │
        │ (forecasts,P6) │                                          └──────────────────────────────────┘
        └────────────────┘
```

## 3. Service boundaries

| Unit | Owns | Doesn't own | Interface |
|------|------|-------------|-----------|
| **`data_agent/`** (new) | Source registry; fetching; raw snapshots; normalized data; metrics; facts; agent runs; review queue | UI; per-user state | FastAPI `/v1/*` (OpenAPI), CLI `tda`, Postgres schema `tda` |
| **Postgres** (new) | Durable storage | Business logic | Roles: `tda_writer` (ingest/agent), `tda_reader` (API) |
| **`src/` Next.js** (existing) | UX; per-request composition (live TomTom for the drive side, plus `/v1/compare` and `/v1/assumptions` from P4); low-latency narration (D-15); demo mode | Ingestion; long-running jobs; direct DB access | Calls the data agent through `src/lib/api/data-agent.ts`, with types generated from OpenAPI |
| **`model_service/`** (existing) | Ridership and congestion forecasts (P6) | Data acquisition (it reads curated series) | `GET /predict/*` (versioned in P6) |

Why a separate Python service, and not more TypeScript in Next.js (D-2)? GTFS, geo, PDF, and scraping tooling;
pandas; scheduling; the Python-first agent frameworks; and adjacency to the existing ML service. The request path
stays in TypeScript, so the UX doesn't depend on batch jobs.

## 4. Target repository layout

```
data_agent/                         # NEW (P2+)
  pyproject.toml  uv.lock  README.md  Dockerfile  .dockerignore
  tda/
    config/        settings.py (pydantic-settings), regions/charleston.yaml, sources.yaml
    http/          polite_client.py (robots, rate limit, retries+jitter, ETag/Last-Modified cache, UA)
    store/         db.py, models.py (SQLAlchemy 2), raw_store.py (fs → S3-compatible later)
    connectors/    base.py, gtfs_static.py (gtfs-kit), gtfs_rt.py (gtfs-realtime-bindings), ntd.py, census_acs.py,
                   eia.py, tomtom.py, scdot_counts.py, scdot_ccs_inbox.py, nws.py, noaa_tides.py, nhtsa_fars.py,
                   documents.py
    pipelines/     normalize_*.py, validate.py
    metrics/       congestion.py, compare.py, costs.py, emissions.py, ridership.py, service.py
    facts/         registry.py, reference_facts.yaml (curated, cited, HITL-approved)
    agent/         runtime.py, tools.py, guardrails.py, tasks/{narrate,weekly_report,extract,scout}.py, prompts/
    review/        queue.py, cli.py
    api/           app.py (FastAPI), routes/*.py, schemas.py
    scheduler.py   cli.py
  migrations/      (Alembic)
  tests/           unit/, connectors/ (recorded fixtures), api/, agent/ (TestModel), evals/
  raw/  inbox/     (gitignored) raw snapshots, and human-supplied exports and documents (03 §3). Both resolve
                   from the project root (`TDA_PROJECT_ROOT`), never from the current working directory.
contracts/                          # NEW (P1): cross-language test vectors, OpenAPI snapshot
  claim-validation.vectors.json  data-agent.openapi.json
reports/                            # NEW (P5): approved, published reports (committed via PR)
docker-compose.yml                  # NEW (P2): postgres, data-agent-api, data-agent-worker, model-service, web
.github/workflows/ci.yml            # NEW (P0), ingest-*.yml (P7, optional)
src/lib/                            # CHANGED (P1)
  env.ts (server-only, zod)  contracts/transit-insights.ts (zod)  domain/{time,traffic,cost,emissions}.ts
  llm/{provider.ts,gemini.ts,openai.ts,narrate.ts,validate-claims.ts}  api/data-agent.ts (P4)
```

## 5. Data flow

1. **Register.** Each source has an entry in `sources.yaml` with `status: proposed | approved | disabled`. Only
   `approved` sources run.
2. **Fetch.** The polite client checks `robots.txt` (HTML and document sources), applies rate limits, sends
   conditional requests, and retries with jitter. Every attempt writes a `fetch_run` row.
3. **Land.** Raw bytes go to `raw/<source>/<yyyy>/<mm>/<dd>/<run_id>.<ext>` with a checksum. Retention follows
   the source's `store_policy`.
4. **Normalize and validate.** Schema-validate the data and upsert it into domain tables. Everything is idempotent:
   re-running a `fetch_run` produces the same rows.
5. **Compute.** Deterministic metric jobs write `metric_value` rows. Each row records its lineage (the input run
   IDs) and its method version.
6. **Promote facts.** Metrics become `fact`s automatically when a rule marks them publishable (`auto_publish: true`,
   for example NTD ridership). LLM-extracted facts become `candidate` facts, which need human approval.
7. **Serve.** The read API exposes **approved** facts and metrics only.
8. **Narrate and analyze.** Agent tasks read through tools. Their outputs pass guardrails, then either return
   (narration) or go to the review queue (reports, candidate facts, source proposals).

## 6. Data model (schema `tda`)

| Table | Key columns | Notes |
|-------|-------------|-------|
| `source` | `id` (slug), `kind` (gtfs, gtfs_rt, socrata, census, arcgis, rest, html, pdf, **manual**), `url`, `auth`, `license`, `terms_url`, `robots_required`, `store_policy` (`none`, `ttl:<days>`, `indefinite`), `cadence` (cron), `status`, `owner`, `attribution_text` | Mirrors `sources.yaml`, which is the source of truth |
| `fetch_run` | `id`, `source_id`, `acquisition` (`http` \| `manual`), `supplied_by` (manual only), `original_url`, `started_at`, `finished_at`, `status`, `http_status`, `bytes`, `sha256`, `raw_uri`, `error`, `etag`, `last_modified` | One row per attempt, including inbox runs |
| `gtfs_feed_version` | `id`, `source_id`, `feed_start`, `feed_end`, `sha256`, `loaded_at`, `is_active` | Hot-swap feeds atomically |
| `gtfs_stop`, `gtfs_route`, `gtfs_trip`, `gtfs_stop_time`, `gtfs_calendar`, `gtfs_calendar_date`, `gtfs_shape` | GTFS spec columns plus `feed_version_id` | CARTA is small, so plain tables are fine |
| `corridor` | `id`, `region`, `name`, `probe_points` (lat/lng list), `origin_stop_id`, `dest_stop_id`, `description` | Human-curated in `regions/<region>.yaml` |
| `traffic_sample` | `corridor_id`, `probe_idx`, `observed_at`, `current_speed`, `free_flow_speed`, `current_tt_s`, `free_flow_tt_s`, `confidence`, `fetch_run_id` | **Off by default.** Populated only from licensed data (TomTom Traffic Stats) or if a legal review approves storing live samples (D-7). |
| `traffic_count` | `station_id`, `year`, `aadt`, `lat`, `lng`, `route_name`, `fetch_run_id` | SCDOT AADT (S-6a/S-6b) |
| `traffic_count_hourly` | `station_id`, `local_date`, `local_hour`, `direction`, `volume`, `fetch_run_id` | SCDOT continuous count stations (S-6c) via the manual inbox. This is the default **time-of-day pattern** source. |
| `ridership_monthly` | `ntd_id`, `mode`, `tos`, `month`, `upt`, `vrm`, `vrh`, `fetch_run_id` | NTD |
| `service_alert` | `alert_id`, `source_id`, `cause`, `effect`, `header_text`, `description_text`, `active_from`, `active_to`, `informed_entities` (jsonb: route/stop IDs), `fetch_run_id` | CARTA GTFS-RT alerts (S-2). This is third-party text, so it's **untrusted**; see §7.3. |
| `acs_commute` | `geo_id`, `year`, `table`, `variable`, `label`, `estimate`, `moe` | Census |
| `fuel_price_weekly` | `series_id`, `week_ending`, `usd_per_gal`, `fetch_run_id` | EIA (S-11) |
| `metric_value` | `metric_key`, `dims` (jsonb), `value`, `unit`, `computed_at`, `method_version`, `input_run_ids[]` | Everything is recomputable |
| `fact` | `id`, `key`, `value_num`, `value_text`, `unit`, `geography`, `period_start`, `period_end`, `method`, `source_ids[]`, `evidence` (jsonb: quote, page, url), `confidence`, `status` (`candidate`, `approved`, `rejected`, `superseded`), `created_by` (`connector`, `metric`, `agent`, `human`), `reviewed_by`, `reviewed_at`, `valid_until` | **The citable unit** |
| `review_item` | `id`, `kind` (`source`, `fact`, `report`, `campaign`), `ref_id`, `payload`, `status`, `requested_by`, `decided_by`, `decided_at`, `notes` | The HITL queue |
| `agent_run` | `id`, `task`, `provider`, `model`, `prompt_version`, `tools_called` (jsonb), `input_tokens`, `output_tokens`, `cost_usd`, `status`, `guardrail_violations` (jsonb), `output_ref` | Audit and cost |

**Grants:** `tda_reader` gets **explicit** `SELECT` on each API-exposed table. It never gets default privileges.
Every migration that adds an API-exposed table includes its grant. Integration tests run the API as `tda_reader`
and assert that writes are denied.

### Fact contract (what "citable" means)

```json
{
  "id": "fct_…",
  "key": "corridor.i26_summerville_downtown.drive_time_ratio.weekday_am_peak",
  "value": 1.0,
  "unit": "ratio (congested / free-flow travel time)",
  "geography": "corridor:i26_summerville_downtown",
  "period": { "start": "2026-10-01", "end": "2026-10-31" },
  "method": "median of 15-min samples 07:00–09:00 local, Mon–Fri, method v1",
  "sources": [{ "source_id": "tomtom-flow", "attribution": "© TomTom", "retrieved": "2026-10-31" }],
  "status": "approved",
  "confidence": "medium",
  "valid_until": "2026-11-30"
}
```

(The values here are placeholders; the shape is the contract.)

## 7. Agent design

**Runtime (D-3, default): Pydantic AI 2.x** (MIT, Python ≥ 3.10; verified 2026-09-24). It gives typed tools and
typed outputs, and it supports the Gemini, OpenAI, and Anthropic providers. `TestModel` and `FunctionModel`
cover deterministic tests, and `pydantic-evals` covers eval datasets. The alternatives are the OpenAI Agents SDK
(0.22.x, still pre-1.0) and LangGraph (1.x, heavier). **Optional:** the same read-only tools can be exposed as an
MCP server (the `mcp` Python SDK, 2.x), so IDE agents can query approved facts.

### 7.1 Roles (one runtime, four task types)

| Task | Trigger | Tools | Output | Human gate |
|------|---------|-------|--------|------------|
| **Narrator**: trip nudge | Each `/api/transit-insights` request (low latency) | None. Facts are passed in. | 1–2 sentence nudge plus incentive wording (value picked by the policy engine, not the LLM) | No per-message gate. Covered by the validator, the fallback template, and the prompt review in P1. |
| **Analyst**: weekly opportunity report | Weekly schedule or CLI | Read-only data tools (§7.2) | Structured report → Markdown | **Yes**, before publishing or sharing externally |
| **Extractor**: facts from public docs | New `documents` fetch_run | **None**, for isolation | `candidate` facts with a verbatim quote and location | **Yes**, per fact |
| **Scout**: source discovery (off by default) | CLI only | Web search, if enabled (D-12) | `proposed` sources with a rationale and terms notes | **Yes**, before `approved` |

### 7.2 Tool contracts (read-only unless noted)

| Tool | Args | Returns |
|------|------|---------|
| `get_region()` | none | Timezone, bbox, agencies, feed versions |
| `list_corridors()` | none | `[{id, name, origin_stop_id, dest_stop_id}]` |
| `get_congestion_profile` | `corridor_id, day_type, hour_from, hour_to` | Hourly ratio, speed, sample count, and `fact_refs` |
| `compare_modes` | `origin_stop_id, dest_stop_id, date, arrive_by \| depart_at` | Transit minutes, the leave-by time or wait, next departures, cost, CO2, and `fact_refs`. **The drive fields are nullable**: they're null unless a drive-time source exists (D-7 b, c, or d). |
| `get_service_profile` | `route_id?` | Headways by time band from GTFS |
| `get_ridership_trend` | `mode?, months` | NTD UPT series, year-over-year change, and `fact_refs` |
| `get_fact` / `search_facts` | `key` / `text, geography?` | Approved facts only |
| `get_data_freshness()` | none | Last success per source, and stale flags |
| `submit_candidate_fact` (**write → queue**) | fact payload plus evidence | `review_item.id` |
| `submit_report_draft` (**write → queue**) | report payload | `review_item.id` |
| `propose_source` (**write → queue**) | source payload | `review_item.id` |

The runtime can't reach any other side effects: no raw SQL, no arbitrary HTTP, and no approvals.

### 7.3 Guardrails

1. **Numeric-claim validator.** Extract every number from the LLM output. Each must match a supplied fact within
   a tolerance (rounding and unit-aware). One unmatched number rejects the output, and the fallback is a
   deterministic template. The web app and the agent use the same test vectors
   (`contracts/claim-validation.vectors.json`).
2. **Citations required.** The output schemas include `citations: fact_id[]`, and each cited ID must have been
   in the context.
3. **Prompt-injection isolation.** Fetched content is wrapped in delimiters and labeled untrusted. The Extractor
   has no tools, and its output is schema-validated. Status is always `candidate`, and nothing the model outputs
   can approve anything.
4. **Policy bounds.** The deterministic policy engine picks incentive values from configured bounds (today's
   prompt uses an eCredit of $0.50–$2.00). The copy has tone rules: no false urgency, no fear framing, and no
   demographic targeting.
5. **Budgets.** Every run has a max-token and cost cap, the system has a daily run cap, and calls have timeouts.
   Everything is logged in `agent_run`.
6. **Model/provider config.** `LLM_PROVIDER`, `LLM_MODEL`, and `LLM_TIMEOUT_MS` come from the environment, with
   the existing `USE_GEMINI` kept as a back-compat alias in P1.

### 7.4 Human-in-the-loop workflow

```
source:  proposed ──approve──► approved ──disable──► disabled
fact:    candidate ─approve──► approved ──(newer)──► superseded
                   └reject───► rejected
report:  draft ────approve──► approved ──publish──► reports/<region>/<yyyy>-W<ww>.md (committed via PR)
phase:   prompt reviewed ─► executed on branch ─► PR checks green ─► human merge
```

**Default review surface (D-8):** CLI (`tda review list|show|approve|reject`) plus Markdown export for PR review.
An admin page (`/admin/review`) waits for real auth (P7).

## 8. Integration with the existing app

### 8.1 `/api/transit-insights`: backward-compatible evolution

Existing fields stay. The new fields are **additive** and optional, so the current UI keeps working.

```ts
// src/lib/contracts/transit-insights.ts (zod is the source of truth; TS types are inferred from it)
TransitInsightResponse = {
  travelTime, trafficDensity, costSavingsPerTrip, nudgeMessage, incentiveDetails, additionalRides, // unchanged
  comparison?: {
    drive:   { minutes: number; delayMinutes: number; source: SourceRef },
    transit: { minutes: number | null; nextDepartures: string[]; estimated: boolean; source: SourceRef },
    costUsd: { drive: number; transit: number; savings: number; factRefs: string[] },
    co2Kg?:  { drive: number; transit: number; savings: number; factRefs: string[] },
  },
  meta?: { generatedAt; region; timezone; narration: { provider; model?; validated: boolean };
           degraded: string[]; citations: string[] },
}
```

| Field | Today | P1 | P4 |
|-------|-------|----|----|
| `trafficDensity` | LLM guess | TomTom speed ratio → Light/Medium/Heavy (thresholds configurable), labeled **"Traffic now"** because it reflects current conditions | Same, plus the corridor volume profile |
| `costSavingsPerTrip` | LLM guess | Cost model (per-mile cost × TomTom route distance + parking − fare), with the assumptions cited. The route is computed for the **desired arrival time** (`arriveAt`). | Same, with facts from the store |
| `travelTime` (transit) | LLM guess | **D-21 deterministic heuristic**, always flagged `comparison.transit.estimated=true`. The v2 engine never calls the LLM or `model_service` for numbers. | GTFS scheduled in-vehicle time plus the expected wait |
| `additionalRides` | LLM invented | **Empty (hidden) per D-21** | Next GTFS departures |
| `nudgeMessage` | LLM free text | LLM narration of the facts, run through the validator, with a template fallback | Same, richer facts |

### 8.2 UI surfaces

- **Stop pickers.** P4b swaps the synthetic lists for a searchable picker fed by `GET /api/stops`, which proxies
  `/v1/stops`. When the data agent is off or down, it falls back to the generated, committed
  `src/app/data/stops.fallback.generated.ts` (`tda gtfs export-stops`). The demo scenarios use the GTFS stop IDs
  in 05 §2b.
- **Dashboard.** In P4, `metrics` comes from `/api/stats`. The current constants move behind `NEXT_PUBLIC_DEMO_MODE`.
- **Emissions and safety pages.** In P4 they render approved facts with a "Sources" footnote.
- **Attribution.** Any page that shows sourced numbers renders the source's `attribution_text`.

## 9. Scheduling and operations

| Job | Default cadence | Notes |
|-----|-----------------|-------|
| GTFS static | Daily at 03:00 local (a conditional GET makes it cheap) | Hot-swap `feed_version` |
| GTFS-RT service alerts (S-2) | Every 2–5 min | CARTA publishes **alerts only**. Vehicle positions need a partnership (03 §6). |
| TomTom corridor sampler | **Disabled by default** | Enable only if D-7 approves storage or a Traffic Stats license exists |
| SCDOT hourly counts (S-6c) | Monthly manual export → `tda inbox process` | The default source for time-of-day traffic patterns |
| NTD monthly ridership | Weekly check | New months are published with a lag |
| Census ACS | Yearly (after the ACS release), plus a manual trigger | — |
| EIA gasoline | Weekly | — |
| SCDOT counts | Yearly or quarterly | — |
| Metrics rebuild | After each successful ingest, plus nightly | Idempotent |
| Weekly opportunity report | Monday 06:00 local | Draft goes to the review queue |

**TomTom request budget (live app):** each insight request makes about 4 non-tile calls (2 flow, 1 incidents,
1 routing from P1). The free tier is ~**2,500 non-tile requests/day** (a secondary source; confirm in D-14), which
caps the live app at about **600 insight requests/day** before overage. Mitigations: a short in-process cache for
identical stop pairs (only if the terms permit it), a per-IP rate limit (P7), and separate keys per environment.
If the sampler is ever enabled (D-7), give it its **own key**.

**Runtime (D-9):** a docker-compose stack locally and on a single VM (worker plus API plus Postgres). Moving to a
managed cloud platform is a later decision.

## 10. Non-functional requirements

| Area | Requirement |
|------|-------------|
| Security | Secrets come only from env or a secret store. No `NEXT_PUBLIC_` prefix on secrets. The DB roles are least-privilege. The admin/review API isn't exposed publicly. Dependencies are patched (the Next advisories). Flask/FastAPI never run in debug mode in containers. |
| Privacy | No PII in the data agent. App analytics (P7) stay aggregate and anonymous, with no raw location storage. |
| Legal/licensing | `store_policy` and `attribution_text` are enforced per source. A `robots.txt` check is mandatory for HTML/PDF sources. The User-Agent includes a contact address. |
| Reliability | Every external call has a timeout and retries with jitter. Partial results beat failures (`meta.degraded`). Ingestion is idempotent and resumable. |
| Performance | `/api/transit-insights`: p95 under 3 s with LLM narration, under 800 ms with template narration. Data API: p95 under 300 ms on read endpoints. |
| Cost | Monthly caps for LLM and TomTom (D-14), enforced in code and reported in `agent_run` and fetch metrics. |
| Observability | Structured JSON logs with request/run IDs; a freshness dashboard (`/v1/health` shows per-source staleness); an alert when a source is stale for more than 2 cadences. |
| Testability | Connectors are tested against recorded fixtures, with no network access in CI. A contract test runs between the Next client and the data-agent OpenAPI. Agent tests use a deterministic model stub. Paid LLM evals run manually or nightly under a budget cap. |

## 11. Testing and evaluation strategy

| Layer | Tooling | Gate |
|-------|---------|------|
| Web unit and route tests | Jest (existing), plus route-handler tests with mocked clients | CI |
| Web contract | Zod schemas plus a snapshot of the data-agent OpenAPI → generated TS types; CI fails on drift | CI |
| Python unit and connectors | pytest plus recorded HTTP fixtures (`respx` or `vcrpy`) | CI |
| DB | Alembic migrations applied to ephemeral Postgres (a CI service container) | CI |
| Agent (deterministic) | Pydantic AI `TestModel` or `FunctionModel`; the claim validator runs against the shared vectors | CI |
| Agent (live evals) | A `pydantic-evals` golden set of fact bundles → expected citations, no unmatched numbers, and injection cases | Manual or nightly, budget-capped |
| End to end | Playwright smoke: home page, a demo scenario, and a live request with mocked upstreams | P7 CI |
