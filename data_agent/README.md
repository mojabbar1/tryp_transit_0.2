# Tryp data agent (`tda`)

The provenance-first data service behind Tryp Transit. It ingests public sources politely, keeps observations
append-only, promotes numbers to **versioned, citable facts** through human review, and serves only approved
facts through a read-only API. Design: [`docs/transit-data-agent/02-target-architecture.md`](../docs/transit-data-agent/02-target-architecture.md).

P2 is the scaffold. It has no real connectors (P3), no metrics (P4), and no LLM code (P5). Every source in
`tda/config/sources.yaml` is `proposed`, so nothing is fetched.

## Setup

Requires [uv](https://docs.astral.sh/uv/) ≥ 0.4. It installs Python 3.12 for you. The DB commands and DB tests also
need Docker with Compose v2.

```bash
cd data_agent
uv sync                      # creates .venv from uv.lock
uv run ruff check . && uv run ruff format --check .
uv run pytest -q             # DB tests skip unless TDA_TEST_DATABASE_URL is set
```

### Tests against Postgres

DB tests need a **disposable** database whose name ends in `_test`: every session drops and rebuilds schema
`tda` from the current migrations. With `TDA_REQUIRE_DB_TESTS=1` (as in CI) a DB test that would skip fails.

```bash
docker run --rm -d --name tda-pg-test -p 55432:5432 \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=tda_test postgres:16-alpine
TDA_TEST_DATABASE_URL=postgresql://postgres@localhost:55432/tda_test TDA_REQUIRE_DB_TESTS=1 uv run pytest -q
docker stop tda-pg-test
```

## Local stack (repo root)

```bash
cp .env.example .env         # then set every empty password (e.g. `openssl rand -hex 24`)
docker compose up -d postgres
set -a && . ./.env && set +a # exports the owner, writer, and reader URLs for the host
(cd data_agent && uv run tda db bootstrap && uv run alembic upgrade head)
docker compose up -d --build # data-agent-migrate (one-shot), data-agent-api on 127.0.0.1:8081, data-agent-worker
```

`docker compose down` stops the stack; `docker compose down -v` also deletes the local volumes (all local data).
The stack has no web app and no model-service (D-10 decides model-service at G1).

## Roles, bootstrap, and the grant-per-migration rule

Three roles (02 §6.2), all configured as plain `postgresql://` URLs (the code adds the driver):

| Role | Setting | Used by | Can |
|---|---|---|---|
| `tda_owner` | `TDA_ADMIN_DATABASE_URL` (or a superuser) | `db bootstrap`, migrations | own every object in schema `tda` |
| `tda_writer` | `TDA_DATABASE_URL` | connectors, worker, review CLI | read and append; update only where the guards allow (finishing a run, status moves, source sync) |
| `tda_reader` | `TDA_READER_DATABASE_URL` | the read API | `SELECT` on API-exposed objects only |

`tda db bootstrap` is idempotent: it creates missing roles (when the admin may; passwords travel only as SCRAM
verifiers), the `tda` schema owned by `tda_owner`, and schema grants. Migrations always run **as `tda_owner`**
(`SET ROLE` for a superuser), so the owner owns everything.

**Grant-per-migration rule.** There are no default privileges. Every migration that adds a table or view grants
access to it **in the same revision**: the writer gets what it needs, and `tda_reader` gets `SELECT` only on
objects the API (P4) or the agent's `QueryService` (P5) reads. Extend
`tests/db/test_schema.py::test_reader_sees_only_api_exposed_objects` whenever the reader gains an object.

**History is never deleted.** Triggers refuse `DELETE`/`TRUNCATE` on history tables (even for the owner),
`metric_value` and observation tables are append-only, a fact version is immutable, and a finished run only
moves `success → rolled_back`. A fact's `published_at` is stamped by the database the first time it is
published and never changes, and a partial unique index allows one `approved` version per key. New observation tables use `tda.store.observations.observation_table_ddl()`,
which adds the append-only guard and a `current_<table>` view over the latest successful run.

## CLI

`tda` is composed of one Typer sub-app per module (`tda --help`). Expected failures print one `error:` line and
exit 2; logs go to stderr (`TDA_LOG_JSON=true` for JSON lines).

| Command | What it does |
|---|---|
| `tda db bootstrap \| upgrade [rev] \| downgrade [rev] --confirm` | roles and schema; migrations (a downgrade drops tables, hence `--confirm`) |
| `tda sources list \| validate \| sync` | the registry; validate `sources.yaml` and the region; mirror into `tda.source` (removed sources become `disabled`) |
| `tda ingest <id> [--live]` | run one source (below) |
| `tda runs list \| show <id> \| rollback <id> (--dry-run \| --confirm)` | fetch runs and non-destructive rollback |
| `tda review list [--markdown] \| show \| approve [--by] \| reject --notes` | the human review queue (D-8) |
| `tda api serve [--host] [--port] \| openapi` | the read API; write `contracts/data-agent.openapi.json` |
| `tda retention run [--source] [--dry-run]` | delete raw snapshots past their TTL |
| `tda scheduler run [--once]` | the worker: approved sources on their cron cadences (UTC), plus daily retention |

### Ingest, statuses, and the network switch

Every attempt writes one `fetch_run` row:
- A source that isn't `approved` is `skipped_disabled`, **always**, and nothing is fetched.
- `--live` is the only switch that lets a connector reach the network. Without it an approved source is not
  fetched and nothing is recorded (`not_live`).
- Other outcomes: `success`, `not_modified` (a 304, or the same sha256 as the last success: nothing is loaded),
  `failed` (fetch error or a failed data-quality check: nothing is loaded; the raw snapshot is kept as evidence),
  `skipped_robots`, and `skipped_budget`.
- The load and the `success` update commit together, so there are no partial loads.

All HTTP goes through `tda.http.polite_client` (Ruff bans `requests`, `urllib.request`, `http.client`, and direct
`httpx` clients elsewhere). It checks robots.txt for `robots_required` sources with an RFC 9309 matcher
(`tda.http.robots`: `*`/`$` patterns, merged groups, longest match, component-aware percent-encoding, and
linear-time matching), paces requests per host, retries 429/5xx
with backoff (honoring `Retry-After`), sends conditional GETs, caps body size and total time (robots.txt
included), sends the contact User-Agent (D-18), and never leaves the source's host and `allowed_hosts`. The
worker shares one client across all jobs, so pacing and the 24 h robots cache span runs.

A `not_modified` run records the success of the **same source** that it confirms (`validates_run_id`, a
composite foreign key plus a guard); it counts toward freshness only while that run is still a success, and a
304 with no usable prior success is `failed`.

Human-supplied files use `Connector.run_manual(path)` with a required `<file>.meta.yaml` sidecar
(`supplied_by`, `original_url`); P3 adds `tda inbox process`.

### Rollback (by status; nothing is deleted)

`tda runs rollback <id> --dry-run` lists what would change; `--confirm` applies it in one transaction:
1. The run becomes `rolled_back`; its rows stay, and the `current_*` views fall back to the previous run.
2. Current metrics that used the run are recomputed from the current views (`tda.metrics.registry`), or
   withdrawn (a NULL value appended) if the metric has no definition yet.
3. Approved facts that cite the run become `needs_review`.
4. The raw snapshot is kept.

Lineage convention: a fact lists every run it depends on, transitively, in `derived_from.input_run_ids`.

Rollback and publishing are safe to run concurrently (`tda.store.lineage`): rollback holds `FOR UPDATE` on its
run, while approving or auto-publishing a fact, or recording a metric (`record_metric`), first takes `FOR SHARE`
on every input run and refuses one that isn't a `success`. Whichever commits first wins; the other sees it.
`current_metric_value` also hides a latest value unless every input run exists and is a success (it never
revives an older value), and a trigger plus a CHECK refuse recording a metric with a missing, NULL, or
non-success input. Rollbacks are serialized by one global transaction lock (so recomputations that share
inputs can't deadlock) and are retried as a whole on a deadlock or serialization failure.

### Approving a source (by PR only)

A source runs only when `tda/config/sources.yaml` says `status: approved`, and that changes **only in a reviewed
PR**:
1. Re-verify the source with the [03 §5 checklist](../docs/transit-data-agent/03-data-source-catalog.md) and
   complete its entry (terms, `store_policy` with a reason, `attribution_text`, cadence).
2. In the PR, set `status: approved` with `terms_reviewed_by` and `terms_reviewed_at` (validation refuses an
   approval without them).
3. After merge, `tda sources sync` mirrors it into the database.

A `source` item in the review queue (for example an agent's proposal) enables nothing: approving it only writes a
suggested entry to `data_agent/proposals/sources/<id>.yaml` to copy into such a PR.

### Facts and review

A fact is never edited. `tda.facts.versions.write_fact()` inserts the next version with `supersedes_id` set;
approving a version supersedes the key's other published versions, so exactly one version is current. Facts
arrive as `candidate` (or `approved` when a reviewed rule auto-publishes) and are approved or rejected with
`tda review`.

## Connectors (P3)

A source runs only after the maintainer signs its row in
[05 §6](../docs/transit-data-agent/05-decisions-and-review.md) and its connector PR sets `status: approved`, with
the live smoke-test output. Until then, `tda ingest <id>` records `skipped_disabled`.

### `gtfs_static` (S-1, `carta-gtfs`): CARTA's GTFS schedule

- **Loads** each changed feed (a new zip sha256) as a new `gtfs_feed_version` plus seven append-only tables:
  `gtfs_stop`, `gtfs_route`, `gtfs_trip`, `gtfs_stop_time`, `gtfs_calendar`, `gtfs_calendar_date`, and
  `gtfs_shape`. Every natural key includes `feed_version_id`. Read them through the `current_gtfs_*` views; the
  reader role can't see the base tables.
- **Activation** is an append-only log (`gtfs_feed_activation`), not a mutable flag. A new feed activates in the
  load transaction if its service has started in the agency's time zone. `current_gtfs_feed_version.is_active`
  marks the newest activation whose load is still valid, so rolling back a feed's run makes the previous feed
  active again. Every version whose load succeeded stays current, including an earlier load of the same zip (A,
  B, then A again is three versions), so any of them can be activated by id. Activations of a source are
  serialized and ordered by id, which is commit order, not transaction start time. `tda gtfs versions` lists the
  versions; `tda gtfs activate <id> [--by NAME]` switches the active one.
- **Data-quality checks** (any failure → `failed`, nothing loaded, raw zip kept as evidence):
  - the required files are present, with calendar and/or calendar_dates;
  - there is at least one stop, and each table's keys are unique;
  - there are no orphan stop_times (trip or stop) and no orphan trips (route);
  - times are `H:MM:SS`, with 24:00:00 and later allowed;
  - required times are present: `arrival_time` at each trip's first and last stop, and both times at every exact
    timepoint (`timepoint` 1, or empty, which GTFS treats as exact). Only approximate stops (`timepoint` 0) may
    leave them blank;
  - features this loader doesn't store are refused, not dropped: GTFS-Flex (Flex fields in stop_times, or Flex
    files with rows) and headway-based trips (`frequencies.txt` with rows). Header-only files, as in CARTA's feed,
    are fine;
  - dates are `YYYYMMDD`, with start ≤ end;
  - coordinates are in range;
  - the zip declares ≤ 512 MB unpacked. That limits the archive, not memory: parsing is in memory, and the #17
    reviewer measured about 664 MiB peak RSS on a synthetic feed of CARTA's size (148,842 stop times).
- **Idempotent:** a 304 or the same sha256 is `not_modified`. The real CARTA feed (148,842 stop times) loads in
  about 15 s.
- **Run it:** `tda ingest carta-gtfs --live`, once the source is enabled. Tests use the synthetic feed in
  `tests/fixtures/carta-gtfs/`.

### `ntd_monthly` (S-3, `ntd-monthly`): FTA National Transit Database monthly ridership

- **Fetches** every monthly row for the region agency's NTD ID (CARTA: `ntd_id='40110'`, from
  `regions/charleston.yaml`; never the display name) from Socrata `8bui-9xvu`:
  - It pages with `$limit`/`$offset` under a total `$order`, and sends `X-App-Token` only if
    `TDA_SOCRATA_APP_TOKEN` is set. The polite client never sends such headers across a redirect to another
    host.
  - It combines the pages into one canonical JSON body, so an unchanged week has the same sha256 and is
    `not_modified`.
- **Loads** append-only `ridership_monthly` rows keyed by (ntd_id, mode, tos, month); read them via
  `current_ridership_monthly`.
- **Data-quality checks** (a failure → `failed`, nothing loaded):
  - there is at least one row, and each has the expected `ntd_id`, a mode, a type of service, and a
    first-of-month date;
  - counts are non-negative, and UPT and VOMS are whole numbers;
  - keys are unique.
  Month gaps per mode and type of service are logged (`ntd.month_gaps`). All 790 real CARTA rows
  (2002-01 to 2026-07) pass.
- **Facts** (`tda/facts/rules/ntd_monthly.py`, auto-published because NTD is public domain):
  - `carta.ridership.upt.monthly.<mode>` (the latest **complete** month; types of service summed) and
    `….yoy_pct` (versus the same month a year earlier, which must also be complete). A month where any type of
    service has an unknown (null) UPT is logged (`ntd.incomplete_period`) and not published, so a partial sum is
    never presented as an all-service total.
  - They are published in the load transaction after the run is marked a success (the connector's `publish`
    hook). Each fact cites the runs its rows actually came from (both months for `yoy_pct`, which can differ),
    and those runs are locked `FOR SHARE` first; a rolled-back input fails the load instead of publishing.
  - Publication is serialized per source (a transaction-scoped lock taken before reading), so a slower run
    can't publish over a newer one.
  - A fact gets a new version only when its value, period, or unit changes. Rolling back any cited run flags
    the fact `needs_review`.
  - A correction that leaves a key without a valid value (for example, a null count now in the year-earlier
    month) moves its approved fact to `needs_review` in the same step (`ntd.facts_withdrawn`), keeping the
    version; the next complete publication supersedes it.

### `gtfs_rt_alerts` (S-2, `carta-gtfs-rt-alerts`): CARTA's GTFS-realtime service alerts

- **Fetches** the alerts feed every 5 minutes over https (the catalog listed http; https works, 05 §6a).
- **Canonical snapshot:** the stored raw snapshot is the whole message with the header timestamp cleared and
  entities sorted by id (unknown fields and extensions kept), serialized deterministically. An unchanged set of
  alerts has the same sha256 and is `not_modified`.
  - Deterministic means repeatable for the pinned protobuf runtime, not a universal canonical form; an upgrade
    may cost one extra load.
  - A body that doesn't decode, or lacks required fields, is stored as it came, so a failed run keeps the
    evidence.
- **Loads** one append-only `service_alert` row per alert:
  - typed columns: cause, effect, severity, the active window, active/communication/impact periods, informed
    entities (with modified trips), and the header, description and url translations;
  - **the complete alert as JSON**, so no field the feed sends is dropped.

  `current_service_alert` is the latest successful snapshot, so an alert that ends drops out; rolling that
  snapshot back restores the previous one.
- **Untrusted text** (02 §7.3): alert text is stored as data only, and nothing interprets it.
- **Data-quality checks** (a failure → `failed`, nothing loaded; the previous snapshot stays current):
  - the body is a GTFS-realtime FeedMessage (version 1.0 or 2.0) with every required field and a FULL_DATASET
    header;
  - every entity has a unique id and carries an alert and no other payload, and isn't deleted;
  - each alert has an informed entity. Each one selects something real: empty IDs and empty trips don't
    count, and a direction_id needs a route_id;
  - every active, communication and impact period has a bound, each bound is a valid time, and start ≤ end;
  - no text contains a NUL character.
  Routes and stops that the active GTFS feed doesn't have are logged (`gtfs_rt.unknown_references`), not fatal.
- Raw snapshots are kept 30 days (`ttl:30d`); normalized alerts are kept.

## Read API

`tda api serve` runs FastAPI as `tda_reader`, in read-only sessions:
- `GET /v1/health`: a DB ping plus per-source freshness from the `source_freshness` view; `ok`, `degraded` (an
  approved source is stale), or 503 `unavailable`.
- `GET /v1/sources`: approved sources and their `attribution_text`.
- `GET /v1/facts`: current approved facts only; `key_prefix`, `geography`, `limit` (≤ 500), and `cursor`. Each
  cited source carries `retrieved`: the UTC date of the newest successful input run from it, read from the
  reader-safe `fact_source_retrieval` view (the reader never sees `fetch_run`).

`contracts/data-agent.openapi.json` is generated by `tda api openapi` and committed; a test fails on drift.

## Raw snapshots and retention

Raw bodies land at `raw/<source>/<yyyy>/<mm>/<dd>/<run_id>.<ext>` (UTC; read-only; never overwritten).
`store_policy: none` keeps only the checksum, `ttl:<N>d` keeps N days, and `indefinite` keeps everything. Snapshots
cited by any fact version that was **ever** published (`published_at`) are kept regardless of TTL, even if that
version was later rejected. `raw/` and `inbox/` are gitignored and resolve under
`data_agent/` wherever you run from.

## Layout

```
tda/
  config/       settings (TDA_*), sources.yaml, regions/, validation, `tda sources`
  store/        engines, bootstrap, ORM mirror, observations, raw store, retention, source sync, `tda db|retention`
  http/         the polite client
  connectors/   Connector base, rollback, registry, connectors (P3), `tda ingest|runs|gtfs`
  facts/        fact versions
  metrics/      metric registry (empty until P4)
  review/       the review queue, `tda review`
  api/          the read API, OpenAPI snapshot, `tda api`
  pipelines/    ingest (shared by CLI and worker), scheduler
migrations/     Alembic (runs as tda_owner)
tests/          unit/, db/ and connectors/ (need Postgres), support/ (EchoConnector, factories), fixtures/
```
