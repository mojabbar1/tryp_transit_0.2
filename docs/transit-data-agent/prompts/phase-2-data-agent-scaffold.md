# Phase 2 — `data_agent` scaffold, storage, polite fetcher (execution prompt)

> **How to use:** once P0 is merged and Phase 2 is signed off in [05](../05-decisions-and-review.md), paste this
> whole file into your coding agent. It's parallel-safe with P0B and P1: it touches no files under `src/`.
> **Plan:** [04 §Phase 2](../04-implementation-plan.md#phase-2--data_agent-scaffold-storage-polite-fetcher-parallel-safe-with-p1) ·
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
  - `DATABASE_URL`
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
  `supplied_by`, and `original_url`, and the `manual` source kind. Use JSONB and arrays where specified, and UTC
  `timestamptz` everywhere.
- Alembic setup with a baseline revision. Each revision must implement a working `downgrade()`.
- `docker/postgres/init/01-roles.sql` creates the `tda_writer` and `tda_reader` roles.
- **Grant policy:**
  - `tda_reader` gets **explicit** `SELECT` grants, and only on API-exposed tables. In this phase that's `fact`,
    `metric_value`, and `source`.
  - **Never use default privileges.**
  - Every later migration that adds an API-exposed table must add its grant in the same revision, and document
    that rule in `data_agent/README.md`.
  - The reader has no access to `review_item`, `agent_run`, or `fetch_run`.

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
- **Rollback hook:** each connector declares the tables it loads (`owned_tables`). `rollback(run_id, dry_run)`
  does the following:
  1. Lists the rows tagged with that `fetch_run_id`, plus the dependent `metric_value` and `fact` rows.
  2. **Refuses** if any dependent fact is `approved`, unless an `approval_review_id` is passed.
  3. Deletes in one transaction.
  4. Keeps the raw snapshot and marks the run `rolled_back`.

  Expose it as `tda ingest rollback <run-id> [--dry-run | --confirm] [--approval-review-id ID]`.
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
- `GET /v1/health`: DB ping, plus per-source `{last_success, cadence, stale: bool}`.
- `GET /v1/sources`: approved sources' public fields and `attribution_text`.
- `GET /v1/facts`: approved facts only, filterable by `key_prefix`, `geography`, `limit`, and `cursor`.

Also:
- Wire the API to the `tda_reader` role in the connection string.
- `tda api openapi` writes `contracts/data-agent.openapi.json`, and the file is committed.

### T9. CLI (`tda/cli.py`, Typer)
Commands: `db upgrade|downgrade`, `sources list|validate|sync`, `ingest <id> [--live]`,
`ingest rollback <run-id> [--dry-run|--confirm]`, `review list|show|approve|reject`, `api serve|openapi`,
`retention run`, and `scheduler run`. The scheduler loads jobs from approved sources' cadences; there are none
until P3.

### T10. Compose (repo root)
- `docker-compose.yml` services:
  - `postgres` (16-alpine, healthcheck, volume, init scripts)
  - `data-agent-api` (port 8081)
  - `data-agent-worker`
  - `model-service` (5001)
- Leave `web` out for now.
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
- rollback: dry-run lists rows; `--confirm` deletes in one transaction; refused when an approved fact depends on it
- API: health, sources, and facts, which must never return non-approved facts
- **Reader-role integration:** the API runs its queries as `tda_reader`, and a write attempt fails with a
  permission error
- **Paths:** `git check-ignore data_agent/raw/x data_agent/inbox/x` succeeds, and the settings resolve the same
  paths whether you run from the repo root or from `data_agent/`

Mark DB tests `@pytest.mark.db`, and skip them when `TDA_TEST_DATABASE_URL` is unset.

CI: add a `data-agent` job to `.github/workflows/ci.yml` with a Postgres 16 service and `astral-sh/setup-uv`. Run:
- `uv sync --frozen`
- `uv run ruff check .`
- `uv run ruff format --check .`
- `uv run alembic upgrade head`
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
set -a && . ./.env && set +a    # local .env copied from .env.example; exports TDA_DATABASE_URL (writer role)
(cd data_agent && uv run tda db upgrade && uv run tda sources validate && uv run tda sources list)
(cd data_agent && uv run tda api serve --port 8081 &) ; sleep 3 ; curl -s localhost:8081/v1/health | jq .
(cd data_agent && uv run tda api openapi) && git diff --stat contracts/
docker compose down
```

Expected: every check passes, health returns `"status": "ok"`, `sources list` shows every source as `proposed`,
and the OpenAPI snapshot is committed.

## Definition of done

- [ ] The CI `data-agent` job is green, alongside the existing web jobs.
- [ ] `tda ingest <any-proposed-source>` logs `skipped_disabled` and makes no network call; a test covers this.
- [ ] `/v1/facts` never returns `candidate` or `rejected` facts; a test covers this.
- [ ] `data_agent/README.md` documents setup, the CLI, and how to approve a source (via PR).

## Rollback

The phase is self-contained. Revert the PR and `docker compose down -v` to drop the local volume.

## Handoff

- In [../README.md](../README.md), set P2 to Done.
- For P3: list the sources awaiting human approval, and the corridors awaiting probe points.
