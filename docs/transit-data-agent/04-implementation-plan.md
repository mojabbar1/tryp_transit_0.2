# 04 — Roadmap (stages, gates, dependencies)

> **This is a map, not a task list.** Each phase's *executable* steps live in its prompt under
> [`prompts/`](./prompts/) — the prompt is the source of truth. This file owns the stages, the gates, the
> dependency graph, and the per-phase entry/exit criteria. If this file and a prompt disagree on steps, **the
> prompt wins**. Contracts (schemas, tool contracts, invariants) live in
> [02-target-architecture.md](./02-target-architecture.md); decisions and gate checklists live in
> [05-decisions-and-review.md](./05-decisions-and-review.md); findings (F-n) in
> [01-current-state-assessment.md](./01-current-state-assessment.md); sources (S-n) in
> [03-data-source-catalog.md](./03-data-source-catalog.md); review dispositions in
> [06-review-log.md](./06-review-log.md).

## Current state

A Next.js 14.2.4 app with one live route (`/api/transit-insights`) that hands raw TomTom JSON and a fabricated
ridership number to an LLM, which invents every number the user sees. The stop catalog isn't real CARTA data, the
TomTom bbox is lat/lng-swapped, `next build` fails, three user flows are broken, and there is no CI, data store,
or review workflow.

## Target state

- A **green, CI-gated** web app whose `/api/transit-insights` computes numbers deterministically and uses the LLM
  only to narrate validated facts by reference. **Live mode makes no unsupported promise.**
- A **`data_agent/`** Python service: source registry, polite fetcher, append-only Postgres store with provenance,
  versioned facts, deterministic metrics, and a read API — feeding real CARTA GTFS schedules into the app.
