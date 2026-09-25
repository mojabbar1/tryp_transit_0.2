# Phase 2 — `data_agent` scaffold, storage, polite fetcher (execution prompt)

> **How to use:** once P0 is merged and Phase 2 is signed off in [05](../05-decisions-and-review.md), paste this
> whole file into your coding agent. It's parallel-safe with P0B and P1: it touches no files under `src/`.
> **Plan:** [04 → Pilot](../04-implementation-plan.md#pilot) ·
> **Design:** [02 §3–6](../02-target-architecture.md#3-service-boundaries) · **Sources:** [03](../03-data-source-catalog.md)

---

## Role and mode

You're a senior Python and data engineer creating the **foundation** of the Transit Intelligence Agent. This phase
has no LLM code and no real connectors. It delivers: a project skeleton, config, the DB schema with provenance,
the raw store, a polite HTTP client, a connector base class, the review queue, a read API, the CLI, compose, tests,
and CI. **Stop and ask** if a decision is missing.

## Preconditions

- [ ] P0 is merged (the `.gitignore` fix matters here, or new `*.json` and `*.yaml` files would go untracked).
      You're on `feat/tda-phase-2-scaffold` from the latest `main`.
- [ ] 05 sign-off records:
  - **D-1** (Charleston first, region-pluggable)
  - **D-2** (Python service)
  - **D-5** (Postgres 16)
  - **D-8** (CLI plus PR review surface)
  - **D-9** (compose worker)
  - **D-11** (harvest, don't merge)
  - **D-18** (retention and attribution policy, plus the **User-Agent contact email**)
  - **D-19** (uv and Python 3.12)
- [ ] `uv --version` works (≥ 0.4), and Docker with Compose v2 is available for DB tests.

## Read first

- [02-target-architecture.md](../02-target-architecture.md) §3–§6 and §10
- [03-data-source-catalog.md](../03-data-source-catalog.md), which provides the seed entries and the ingestion policy
- the unmerged-branch compose file, for reference only:
  `git show origin/feature/economic-incentive-improvements:deploy/docker-compose.yml`

## Scope

**In:** everything under `data_agent/`, plus the root `docker-compose.yml`, the root `.env.example`,
`contracts/data-agent.openapi.json`, and a new CI job. **Out:** real connectors (P3), metrics (P4), and the LLM or
agent (P5). Don't modify `src/` or `model_service/`.

## Tasks

### T1. Project skeleton
- `data_agent/pyproject.toml`: project `tryp-data-agent`, `requires-python = ">=3.12"`, package `tda`, script
  `tda = "tda.cli:app"`.
  - Dependencies: fastapi, uvicorn[standard], sqlalchemy>=2, alembic, psycopg[binary]>=3, pydantic>=2,
    pydantic-settings, httpx, tenacity, typer, structlog, apscheduler, pyyaml.
  - Dev: pytest, respx, ruff.
- Commit `uv.lock`, then add `README.md` and a `Dockerfile` (python:3.12-slim, non-root user, `uv sync --frozen --no-dev`).
- Add `.dockerignore`.
- Layout matches [02 §4](../02-target-architecture.md#4-target-repository-layout). Create empty packages with
  docstrings for the modules later phases fill in (`connectors/`, `metrics/`, `agent/`).

### T2. Config
- `tda/config/settings.py` (pydantic-settings, prefix `TDA_`):
  - `DATABASE_URL` (writer role, used by connectors, the worker, and tests), plus `ADMIN_DATABASE_URL` (owner,
    used by `db bootstrap` and migrations) and `READER_DATABASE_URL` (the read API). All are plain
    `postgresql://…` URLs; the driver is added in code.
  - `PROJECT_ROOT`: the absolute path of `data_agent/`. Default it to the package's parent directory, and
    **never** derive it from the current working directory. `RAW_STORE_DIR` (default `<PROJECT_ROOT>/raw`) and
    `INBOX_DIR` (default `<PROJECT_ROOT>/inbox`) are resolved from it. Both are gitignored by P0.
  - `USER_AGENT` (**must** include the D-18 contact; validate that it contains `@` or a URL)
  - `REGION` (default `charleston`)
  - `HTTP_TIMEOUT_S` (default 20)
  - `DEFAULT_RATE_LIMIT_PER_MIN` (default 30)
  - `MAX_RESPONSE_MB` (default 200)
  - `API_PORT` (default 8081)
- `tda/config/regions/charleston.yaml`:
  - `id`, `name`, `timezone: America/New_York`
  - `bbox` (tri-county; note the source in a comment)
  - `agencies` (CARTA, with the `ntd_id` from 03)
  - `corridors`: names and descriptions only, with `probe_points: []` and `status: draft`. **Don't invent
    coordinates**; a human supplies the probe points before P3.6.
- `tda/config/sources.yaml`: one entry per catalog source, every one with `status: proposed`. The fields are those
  of the `source` table in [02 §6](../02-target-architecture.md#6-data-model-schema-tda).
- `tda/config/models.py`: Pydantic models for region and source. HTML and PDF kinds require
  `robots_required: true`. `store_policy` must match `none | ttl:<int>d | indefinite`.

### T3. Database
- SQLAlchemy 2 models (schema `tda`) for `source`, `fetch_run`, `fact`, `metric_value`, `review_item`, and
  `agent_run`, with the columns in 02 §6. That includes `fetch_run.acquisition` (`http` | `manual`),
  `supplied_by`, `original_url`, the `manual` source kind, and `fetch_run.status` including `rolled_back`. Use
  JSONB and arrays where specified, and UTC `timestamptz` everywhere.
- **Append-only observations (02 §6.0/§6.1 invariants):** normalized observation tables that connectors add (P3)
  are never updated or deleted in place. Every row carries its natural key, a `content_hash`, and its
  `fetch_run_id`. For each observation table, ship a `current_<table>` view that selects the row from the latest
  successful, **non-`rolled_back`** run per natural key. The base tables in this phase follow the same rule.
- **Versioned facts:** `fact` is immutable per version. Add `version`, `supersedes_id`, and `derived_from`
  (the run/observation ids a fact was computed from), and include `needs_review` in the status enum. A correction
  writes a new version that supersedes the old one; rows are never mutated.
- **Roles:** `docker/postgres/init/01-roles.sql` creates `tda_owner` (owns the schema and runs migrations),
  `tda_writer` (connectors and the review runtime), and `tda_reader` (the read API). Migrations run as `tda_owner`.
- **Bootstrap:** `tda db bootstrap` connects with the admin/owner URL and creates the schema, roles, and base
  grants; `alembic upgrade head` then runs the migrations. Alembic setup has a baseline revision, and each
  revision implements a working `downgrade()`.
- **Grant policy:**
  - `tda_reader` gets **explicit** `SELECT` grants, and only on API-exposed tables and views. In this phase that's
    `fact`, `metric_value`, `source`, the `current_*` views, and the **`source_freshness`** view.
  - **Never use default privileges.**
  - Every later migration that adds an API-exposed table or view must add its grant in the same revision, and
    document that rule in `data_agent/README.md`.
  - The reader has no access to `review_item`, `agent_run`, or `fetch_run`.
- **Freshness view:** `source_freshness` exposes per-source `{last_success, cadence, stale}`, granted to the reader
  and used by `/v1/health`.

### T4. Raw store
`tda/store/raw_store.py`:
- `put(source_id, run_id, content: bytes | stream, ext)` → `RawRef(uri, sha256, size)`, at
  `raw/<source>/<yyyy>/<mm>/<dd>/<run_id>.<ext>`.
- `enforce_retention(source_cfg)` deletes snapshots older than the TTL. `none` means don't persist the raw body at
  all, and store only the checksum.

### T5. Polite HTTP client (`tda/http/polite_client.py`)
- **robots.txt** (RFC 9309): cache it per host for 24 h. Use `urllib.robotparser` with the configured UA.
  Unavailable (4xx) → allowed. Unreachable (5xx or network error) → **disallowed** for HTML and PDF sources.
- **Rate limit:** a per-host token bucket, with a per-source override.
- **Retries:** tenacity with exponential backoff and jitter on 429 and 5xx, honoring `Retry-After`, up to 4 attempts.
- **Conditional GET:** accept the prior `etag` and `last_modified`, and return `NotModified` on 304.
- **Guards:** stream the body and abort past `MAX_RESPONSE_MB`; enforce the timeouts; send the UA on every request.
- Never follow redirects to a different host unless the source config lists it in `allowed_hosts`.

### T6. Connector base (`tda/connectors/base.py`)
- Define `Connector.fetch() → FetchResult`, `normalize(raw) → Iterable[Row]`, and `load(rows, run) → LoadStats`.
- `run(live: bool)` orchestrates the fetch, then writes a `fetch_run` row. Its status is one of `success`,
  `not_modified`, `failed`, `skipped_robots`, `skipped_budget`, or `skipped_disabled`.
- Runs are idempotent: if the `sha256` equals the last successful run's, skip the load.
- `status != approved` → `skipped_disabled`, **always**.
- **Rollback hook (by status, never destructive):** each connector declares the tables it loads (`owned_tables`).
  `rollback(run_id, dry_run)`:
  1. Marks the `fetch_run` `rolled_back` (its observation rows stay; the `current_*` views stop selecting them).
  2. Recomputes any `metric_value` rows derived from that run from the new current observations.
  3. Sets dependent **approved** facts to `needs_review` (it never deletes a fact or an observation).
  4. Keeps the raw snapshot.

  Expose it as `tda runs rollback <run-id> [--dry-run | --confirm]`. `--dry-run` lists what would change.
- Add an example `EchoConnector` used only in tests.
- Add a manual-acquisition path for inbox files: `run_manual(path, meta)` records `acquisition=manual`,
  `supplied_by`, and `original_url` from a required sidecar `<file>.meta.yaml`. P3 builds `tda inbox process` on
  top of it.

### T7. Review queue (`tda/review/queue.py`)
- Define `submit`, `approve`, `reject`, `list`, and `show`, enforcing the state machine in
  [02 §7.4](../02-target-architecture.md#74-human-in-the-loop-workflow).
- Approving a `fact` item sets `fact.status = approved`, `reviewed_by`, and `reviewed_at`.
- **Sources are approved only by PR to `sources.yaml`.** Approving a source proposal writes a suggested YAML
  snippet to `data_agent/proposals/sources/<id>.yaml`; it doesn't enable anything.

### T8. Read API (`tda/api/`)
FastAPI endpoints:
- `GET /v1/health`: DB ping, plus per-source `{last_success, cadence, stale: bool}` read from the
  `source_freshness` view.
- `GET /v1/sources`: approved sources' public fields and `attribution_text`.
- `GET /v1/facts`: approved facts only (current version), filterable by `key_prefix`, `geography`, `limit`, and
  `cursor`.

Also:
- Wire the API to the `tda_reader` role in the connection string.
- `tda api openapi` writes `contracts/data-agent.openapi.json`, and the file is committed.

### T9. CLI (`tda/cli.py`, Typer) — one sub-app per module
Compose the root `app` from Typer sub-apps so each module owns its commands:
- `db`: `bootstrap`, `upgrade`, `downgrade`
- `sources`: `list`, `validate`, `sync`
- `ingest`: `<id> [--live]`
- `runs`: `rollback <run-id> [--dry-run|--confirm]`, `list`, `show`
- `review`: `list`, `show`, `approve`, `reject`
- `api`: `serve`, `openapi`
- `retention`: `run`
- `scheduler`: `run` (loads jobs from approved sources' cadences; there are none until P3)

### T10. Compose (repo root)
- `docker-compose.yml` services:
  - `postgres` (16-alpine, healthcheck, volume, init scripts)
  - `data-agent-migrate` (one-shot): runs `tda db bootstrap` with the owner URL, then `alembic upgrade head`, then
    exits. The API and worker `depends_on` it completing successfully.
  - `data-agent-api` (port 8081, reader/writer URL)
  - `data-agent-worker`
- **No `model-service`.** After P1 the live app never calls it (A3), and whether to keep it at all is decided at
  the G1 gate (D-10). Leave `web` out too.
- **Connection URLs are plain `postgresql://…` (psql-style)**, not SQLAlchemy driver URLs; the app adds the driver
  in code. Provide separate owner, writer, and reader URLs.
- A root `.env.example` with placeholders only. No real passwords.
- Harvest ideas from the unmerged branch's compose file, but **don't** merge that branch or copy its credentials.

### T11. Tests and CI
Tests:
- polite client (`respx`): robots deny, robots 4xx → allow, 429 with Retry-After → retry, 304 → NotModified,
  oversize → abort, cross-host redirect → blocked
- raw store: layout and retention
- source and region config validation, including a failing fixture
- review state transitions, including illegal ones
- connector base idempotency, using `EchoConnector`
- **append-only + current view:** a second load of changed content adds a row; `current_<table>` returns only the
  latest run's row; a `rolled_back` run drops out of the view
- **rollback by status:** `--dry-run` lists changes; `--confirm` marks the run `rolled_back`, recomputes metrics,
  and sets a dependent approved fact to `needs_review`; **nothing is deleted**
- **fact versioning:** a correction writes a new version with `supersedes_id` set; the API returns only the current
  version
- API: health (from `source_freshness`), sources, and facts, which must never return non-approved facts
- **Reader-role integration:** the API runs its queries as `tda_reader`, and a write attempt fails with a
  permission error
- **Paths:** `git check-ignore data_agent/raw/x data_agent/inbox/x` succeeds, and the settings resolve the same
  paths whether you run from the repo root or from `data_agent/`

DB-backed tests are marked `@pytest.mark.db`. They are **skipped** when `TDA_TEST_DATABASE_URL` is unset, but if
**`TDA_REQUIRE_DB_TESTS=1`** they must run (a skip is a failure) — CI sets it so the grant/role/append-only tests
can't be silently skipped.

CI: add a `data-agent` job to `.github/workflows/ci.yml` with a Postgres 16 service and `astral-sh/setup-uv`, with
`TDA_REQUIRE_DB_TESTS=1`. Run:
- `uv sync --frozen`
- `uv run ruff check .`
- `uv run ruff format --check .`
- `uv run tda db bootstrap && uv run alembic upgrade head`
- `uv run pytest -q`

## Constraints

- No network access in tests. No real API keys anywhere.
- Every external request goes through the polite client; a Ruff rule or a test forbids importing `requests`.
- All timestamps are UTC. Region-local time exists only in metrics and presentation (P4).
- Keep the modules small and typed. Public functions have docstrings.

## Verification (paste the output into the PR)

```bash
cd data_agent && uv sync && uv run ruff check . && uv run ruff format --check . && uv run pytest -q
cd .. && docker compose up -d postgres && sleep 5
set -a && . ./.env && set +a    # local .env copied from .env.example; exports the owner/writer/reader URLs
(cd data_agent && uv run tda db bootstrap && uv run alembic upgrade head && uv run tda sources validate && uv run tda sources list)
(cd data_agent && uv run tda api serve --port 8081 &) ; sleep 3 ; curl -s localhost:8081/v1/health | jq -e '.status=="ok"'
(cd data_agent && uv run tda api openapi) && git diff --stat contracts/
docker compose down
```

Expected: every check passes, health returns `"status": "ok"`, `sources list` shows every source as `proposed`,
and the OpenAPI snapshot is committed.

## Definition of done

- [ ] The CI `data-agent` job is green (with `TDA_REQUIRE_DB_TESTS=1`), alongside the existing web jobs.
- [ ] `tda ingest <any-proposed-source>` logs `skipped_disabled` and makes no network call; a test covers this.
- [ ] `tda runs rollback` marks the run `rolled_back` and sets dependent approved facts to `needs_review` **without
      deleting anything**; a test covers this.
- [ ] `/v1/facts` never returns `candidate`, `rejected`, or superseded facts; a test covers this.
- [ ] `data_agent/README.md` documents setup, `db bootstrap`, the CLI sub-apps, the grant-per-migration rule, and
      how to approve a source (via PR).

## Rollback

The phase is self-contained. Revert the PR and `docker compose down -v` to drop the local volume.

## Handoff

- In [../README.md](../README.md), set P2 to Done.
- For P3: list the sources awaiting human approval, and the corridors awaiting probe points.
