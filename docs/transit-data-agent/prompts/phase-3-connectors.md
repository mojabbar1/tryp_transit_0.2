# Phase 3 — Core connectors (execution prompt, **one PR per connector**)

> **How to use:** once P2 is merged, run this prompt once per connector, in priority order. Set
> `CONNECTOR=<id>` from the table in §B, and a human must have signed off that connector's row in
> [05](../05-decisions-and-review.md).
> **Plan:** [04 → Pilot](../04-implementation-plan.md#pilot) ·
> **Sources:** [03](../03-data-source-catalog.md) · **Design:** [02 §5–6](../02-target-architecture.md#5-data-flow)

---

## Role and mode

You're a senior data engineer adding **one deterministic connector**, built on the P2 base class. There's no LLM
anywhere in this phase. **Stop and ask** if the re-verification (step A1) contradicts the catalog, if the terms are
unclear, or if the source's decision (for example D-7) isn't recorded.

## Preconditions

- [ ] P2 is merged, and the CI `data-agent` job is green. You're on `feat/tda-phase-3-<connector>` from `main`.
- [ ] The row for `<connector>` in 05 is signed off, including any needed key (for example, `TDA_CENSUS_API_KEY` or
      `TDA_EIA_API_KEY` in the local `.env` only).
- [ ] For `tomtom_sampler`: D-7 records a legal approval or a license. **Otherwise, don't build it.**

## A. Common procedure (every connector)

1. **Re-verify the source** using the [03 §5 checklist](../03-data-source-catalog.md#5-per-source-verification-checklist-copy-into-each-connector-pr).
   Record the exact URL, params, auth, terms, and today's date in the PR. If anything changed since 2026-09-24,
   update the catalog in the same PR.
2. **Schema:** add the domain tables for this connector, as an Alembic revision with a working `downgrade()`.
   Observation tables are **append-only** (natural key + `content_hash` + `fetch_run_id`); the same revision adds a
   `current_<table>` view over the latest successful, non-`rolled_back` run. If a table or view will be read by the
   API (P4) or the agent's `QueryService` (P5), the **same revision** adds `GRANT SELECT … TO tda_reader`. Extend
   the reader-role integration test to cover it.
3. **Connector:** `tda/connectors/<name>.py` subclasses `Connector` and implements `fetch`, `normalize`, and `load`.
   It declares `owned_tables` for the P2 rollback hook. All HTTP goes through the polite client. It must be
   idempotent: the same checksum means no load. **Loads are append-only** — insert a new observation row keyed by
   natural key + `content_hash` + `fetch_run_id`; never update or delete rows in place. Readers use the
   `current_<table>` views.
4. **Validation:** write explicit data-quality checks. A failing check marks the `fetch_run` `failed` and loads
   nothing. There are no partial loads, so wrap each load in a transaction.
5. **Facts (only if the spec lists them):** deterministic promotion rules in `tda/facts/rules/<name>.py`. Rules are
   code, reviewed in the PR. A fact is written as a new immutable version (`version`, `supersedes_id`). Official
   public-domain statistics can use `auto_publish: true`. Everything else becomes a `candidate`.
6. **Fixtures:** put a **trimmed** real sample (only if the license allows it) or a synthetic sample in
   `data_agent/tests/fixtures/<source_id>/`. Test normalize, validate (pass and fail), load, idempotency, the 304
   path, **append-only re-load (`current_<table>` shows the latest row)**, **`tda runs rollback` (dry-run and
   confirm)**, and the fact rules. **No network access in tests.**
7. **Config:** complete the source's `sources.yaml` entry: `terms_url`, `terms_summary`, `store_policy` with a
   justification, `attribution_text`, and `cadence`. Leave `status: proposed` until the human's terms review and
   sign-off are recorded in 05 §6. The flip to `approved` then lands in this PR, citing that record. The human
   commits it, or the builder does so on the recorded sign-off.
8. **Docs:** add a section to `data_agent/README.md` for this connector, covering what it loads, the DQ checks,
   and how to run it.

## B. Connector specs (priority order)

The **Stage** column says when a connector is needed: **Pilot** connectors gate the G1 pilot (build these first),
**Optional** connectors ship only if their approval/license lands, and **Expansion** connectors are Stage 3+.

| # | `CONNECTOR` | Stage | Source | Tables | DQ checks | Facts |
|---|-------------|-------|--------|--------|-----------|-------|
| 3.1 | `gtfs_static` | Pilot | S-1 | `gtfs_feed_version`, `gtfs_{stop,route,trip,stop_time,calendar,calendar_date,shape}` | Required files are present; stop_times → trips and stops have no orphans; times parse (allow ≥ 24:00:00); feed dates are valid; stops > 0 | none (P4 metrics) |
| 3.2 | `ntd_monthly` | Pilot | S-3 | `ridership_monthly` | Unique (ntd_id, mode, tos, month); UPT ≥ 0; month gaps per mode are reported | `carta.ridership.upt.monthly.<mode>` (latest) and `…yoy_pct` (auto-publish) |
| 3.3 | `census_acs` | Pilot | S-10 | `acs_commute` | Variable labels are checked against the `/variables/<VAR>.json` metadata; the MOE is present; the year is recorded | Transit mode share %, drive-alone %, mean travel time for CBSA 16700 and the 3 counties (auto-publish) |
| 3.4 | `eia_gas` | Pilot | S-11 | `fuel_price_weekly` | Weekly continuity; value in a sane range ($1–$10) | `fuel.gasoline.regular.padd1c.usd_per_gal` (auto-publish) |
| 3.5 | `reference_facts` | Pilot | S-9, S-12…S-15 | uses `fact` and `review_item` | Every entry has a source URL, a page or quote, and a retrieval date. **`value: null` entries are skipped.** | **All `candidate`.** A human approves each one via `tda review approve`. |
| 3.6 | `scdot_counts` and `scdot_ccs_inbox` | Pilot | S-6a/S-6b and S-6c | `traffic_count`, `traffic_count_hourly` | ArcGIS item owner/org verified; bbox filter; station IDs are unique per year. Inbox files need a sidecar `<file>.meta.yaml` (`supplied_by`, `original_url`, `retrieved_at`), with 0–24 hours and volume ≥ 0. | none (P4 metrics) |
| 3.7 | `gtfs_rt_alerts` | Pilot | S-2 | `service_alert` | The protobuf parses; the active window is valid; `informed_entities` reference known route and stop IDs in the active feed (warn otherwise) | none. Alert text is **untrusted**, so store it as data only. |
| 3.8 | `tomtom_sampler` | Optional | S-7 / S-7b | `traffic_sample` | **Only with D-7 approval.** Own key, daily budget guard, TTL retention | none |
| 3.9 | `nws`, `noaa_tides`, `nhtsa_fars`, `documents` | Expansion | S-16, S-17, S-18, S-5/S-19/S-20 | per spec in the PR | NWS needs its User-Agent. If FARS returns 403, **don't evade it**; use the inbox. `documents` checks `robots.txt` and stores the text for the P5 Extractor. | NOAA flood thresholds (auto-publish); FARS county fatalities (auto-publish); documents produce none directly |

### Connector-specific notes
- **`gtfs_static`:**
  - Use `gtfs-kit` for parsing and validation helpers.
  - Load into a **new** `feed_version`, then flip `is_active` in one transaction.
  - Add `tda gtfs versions` and `tda gtfs activate <id>`.
  - The fixture is a trimmed feed with 2 routes, ~10 stops, and 2 service patterns.
- **`ntd_monthly`:**
  - Filter by **`ntd_id='40110'`** (verified live 2026-09-24), not the agency name. Confirm the date field in the
    dataset metadata (`/api/views/8bui-9xvu.json`).
  - Page with `$limit` and `$offset`, and send a Socrata app token if one is configured.
- **`census_acs`:** the subject tables (S0801) use the `/acs/acs5/subject` endpoint. Store the variable code and
  its label together, and never hard-code only the label.
- **`reference_facts`:**
  - Create `tda/facts/reference_facts.yaml` with the keys listed in the 05 assumptions table.
  - **The agent must not fill in numbers.** Set `value: null` and add a `todo: verify from <url> p.<n>` note. A
    human enters the verified value.
- **`gtfs_rt_alerts`:**
  - The feed URL is `http://`, so also try `https://` and use it if it works. Record which scheme was used.
  - `store_policy: ttl:30d`.

## Verification (paste the output into the PR)

```bash
cd data_agent && uv sync && uv run ruff check . && uv run ruff format --check . && uv run pytest -q tests/connectors/test_<name>.py && uv run pytest -q
uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head   # migration round-trip
```

Live smoke test, **run by a human** after approval, or by the builder where the maintainer delegates it in 05 §6 (in an
isolated local database). Run it from the repo root. `$TDA_DATABASE_URL` is the plain
`postgresql://…` writer URL:
```bash
docker compose up -d postgres
(cd data_agent && uv run tda ingest <source_id> --live && uv run tda ingest <source_id> --live)  # 2nd run → not_modified or no-op
psql "$TDA_DATABASE_URL" -c "select status, count(*) from tda.fetch_run where source_id='<source_id>' group by 1"
# GTFS example DQ (read through the current_* views):
psql "$TDA_DATABASE_URL" -c "select count(*) from tda.current_gtfs_stop s join tda.current_gtfs_feed_version v on v.id=s.feed_version_id where v.is_active"
psql "$TDA_DATABASE_URL" -c "select count(*) from tda.current_gtfs_stop_time st left join tda.current_gtfs_trip t on t.trip_id=st.trip_id and t.feed_version_id=st.feed_version_id where t.trip_id is null"  -- expect 0
```

## Definition of done (per connector)

- [ ] CI is green. The connector tests cover the pass and fail paths, idempotency, and 304/not-modified.
- [ ] The migration round-trips.
- [ ] `sources.yaml` is complete, and `approved` is set only after the human's terms review and sign-off are
      recorded in 05 §6.
- [ ] The live smoke output is pasted (from the human, or from the builder where 05 §6 delegates it), including the
      second-run no-op.
- [ ] The catalog is updated if anything changed.

## Rollback

- Set `status: disabled`, then revert the PR.
- For a bad load, run `tda runs rollback <run-id> --dry-run`, review the output, then run `--confirm`. This marks
  the run `rolled_back` and sets dependent approved facts to `needs_review`; it **deletes nothing** (the `current_*`
  views simply stop selecting the rolled-back run). **Never run ad hoc `DELETE` statements.**
- For GTFS, `tda gtfs activate <previous>`.
- Migrations have a working `downgrade`.

## Handoff

- In [../README.md](../README.md), tick the connector off in the P3 row.
- P4 can start once 3.1, 3.2, and 3.5 are done, with 3.6 and 3.7 recommended.