- Everything past the pilot (forecasting, extra connectors, the agent's report/extract/scout tasks, MCP, admin UI)
  is **expansion**, gated behind a proven pilot.

## Stages and gates

```
Stage 1 — Stabilize
  G0 baseline gate ─► P0 stabilize+secure ─► P0B framework upgrade

Stage 2 — Pilot (prove one end-to-end slice)
  P0B ─► P1 web seams (contracts, narration, honest live mode) ──────────────┐
  P0  ─► P2 data_agent scaffold ─► P3 core connectors ─► P4a metrics+read API ─┤
                                                                              ▼
                                                              P4b web integration ─► G1 pilot gate

Stage 3+ — Expansion (each item approved at G1)
  P5 agent + HITL  ·  P6 forecasting (only if D-10 keeps it)  ·  P7 productionize + measurement
  extra connectors (SCDOT counts, NWS, NOAA, FARS, documents)  ·  scout  ·  MCP  ·  admin UI
```

### Dependency graph (with the artifacts each edge carries)

| Phase | Needs (phase) | Needs (artifact) | Parallel-safe with |
|-------|---------------|------------------|---------------------|
| **G0** | — | baseline commit merged (D-24), docs committed, key revoked (D-13) | — |
| P0 | G0 | the named baseline commit | — |
| P0B | P0 | Next 14.2.35 baseline | P2 |
| P1 | P0B | contracts + narration design (02 §7–8) | P2, P3 |
| P2 | P0 | `.gitignore` fix from P0 | P0B, P1 |
| P3 (core) | P2 | scaffold + polite client | P1 |
| P4a | P3 (3.1 GTFS, 3.2 NTD, 3.5 refs) | those tables + approved reference facts | P1 |
| P4b | **P1 and P4a** | the vectors file (P1), the read API + `export-stops` (P4a), 05 §2b mapping | P5 |
| **G1** | P4b | pilot evidence (05 G1 checklist) | — |
| P5 | **P1 and P4a** | claim-validation vectors (P1), read tools (P4a) | P4b, P6 |
| P6 | P4b | `/v1/series/*` (P4a) + a stable v2 engine | P5 |
| P7 | P4b, P5, P6 (or D-10 = retire) | the pilot in production | — |

Note the two edges the first draft missed: **P4b and P5 both need P1's vectors file**, and **P4a builds the
`/v1/series/*` and `export-stops` artifacts** that P6 and P4b consume — so P6 never edits P4a's API.

## Phases

Each card gives the goal, the findings it closes, entry criteria, the exit **evidence**, and the rollback. Steps
are in the linked prompt.

### Stabilize

**P0 — Stabilize & secure** · [prompt](./prompts/phase-0-stabilize.md)
- **Goal:** a green, CI-gated baseline with the honesty and correctness bugs fixed.
- **Closes:** F-01, F-02, F-03, F-04, F-11 (stopgap), F-12, F-14, F-15 (port), F-16, F-20 (count), F-21, F-23,
  F-24, F-25, F-22 (patch).
- **Entry:** G0 passed.
- **Exit evidence:** `lint + typecheck + test + build` all green in CI; demo scenarios render; `/find-rides` error
  path and the loading state both work; the bbox test asserts the corrected order; no secret in HEAD.
- **Rollback:** revert the PR. The `TOMTOM_API_KEY` rename keeps a fallback read. The model-ID stopgap (T8) may
  ship as its own hotfix before 2026-10-23.

**P0B — Framework upgrade** · [prompt](./prompts/phase-0b-framework-upgrade.md)
- **Goal:** Next 16.x + React 19 on Node 22, behavior-neutral.
- **Closes:** F-22 (fully).
- **Entry:** P0 merged; D-16.
- **Exit evidence:** CI green on Node 22; `npm audit` clean for `next`; the smoke checklist matches the pre-upgrade UI.
- **Rollback:** revert the single PR → Next 14.2.35.

### Pilot

**P1 — Web contracts, narration, honest live mode** · [prompt](./prompts/phase-1-web-seams.md)
- **Goal:** deterministic numbers; the LLM narrates by reference; live mode promises nothing it can't back.
- **Closes:** F-05 (partial), F-09, F-10, F-11 (fully), F-17, F-18 (web), F-26.
- **Entry:** P0B merged; D-4, D-15, D-21, D-25, D-27, and the 05 §2 assumptions signed.
- **Exit evidence:** the validator rejects the swapped-fact vector; a live request with no schedule shows
  `transit.basis = "unavailable"` (not a number) while drive/cost/traffic render; no reward in live mode; no
  `INSIGHTS_ENGINE` switch exists.
- **Rollback:** revert the PR (no legacy engine, D-27).

**P2 — data_agent scaffold** · [prompt](./prompts/phase-2-data-agent-scaffold.md)
- **Goal:** the platform — config, append-only store, versioned facts, polite fetcher, review queue, read API, CLI,
  compose, CI — with rollback that restores prior values.
- **Closes:** the "no place for an agent to live" gap.
- **Entry:** P0 merged; D-1, D-2, D-5, D-8, D-9, D-11, D-18, D-19.
- **Exit evidence:** CI `data-agent` job green; a proposed source can't run; `/v1/facts` never returns candidates;
  the reader role can't write; an **append-then-rollback drill restores the prior value**; paths are gitignored and
  root-anchored.
- **Rollback:** revert the PR; `docker compose down -v`.

**P3 — Core connectors** (one PR each) · [prompt](./prompts/phase-3-connectors.md)
- **Goal:** real CARTA GTFS (3.1), NTD ridership (3.2), and curated reference facts (3.5); Census/EIA/alerts optional.
- **Closes:** F-06, F-07 (data side).
- **Entry:** P2 merged; each source's 05 §6 row signed after a terms review; D-7.
- **Exit evidence:** per-connector tests (pass + fail + idempotency + 304 + rollback) green; a human ran the live
  smoke test; loads are append-only.
- **Rollback:** `status: disabled`; `tda runs rollback`; `tda gtfs activate <previous>`.

**P4a — Metrics + read API** · [prompt](./prompts/phase-4-metrics-api-integration.md)
- **Goal:** boardable direct-route lookup, service/volume/ridership metrics, and the read endpoints (including
  `/v1/series/*` and `export-stops`) the app and P6 consume.
- **Closes:** F-05 (fully, data side), F-06, F-08 (data side).
- **Entry:** P3 3.1/3.2/3.5 merged and reference facts approved.
- **Exit evidence:** fixture tests prove a known direct trip, `arrive_by`/`depart_at`, a calendar exception, an
  overnight trip, a **departed-bus rejection**, and `transfer_required`; `/v1/compare` returns `basis: scheduled`;
  reader-role tests pass.
- **Rollback:** revert the PR.

**P4b — App integration** · [prompt](./prompts/phase-4-metrics-api-integration.md)
- **Goal:** the app renders real schedules, cited facts, and a stops fallback; demo behind one flag.
- **Closes:** F-05 (fully), F-06, F-08 (fully).
- **Entry:** **P1 and P4a** merged; 05 §2b demo mapping signed and verified against `/v1/compare`.
- **Exit evidence:** a known pair shows scheduled minutes with no "estimated"; a transfer pair shows the reason;
  every page number has a citation or "data unavailable"; with the agent stopped, stops load from the committed
  fallback and results degrade honestly.
- **Rollback:** `DATA_AGENT_ENABLED=false` → P1 behavior (fallback stops); revert 4b then 4a if needed.

### Gate

**G1 — pilot gate.** Before any expansion, the 05 G1 checklist must be signed: schedule spot-checks (incl.
departed-bus, overnight, no-service), a full-provenance scan, a correction drill, an outage drill, no unsupported
promises, an agreed measurement design (D-26), and a recorded go/no-go with the chosen expansion items.

### Expansion (each gated at G1)

**P5 — Agent + HITL** · [prompt](./prompts/phase-5-agent-hitl.md) — Analyst report, Extractor, optional Scout. The
model has **no write tools**; the runtime validates then submits. Needs P1 (vectors) + P4a (read tools).

**P6 — Forecasting** · [prompt](./prompts/phase-6-forecasting.md) — only if D-10 keeps `model_service`; retargets it
to CARTA data via `/v1/series/*`. Needs P4b.

**P7 — Productionize + measurement** · [prompt](./prompts/phase-7-productionize.md) — rate limiting, auth, the
D-26 measurement design (not just click funnels), ops, docs refresh, e2e. Needs P4b, P5, P6.

## Rollback plan (system-wide)

1. **Any phase** is one squash-merged PR; revert with `git revert <merge-sha>`. Phases are additive (new files,
   optional fields, flags).
2. **P0** env rename keeps a fallback read; the Next patch reverts via the lockfile.
3. **P0B** reverts to Next 14.2.35 cleanly (upgrade-only PR).
4. **P1** reverts the PR — there is no legacy runtime switch (D-27).
5. **P3** — `status: disabled`; `tda runs rollback <id> --dry-run` then `--confirm` (marks the run `rolled_back`,
   recomputes metrics, sets dependent approved facts to `needs_review`, keeps raw evidence; **never** ad hoc
   `DELETE`s); `tda gtfs activate <previous>`.
6. **P4** — `DATA_AGENT_ENABLED=false` restores P1 behavior with fallback stops; `NEXT_PUBLIC_DEMO_MODE=true`
   restores the demo surfaces.
7. **P5** — `AGENT_ENABLED=false`; nothing auto-publishes, so reject pending review items.
8. **P6** — keep the previous image tag; `/predict/*` stays one release under `MODEL_MODE=demo`.
9. **Database** — migrations are forward-only with a tested `downgrade` each; `pg_dump` before any shared-env migration.

## Final validation (run from repo root after any phase ≥ P2)

```bash
(cd src && npm ci && npm run lint && npm run typecheck && npm test -- --ci && npm run build) && \
(cd data_agent && uv sync --frozen && uv run ruff check . && uv run pytest -q) && \
docker compose up -d postgres && \
(cd data_agent && uv run tda db bootstrap && uv run tda db upgrade && uv run tda sources validate)
# add `(cd model_service && uv run pytest -q)` only after P6 exists
```

## Risks

| ID | Risk | Likelihood / impact | Mitigation |
|----|------|---------------------|------------|
| R-1 | TomTom terms forbid storing sampled data, so no historical congestion dataset | Med / High | D-7 live-only + SCDOT volume + licensed history; `store_policy` enforced in code |
| R-2 | No public CARTA GTFS-RT positions, so no real-time reliability metrics | Med / Med | Schedule-based metrics first; request feed access (partnership) |
| R-3 | LLM numbers slip past the validator | Low / High | Numbers-by-reference, shared vectors incl. swap/negation cases, template fallback, fail closed |
| R-4 | Prompt injection through scraped documents | Med / High | Extractor has no tools; outputs only ever `candidate`; human approval; injection eval cases |
| R-5 | Competing architectures (the unmerged branches) | Med / Med | D-11 harvest, don't merge; these docs are the plan of record |
| R-6 | LLM or TomTom cost overrun | Med / Med | Atomic budget reservation (D-14), separate keys, caching, daily caps |
| R-7 | Licensing or attribution violations | Low / High | Per-source terms review is a HITL gate; `attribution_text` rendered; `robots.txt` enforced |
| R-8 | UI breaks during the contract migration | Low / Med | Additive fields; zod-validated demo; `DATA_AGENT_ENABLED` flag |
| R-9 | Timezone / DST errors | Med / Med | Region-timezone utilities with DST tests |
| R-10 | Operating new services becomes a burden | Med / Med | Single-host compose; health + freshness; few moving parts; expansion gated |
| R-11 | A history rewrite for the leaked key disrupts collaborators | Low / Med | Prefer revocation + redaction (D-13); coordinate any force-push |
| R-12 | The framework upgrade (14 → 16) breaks the UI or tests | Med / Med | Isolated behavior-neutral P0B; official codemod; smoke checklist; clean revert |
| R-13 | Misleading or manipulative nudges | Low / High | Tone rules, demo-only rewards until funded (D-25), human review, no demographic targeting |
| R-14 | The maintainer's uncommitted doc edits conflict with P0 | High / Low | G0 precondition: clean tree, edits committed |
| R-15 | More model/SDK shutdowns (`gpt-3.5-turbo` 2026-10-23; `gemini-1.5-flash` gone) | High / High | P0 model-ID stopgap (hotfix); env-only model IDs; provider interface (P1); deprecation-page check |
| R-16 | Stale research facts (quotas, terms, model IDs change) | Med / Med | Every connector/prompt re-verifies its source at execution; catalog records dates |
| R-17 | **Numbers-by-reference proves too strict or too loose** | Med / Med | Typed claim objects + deterministic templates; the model picks wording, not numbers; vectors cover swap/period/negation/unit; template fallback on any failure |
| R-18 | **The pilot ships but can't show mode shift** | High / Med | D-26 measurement design is a G1 blocker; four evidence tiers kept separate; no traffic-reduction claim before Tier ≥ 3 |
| R-19 | **Demo stops don't map to real boardable CARTA trips** | Med / Med | 05 §2b verified against `/v1/compare` before P4b; drop any scenario without a real trip; Folly Beach already removed |
| R-20 | **Append-only store grows or complicates queries** | Low / Low | CARTA data is small; `current_*` views hide versioning; retention prunes raw, keeps normalized + cited evidence |
