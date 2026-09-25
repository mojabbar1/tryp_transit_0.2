# 02 — Target Architecture: Transit Intelligence Agent (TIA)

> Status: **proposal for review.** Choices marked **D-n** are open decisions with defaults; see
> [05-decisions-and-review.md](./05-decisions-and-review.md). Data sources are listed in
> [03-data-source-catalog.md](./03-data-source-catalog.md).

---

## 1. Goals and non-goals

**Goals**
1. Acquire public transit, traffic, and supporting data on a schedule, lawfully and politely, with full provenance.
2. Turn that data into **deterministic metrics** and **cited facts**. Examples: where and when transit is
   competitive with driving, traffic **volume** by corridor and hour, cost and CO2 savings, ridership trends.
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
│  │ registry     │  │ (determin-   │  │ (immutable    │  │ validate     │  │ (volume, compare,    │ │
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
| **`model_service/`** (existing) | Ridership and volume forecasts (P6) | Data acquisition (it reads curated series) | `GET /predict/*` (versioned in P6) |

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
    metrics/       volume.py, compare.py, costs.py, emissions.py, ridership.py, service.py
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

### 6.0 Two invariants the whole schema rests on

1. **Observations are append-only.** A connector never overwrites a prior observation. Each load inserts rows
   keyed by `(natural_key, content_hash, fetch_run_id)`. "Current" data is a **view** that selects the latest
   `success`, non-`rolled_back` run. This is what makes rollback (REV-07) actually restore prior values instead of
   destroying them.
2. **Facts are immutable versions.** A fact is never edited in place. A correction inserts a new version that
   `supersedes` the prior one. Published evidence is therefore always reconstructable.

### 6.1 Tables

| Table | Key columns | Notes |
|-------|-------------|-------|
| `source` | `id` (slug), `kind` (gtfs, gtfs_rt, socrata, census, arcgis, rest, html, pdf, **manual**), `url`, `auth`, `license`, `terms_url`, `robots_required`, `store_policy` (`none`, `ttl:<days>`, `indefinite`), `cadence` (cron), `status`, `owner`, `attribution_text` | Mirrors `sources.yaml`, which is the source of truth |
| `fetch_run` | `id`, `source_id`, `acquisition` (`http` \| `manual`), `supplied_by` (manual only), `original_url`, `started_at`, `finished_at`, `status` (`success`, `not_modified`, `failed`, `skipped_*`, **`rolled_back`**), `http_status`, `bytes`, `sha256`, `raw_uri`, `error`, `etag`, `last_modified` | One row per attempt, including inbox runs. `rolled_back` is set by `tda runs rollback`, never deleted. |
| `gtfs_feed_version` | `id`, `source_id`, `feed_start`, `feed_end`, `sha256`, `loaded_at`, `is_active` | Hot-swap feeds atomically |
| `gtfs_stop`, `gtfs_route`, `gtfs_trip`, `gtfs_stop_time`, `gtfs_calendar`, `gtfs_calendar_date`, `gtfs_shape` | GTFS spec columns plus `feed_version_id` | CARTA is small, so plain tables are fine |
| `corridor` | `id`, `region`, `name`, `probe_points` (lat/lng list), `origin_stop_id`, `dest_stop_id`, `description` | Human-curated in `regions/<region>.yaml` |
| `traffic_sample` | `corridor_id`, `probe_idx`, `observed_at`, `current_speed`, `free_flow_speed`, `current_tt_s`, `free_flow_tt_s`, `confidence`, `fetch_run_id` | **Off by default.** Populated only from licensed data (TomTom Traffic Stats) or if a legal review approves storing live samples (D-7). |
| `traffic_count` | `station_id`, `year`, `aadt`, `lat`, `lng`, `route_name`, `fetch_run_id` | SCDOT AADT (S-6a/S-6b) |
| `traffic_count_hourly` | `station_id`, `local_date`, `local_hour`, `direction`, `volume`, `fetch_run_id` | SCDOT continuous count stations (S-6c) via the manual inbox. This is the default **time-of-day pattern** source. |
| `ridership_monthly` | `ntd_id`, `mode`, `tos`, `month`, `upt`, `vrm`, `vrh`, `content_hash`, `fetch_run_id` | NTD. **Append-only**; read through `current_ridership_monthly`, which picks the latest good run per `(ntd_id, mode, tos, month)`. |
| `service_alert` | `alert_id`, `source_id`, `cause`, `effect`, `header_text`, `description_text`, `active_from`, `active_to`, `informed_entities` (jsonb: route/stop IDs), `fetch_run_id` | CARTA GTFS-RT alerts (S-2). This is third-party text, so it's **untrusted**; see §7.3. |
| `acs_commute` | `geo_id`, `year`, `table`, `variable`, `label`, `estimate`, `moe`, `content_hash`, `fetch_run_id` | Census. Append-only + `current_acs_commute`. |
| `fuel_price_weekly` | `series_id`, `week_ending`, `usd_per_gal`, `content_hash`, `fetch_run_id` | EIA (S-11). Append-only + `current_fuel_price_weekly`. |
| `metric_value` | `metric_key`, `dims` (jsonb), `value`, `unit`, `computed_at`, `method_version`, `input_run_ids[]` | Recomputed from current-view inputs; recording `input_run_ids` gives lineage for rollback. |
| `fact` | `id`, `key`, **`version`**, **`supersedes_id`**, **`derived_from`** (input run/metric ids), `value_num`, `value_text`, `unit`, `geography`, `period_start`, `period_end`, `method`, `source_ids[]`, `evidence` (jsonb: quote, page, url), `confidence`, `status` (`candidate`, `approved`, `rejected`, `superseded`, **`needs_review`**), `created_by` (`connector`, `metric`, `agent`, `human`), `reviewed_by`, `reviewed_at`, `valid_until` | **The citable unit. Immutable per version.** A correction inserts a new version; a rollback that touches a fact's inputs sets the approved version to `needs_review`. |
| `review_item` | `id`, `kind` (`source`, `fact`, `report`, `campaign`), `ref_id`, `payload`, `status`, `requested_by`, `decided_by`, `decided_at`, `notes` | The HITL queue |
| `agent_run` | `id`, `task`, `provider`, `model`, `prompt_version`, `tools_called` (jsonb), `input_tokens`, `output_tokens`, `cost_usd`, `status`, `guardrail_violations` (jsonb), `output_ref` | Audit and cost |

### 6.2 Roles, bootstrap, and freshness

Three roles, created **before** migrations run (REV-08):

- `tda_owner` — owns the schema; runs migrations and `tda db bootstrap`.
- `tda_writer` — ingestion and the agent runtime; insert/update on domain tables and the queue.
- `tda_reader` — the read API and the agent's `QueryService`; **explicit `SELECT` only**, never default privileges.

`tda db bootstrap` (idempotent, run from an admin URL) creates the roles. It runs as a one-shot
`data-agent-migrate` service in compose and as an explicit step in CI, ahead of `alembic upgrade head`. Every
migration that adds an API-exposed table grants `SELECT` to `tda_reader` in the same revision. Integration tests
run the API as `tda_reader` and assert that writes are denied — and these tests **fail** rather than skip when
the DB is unreachable in CI (`TDA_REQUIRE_DB_TESTS=1`).

The reader has no access to `fetch_run`, `review_item`, or `agent_run`. Freshness for `/v1/health` therefore comes
from a dedicated view, `source_freshness` (`source_id`, `last_success`, `last_status`, `cadence`, `stale`),
which is granted to the reader — the only ingestion-status surface it can see.

### 6.3 Fact contract (what "citable" means)

```json
{
  "id": "fct_carta_upt_2026_07",
  "key": "carta.ridership.upt.monthly.bus",
  "version": 1,
  "supersedes_id": null,
  "value_num": 224397,
  "unit": "unlinked passenger trips (UPT), bus, month",
  "geography": "agency:ntd:40110",
  "period": { "start": "2026-07-01", "end": "2026-07-31" },
  "method": "NTD Complete Monthly Ridership, mode=MB, tos=DO; method v1",
  "sources": [{ "source_id": "ntd-monthly", "attribution": "FTA NTD (public domain)", "retrieved": "2026-09-24" }],
  "derived_from": { "metric_key": "carta.ridership.upt.monthly.bus", "input_run_ids": ["run_…"] },
  "status": "approved",
  "confidence": "high",
  "valid_until": null
}
```

(The values illustrate the shape. The example uses **NTD monthly ridership** — a public-domain, storable source —
not TomTom sampling, which the default D-7 forbids persisting.)

## 7. Agent design

**Runtime (D-3, default): Pydantic AI 2.x** (MIT, Python ≥ 3.10; verified 2026-09-24). It gives typed tools and
typed outputs, and it supports the Gemini, OpenAI, and Anthropic providers. `TestModel` and `FunctionModel`
cover deterministic tests, and `pydantic-evals` covers eval datasets. The alternatives are the OpenAI Agents SDK
(0.22.x, still pre-1.0) and LangGraph (1.x, heavier). **Optional:** the same read-only tools can be exposed as an
MCP server (the `mcp` Python SDK, 2.x), so IDE agents can query approved facts.

### 7.1 Roles (one runtime, four task types)

The **Narrator** is the only agent role in the pilot (Stage 2). Analyst, Extractor, and Scout are **expansion**
(Stage 3+), enabled only after the G1 pilot gate.

| Task | Stage | Trigger | Tools | Output | Human gate |
|------|-------|---------|-------|--------|------------|
| **Narrator**: trip nudge | Pilot (P1) | Each `/api/transit-insights` request (low latency) | None. Facts are passed in as `{id,label,phrase}` + flags. | Nudge by reference (§7.3); incentive copy only in demo mode | No per-message gate; covered by the validator, template fallback, and prompt review |
| **Analyst**: weekly opportunity report | Expansion (P5) | Weekly schedule or CLI | Read-only data tools (§7.2) | Structured report → Markdown | **Yes**, before publishing |
| **Extractor**: facts from public docs | Expansion (P5) | New `documents` fetch_run | **None**, for isolation | `candidate` facts with a verbatim quote and location | **Yes**, per fact |
| **Scout**: source discovery (off by default) | Expansion (P5, D-12) | CLI only | Web search, if enabled | `proposed` sources with a rationale | **Yes**, before `approved` |

### 7.2 Tool contracts (read-only unless noted)

The model gets **read tools only**. It cannot write anywhere — not even to the review queue. The runtime, not the
model, submits to the queue after the output passes validation (§7.3). This closes REV-12: there is no path by
which a model turn leaves a persistent artifact before validation.

| Tool | Args | Returns |
|------|------|---------|
| `get_region()` | none | Timezone, bbox, agencies, feed versions |
| `list_corridors()` | none | `[{id, name, origin_stop_id, dest_stop_id}]` |
| `get_volume_profile` | `station_id \| corridor_id, day_type, hour_from, hour_to` | Hourly **volume** (vehicle counts) and a volume index, sample count, and `fact_refs`. **This is throughput, not congestion** — no speeds or delay are implied (REV-11). |
| `compare_modes` | `origin_stop_id, dest_stop_id, date, arrive_by \| depart_at` | Transit minutes with a `basis` (`scheduled` \| `realtime` \| `unavailable`), the leave-by time or wait, next departures, signed cost/CO2 differences, and `fact_refs`. **Drive fields are nullable** unless a drive-time source exists (D-7 b, c, or d). |
| `get_service_profile` | `route_id?` | Headways by time band from GTFS |
| `get_ridership_trend` | `mode?, months` | NTD UPT series, year-over-year change, and `fact_refs` |
| `get_fact` / `search_facts` | `key` / `text, geography?` | Approved facts only |
| `get_data_freshness()` | none | Last success per source, and stale flags |

**Proposing outputs (staged, not written by the model):** the model returns a typed result object
(`CandidateFact[]`, an `OpportunityReport`, or a `SourceProposal`). The **runtime** validates it (§7.3) and only
then calls the internal `ReviewQueue.submit`. A failed validation produces no `review_item`.

The runtime reaches no other side effects: no raw SQL, no arbitrary HTTP, no approvals, no file writes.

### 7.3 Guardrails

1. **Numbers by reference (the narration contract).** The model never emits digits in prose. It receives facts as
   `{id, label, phrase}` (for example `{id: "f_drive", phrase: "about 25 min by car"}`) plus boolean comparison
   flags (`transitServiceKnown`, `transitFaster`, `transitCheaper`, `offerActive`, `trafficNow`). It returns
   `{nudge, slots}` where `nudge` contains **no digits** and may include `{{fact_id}}` placeholders. Code then
   checks: no digits present, only known slots referenced, and every comparative word (faster/slower,
   cheaper/costs more, next bus, reward) is consistent with the flags. Code substitutes the phrases. This defeats
   the REV-04 counterexample (a fluent sentence that swaps bus and car times): the swapped claim either has no
   backing flag or contradicts one, so it is rejected. **The validator's job is semantic consistency, not just
   number membership.** Shared vectors (`contracts/claim-validation.vectors.json`) drive both the web and agent
   implementations and must include swapped-entity, wrong-period, negation, wrong-unit, and unsupported-comparative
   cases.
2. **Fail closed.** Any output that fails schema validation, the slot/flag checks, or the citation check falls back
   to a deterministic template (web) or is rejected with no draft (agent). A malformed model response is never
   logged-and-passed.
3. **Citations required.** Report schemas include `citations: fact_id[]` per stat; each cited ID must have been
   returned by a tool in this run, and every stat needs at least one.
4. **Prompt-injection isolation.** Fetched/alert content is wrapped in delimiters and labeled untrusted. The
   Extractor has no tools; its output is schema-validated; status is always `candidate`; nothing the model outputs
   can approve or enable anything.
5. **Policy bounds.** Incentive **copy** is demo-only until an approved, funded offer exists (D-25). When offers
   exist, the deterministic policy engine — not the model — picks values within configured bounds. Tone rules: no
   false urgency, no fear framing, no demographic targeting.
6. **Budgets, reserved atomically.** Before a run, the runtime reserves the run's worst-case cost under a Postgres
   advisory lock and checks it against the monthly and daily caps, then reconciles actuals afterward. Concurrent
   near-budget runs therefore cannot all pass (REV-12). The per-request web narrator is bounded by max output
   tokens, a provider-side cap, a kill switch, and rate limiting (before any public deploy); its spend is recorded
   too. Everything is logged in `agent_run`.
7. **Model/provider config.** `LLM_PROVIDER`, `LLM_MODEL`, and `LLM_TIMEOUT_MS` come from the environment, with
   the legacy `USE_GEMINI` kept as a back-compat alias in P1.

### 7.4 Human-in-the-loop workflow

```
source:  proposed ──approve──► approved ──disable──► disabled
fact:    candidate ─approve──► approved ──(newer version)──► superseded
                   └reject───► rejected
         approved  ──(inputs rolled back)──► needs_review ──re-approve──► approved
run:     success   ──rollback──► rolled_back   (never deleted; metrics recompute; dependent facts → needs_review)
report:  draft ────approve──► approved ──publish──► reports/<region>/<yyyy>-W<ww>.md (committed via PR)
phase:   prompt reviewed ─► executed on branch ─► PR checks green ─► human merge
```

**Default review surface (D-8):** CLI (`tda review list|show|approve|reject`) plus Markdown export for PR review.
An admin page (`/admin/review`) is an **expansion-stage** item and waits for real auth (P7).

**Correction and rollback (REV-07).** `tda runs rollback <run-id>` sets the run `rolled_back` (never deletes),
recomputes affected `metric_value` rows from the current views, and marks any dependent **approved** fact
`needs_review`. Because observations are append-only, the prior value is still present and the current view
returns it again. Raw snapshots cited by any published fact are retained regardless of TTL.

## 8. Integration with the existing app

### 8.1 `/api/transit-insights`: backward-compatible evolution

Existing fields stay. New fields are **additive** and optional, so the current UI keeps working. The guiding rule
(D-21, D-25): **live mode makes no unsupported promise.** A number appears only when it is measured, scheduled, or
an approved fact; otherwise the field is `unavailable`.

```ts
// src/lib/contracts/transit-insights.ts (zod is the source of truth; TS types are inferred from it)
TransitInsightResponse = {
  travelTime, trafficDensity, costSavingsPerTrip, nudgeMessage, incentiveDetails, additionalRides, // unchanged shape
  comparison?: {
    drive:   { minutes: number; delayMinutes: number; source: SourceRef },
    transit: { minutes: number | null;
               basis: "unavailable" | "scheduled" | "realtime";   // replaces the estimated boolean
               nextDepartures: string[]; source: SourceRef },
    costUsd?: { drive: number; transit: number;
                difference: number;   // signed: positive = transit saves, negative = transit costs more
                factRefs: string[] },
    co2Kg?:  { drive: number; transit: number; difference: number; factRefs: string[] },
  },
  meta?: { generatedAt; region; timezone; demo: boolean;
           narration: { source: "template" | "llm"; provider?; model?; validated: boolean };
           degraded: string[]; citations: string[] },
}
```

| Field | Today | P1 (pre-GTFS) | P4 (schedules in) |
|-------|-------|---------------|-------------------|
| `trafficDensity` | LLM guess | TomTom current speed ratio → Light/Medium/Heavy, labeled **"Traffic now"** (current conditions only) | Same, plus a volume profile shown separately and labeled as volume |
| `costSavingsPerTrip` / `costUsd.difference` | LLM guess | Cost model (per-mile cost × TomTom route distance for the **arrival time** `arriveAt`, + parking − fare), **signed**, assumptions cited | Same, cost facts from the store |
| `travelTime` / `transit.basis` | LLM guess | **`unavailable`** (D-21). No heuristic bus time in live mode; drive time, cost, and current traffic still render | `scheduled` — GTFS in-vehicle time + expected wait (`realtime` only if GTFS-RT positions arrive later) |
| `additionalRides` | LLM invented | **Empty** in live mode (no schedule yet) | Next GTFS departures |
| `incentiveDetails` | LLM invented | **null in live mode** (no funded offer, D-25); shown only in demo mode with a badge | Real offers when an approved inventory exists |
| `nudgeMessage` | LLM free text | Narration by reference (§7.3) over whatever facts exist, validated, template fallback | Same, richer facts |

**No legacy engine (D-27).** There is no `INSIGHTS_ENGINE=legacy` switch. The v2 orchestrator is the only path;
rollback is a PR revert. Keeping a runtime toggle that re-enables LLM-invented numbers would defeat the point of
the refactor.

**The v2 orchestrator never calls `model_service`.** The current ridership service returns NYC-derived or random
numbers (F-07), so it is not part of the live request path. `model_service` is an **expansion-stage** component
(D-10, decided at G1).

### 8.2 UI surfaces

- **Stop pickers.** P4b swaps the synthetic lists for a searchable picker fed by `GET /api/stops`, which proxies
  `/v1/stops`. When the data agent is off or down, it falls back to the generated, committed
  `src/app/data/stops.fallback.generated.ts` (`tda gtfs export-stops`). The demo scenarios use the GTFS stop IDs
  in 05 §2b.
- **Demo mode is one app-wide flag.** `NEXT_PUBLIC_DEMO_MODE` (default off) controls the demo scenarios, the
  dashboard constants, and the reward copy on `/incentives` and `/routes`. Every demo surface shows a visible
  "Demo data" badge. With the flag off, none of the fabricated numbers render.
- **Emissions and safety pages.** In P4 they render approved facts with a "Sources" footnote. A page with no
  approved facts shows a "data unavailable" state — it never falls back to uncited constants.
- **Rewards.** The `/incentives` tiers ($1/$2/$4) and the `/routes` incentive line are **demo-only** until an
  approved, funded offer inventory exists (D-25). In live mode `incentiveDetails` is null and the reward UI is
  hidden.
- **Attribution.** Any page that shows sourced numbers renders the source's `attribution_text`.

### 8.3 Scheduled-trip semantics (P4)

`compare_modes` / `/v1/compare` return only trips a rider can actually board:

- **Boardable window:** the earliest usable departure is `now + access_buffer_min` (a configured walk-to-stop
  buffer). For an `arrive_by` target, choose the latest arrival ≤ target **among boardable departures** — never a
  bus that has already left (REV-06).
- **Service days:** honor `calendar` + `calendar_dates`, and include previous-service-day trips that run past
  midnight.
- **Eligibility:** respect `pickup_type`/`drop_off_type` (no boarding where boarding is not allowed).
- **No fabrication:** when there is no direct boardable trip, return a reason — `no_boardable_trip`, `no_service`,
  `transfer_required`, or `unknown_stop` — not an invented number. The first release is direct-route only and says
  so.

## 9. Scheduling and operations

| Job | Default cadence | Notes |
|-----|-----------------|-------|
| GTFS static | Daily at 03:00 local (a conditional GET makes it cheap) | Hot-swap `feed_version` |
| GTFS-RT service alerts (S-2) | Every 2–5 min | CARTA publishes **alerts only**. Vehicle positions need a partnership (03 §6). |
| SCDOT hourly counts (S-6c) | Monthly manual export → `tda inbox process` | **Volume** patterns by hour (not congestion). Expansion-stage source. |
| NTD monthly ridership | Weekly check | New months are published with a lag |
| Census ACS | Yearly (after the ACS release), plus a manual trigger | — |
| EIA gasoline | Weekly | — |
| TomTom corridor sampler | **Off. Expansion only.** | Build only if D-7 approves storage or a Traffic Stats license exists; own key |
| Metrics rebuild | After each successful ingest, plus nightly | Idempotent; reads current views |
| Weekly opportunity report | Monday 06:00 local (expansion / P5) | Draft goes to the review queue |

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
| Performance | **Targets, not guarantees.** `/api/transit-insights`: p95 under 3 s with LLM narration, under 800 ms with the template path. Data API: p95 under 300 ms on read endpoints. Confirm under load before claiming. |
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

## 12. Impact measurement (does the app shift trips off the road?)

The north star is fewer car trips, but engagement is not mode shift (REV-10). Keep four evidence tiers strictly
separate and never let a lower tier stand in for a higher one:

| Tier | What it is | Example signal | What it can claim |
|------|-----------|----------------|-------------------|
| 1. Engagement | The user interacted | `nudge_shown`, `trip_planned`, `cta_carta_fares_click` | Interest only. **Not** a trip. |
| 2. Self-reported behavior | The user says what they did | An opt-in "did you ride?" prompt | Reported behavior, with self-report bias stated |
| 3. Verified outcome | A third party confirms a trip | Partner validation, a consented pass tap | An actual transit trip occurred |
| 4. Modeled impact | Avoided vehicle-miles / CO2 | Verified trips × trip length × assumptions | Modeled reduction, with assumptions cited |

**Measured congestion is separate from all four** — it needs speeds/travel times (D-7 b/c/d), not the app's own
events.

**Attribution needs a design, not a funnel (D-26).** A raw shown→clicked funnel cannot say a trip *replaced*
driving. The pilot design (agreed at G1) must define: the eligible-trip denominator, exposure/assignment
accounting (for example a randomized holdout), duplicate handling, the outcome measure (Tier ≥ 2), and a
pre-declared decision rule. Until Tier ≥ 3 data exists, the product calls its numbers **engagement** and makes no
traffic-reduction claim.

**Privacy.** Events are aggregate and anonymous: event type, hour-truncated timestamp, route/corridor id,
variant, demo flag. No IP, no user id, no precise location. Cells with fewer than k = 10 events are suppressed.
The schema and owner are fixed in D-23/D-26.
