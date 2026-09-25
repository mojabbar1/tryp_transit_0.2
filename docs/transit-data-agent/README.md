# Transit Intelligence Agent — Planning & Implementation Docs

> **Status: awaiting human review. No code has been changed.**
> These docs plan a staged refactor of Tryp Transit and the build of a data agent. The agent acquires public
> transit, traffic, and supporting data, and it produces **cited, verifiable stats** to increase transit use in
> the Charleston region. Generated 2026-09-24.

## TL;DR

- **Refactor needed?** Yes. It's targeted and staged, not a rewrite
  ([01](./01-current-state-assessment.md#1-verdict)). Today the LLM invents every number the user sees. The stops
  are synthetic, the forecasts use NYC data, `next build` fails, the default AI model has already been shut down,
  and Next 14 is EOL with unpatchable CVEs.
- **The agent:**
  - A separate Python `data_agent/` service that runs deterministic connectors: CARTA GTFS, NTD, Census, EIA,
    SCDOT, and NOAA, with TomTom used live only.
  - A Postgres store with provenance, plus metrics and approved facts.
  - A Pydantic AI agent (analyst, extractor, and an optional scout). It can write **only** to a human review queue.
  - The web app keeps doing narration, gated by a numeric-claim validator.

  See [02](./02-target-architecture.md).
- **⏰ Time-sensitive:** `gpt-3.5-turbo` shuts down on **2026-10-23**, and `gemini-1.5-flash` is already gone. The
  Phase 0 model-ID stopgap should land first.

## Reading order

| # | Doc | Purpose |
|---|-----|---------|
| 00 | [Planning prompt](./00-planning-prompt.md) | The prompt written first and then executed to produce these docs. Re-run it to refresh the plan. |
| 01 | [Current-state assessment](./01-current-state-assessment.md) | Baseline health, 22 evidence-backed findings, and the refactor verdict |
| 02 | [Target architecture](./02-target-architecture.md) | Services, data model, agent roles and tools, guardrails, HITL, integration, NFRs |
| 03 | [Data source catalog](./03-data-source-catalog.md) | Verified sources (S-1…S-20), terms, the ingestion policy, the manual inbox, and gaps |
| 04 | [Implementation plan](./04-implementation-plan.md) | Phased plan (P0…P7) with verify steps, rollback, and risks |
| 05 | [Decisions & review](./05-decisions-and-review.md) | **Start here as a reviewer.** Decisions, assumptions, checklists, and sign-offs. |
| — | [prompts/](./prompts/) | One executable prompt per phase |

## Workflow: review → approve → execute

```
Reviewer: read 01–04 → answer decisions + approve assumptions in 05 → sign the phase off in 05 §7
Agent:    create branch feat/tda-phase-N-<slug> → run prompts/phase-N-*.md → paste verification into PR
Reviewer: review PR with 05 §5 checklist → merge → update the status table below
```

Rules for coding agents:
- Treat an unsigned phase as blocked.
- Stop and ask whenever a precondition fails or a decision is missing.
- Never invent numbers, never enable a source without a human PR, and never publish without an approval in the queue.

## Phase status

| Phase | Prompt | Depends on | Parallel-safe with | Status | PR |
|-------|--------|------------|--------------------|--------|----|
| P0 Stabilize & secure | [phase-0-stabilize](./prompts/phase-0-stabilize.md) | — | — | ⏳ Awaiting sign-off | |
| P0B Next 16 / React 19 | [phase-0b-framework-upgrade](./prompts/phase-0b-framework-upgrade.md) | P0 | P2 | ⏳ | |
| P1 Web seams & deterministic math | [phase-1-web-seams](./prompts/phase-1-web-seams.md) | P0B | P2, P3 | ⏳ | |
| P2 `data_agent` scaffold | [phase-2-data-agent-scaffold](./prompts/phase-2-data-agent-scaffold.md) | P0 | P0B, P1 | ⏳ | |
| P3 Connectors (1 PR each) | [phase-3-connectors](./prompts/phase-3-connectors.md) | P2 | P1 | ⏳ `gtfs_static` ☐ `ntd_monthly` ☐ `census_acs` ☐ `eia_gas` ☐ `reference_facts` ☐ `scdot_*` ☐ `gtfs_rt_alerts` ☐ | |
| P4a Metrics + read API | [phase-4 (PR 4a)](./prompts/phase-4-metrics-api-integration.md) | P3 (3.1, 3.2, 3.5) | P1 | ⏳ | |
| P4b App integration | [phase-4 (PR 4b)](./prompts/phase-4-metrics-api-integration.md) | P1, P4a, 05 §2b | P5 | ⏳ | |
| P5 Agent + HITL + weekly report | [phase-5-agent-hitl](./prompts/phase-5-agent-hitl.md) | P4a | P4b, P6 | ⏳ | |
| P6 Forecasting on real data | [phase-6-forecasting](./prompts/phase-6-forecasting.md) | P4b | P5 | ⏳ | |
| P7 Productionize & measure impact | [phase-7-productionize](./prompts/phase-7-productionize.md) | P4b, P5, P6 | — | ⏳ | |

## Before Phase 0 can start (human actions)

1. Commit or stash your pending edits to `CHANGELOG.md`, `CLEAN_SUMMARY.md`, and `REFACTORING_PLAN.md`. P0
   edits `REFACTORING_PLAN.md`.
2. **Confirm the Gemini key string in `REFACTORING_PLAN.md` is revoked** in Google Cloud, and record it under D-13.
3. Answer or accept **D-4**, **D-13**, and **D-16** in [05](./05-decisions-and-review.md), and sign off P0 in §7.
