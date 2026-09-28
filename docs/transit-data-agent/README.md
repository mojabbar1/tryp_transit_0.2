# Transit Intelligence Agent — Planning & Implementation Docs

> **Status: awaiting human review. No code has been changed.**
> These docs plan a staged refactor of Tryp Transit and the build of a data agent. The agent acquires public
> transit, traffic, and supporting data, and it produces **cited, verifiable stats** to increase transit use in
> the Charleston region. Generated 2026-09-24.

## TL;DR

- **Refactor needed?** Yes — targeted and staged, not a rewrite ([01](./01-current-state-assessment.md#1-verdict)).
  Today the LLM invents every number the user sees. The app's 62 stops don't match CARTA service (32 are more than
  800 m from any real stop), the forecasts were fed NYC data, `next build` fails, the default AI models are
  shut down or gone, and Next 14 is EOL with CVEs fixed only in 15/16.
- **Approach: pilot first, then expand.** Stage 2 ships an honest, cited pilot (real GTFS schedules, approved
  facts, no invented numbers) and stops at the **G1 gate**. The agent, forecasting, and productionization are
  **Stage 3 expansion**, entered only after G1.
- **The agent:**
  - A separate Python `data_agent/` service that runs deterministic connectors: CARTA GTFS, NTD, Census, EIA,
    SCDOT, and NOAA, with TomTom used live only.
  - A Postgres store with provenance (append-only observations, versioned facts), plus metrics and approved facts.
  - A Pydantic AI agent (analyst, extractor, optional scout). It has **no write tools**; the runtime stages its
    output, validates it, and submits to a human review queue.
  - The web app keeps doing narration, but **numbers by reference**: the LLM emits no digits, and a validator
    enforces it.

  See [02](./02-target-architecture.md).
- **⏰ Time-sensitive:** `gpt-3.5-turbo` shuts down on **2026-10-23**, and `gemini-1.5-flash` is already gone. The
  Phase 0 model-ID stopgap can ship as its own hotfix ahead of everything else.

## Stages and gates

```
Stage 1 Foundation:  P0 ─► P0B                     (stabilize, secure, upgrade)
        └─ G0 baseline gate (blocking, before P0): merge the assessed baseline + these docs into main
Stage 2 Pilot:       P1 ─┬─► P4a ─► P4b            (honest, cited trip answers)
                     P2 ─┴─► P3 ──►               (data agent + connectors feed P4)
        └─ G1 pilot gate (blocking, before expansion): the app shows only honest, cited numbers
Stage 3 Expansion:   P5 (agent) · P6 (forecasting) · P7 (productionize + measure impact)
```

## Reading order

| # | Doc | Purpose |
|---|-----|---------|
| 00 | [Planning prompt](./00-planning-prompt.md) | The prompt written first and then executed to produce these docs. Re-run it to refresh the plan. |
| 01 | [Current-state assessment](./01-current-state-assessment.md) | Baseline health, 26 evidence-backed findings, and the refactor verdict |
| 02 | [Target architecture](./02-target-architecture.md) | Services, data model, agent roles and tools, guardrails, HITL, integration, measurement, NFRs |
| 03 | [Data source catalog](./03-data-source-catalog.md) | Verified sources (S-1…S-20), terms, the ingestion and retention policy, the manual inbox, and gaps |
| 04 | [Implementation roadmap](./04-implementation-plan.md) | Gate-driven roadmap (P0…P7) with the dependency graph, per-phase cards, rollback, and risks |
| 05 | [Decisions & review](./05-decisions-and-review.md) | **Start here as a reviewer.** Decisions, assumptions, the G0/G1 gate checklists, and sign-offs. |
| 06 | [Review log](./06-review-log.md) | The independent review and reassessment findings, and where each was addressed |
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

| Phase | Stage | Prompt | Depends on | Status | PR |
|-------|-------|--------|------------|--------|----|
| **G0 baseline gate** | Gate | [05 §G0](./05-decisions-and-review.md) | D-24, D-13 | ✅ Passed 2026-09-25 | — |
| P0 Stabilize & secure | 1 | [phase-0-stabilize](./prompts/phase-0-stabilize.md) | G0 | ✅ Done 2026-09-25 (`fd52ce8`); R1 waived → P1 precondition | [#3](https://github.com/mojabbar1/tryp_transit_0.2/pull/3) |
| P0B Next 16 / React 19 | 1 | [phase-0b-framework-upgrade](./prompts/phase-0b-framework-upgrade.md) | P0 | ✅ Done 2026-09-25 (`5a7833a`); exceptions in 05 §7 | [#4](https://github.com/mojabbar1/tryp_transit_0.2/pull/4) |
| P1 Web seams & deterministic math | 2 | [phase-1-web-seams](./prompts/phase-1-web-seams.md) | P0B | ✅ Done 2026-09-27; provider checks simulated because no keys exist (05 §7). Transit stays `unavailable` until P4 | [#12](https://github.com/mojabbar1/tryp_transit_0.2/pull/12) · [#13](https://github.com/mojabbar1/tryp_transit_0.2/pull/13) · [#14](https://github.com/mojabbar1/tryp_transit_0.2/pull/14) |
| P2 `data_agent` scaffold | 2 | [phase-2-data-agent-scaffold](./prompts/phase-2-data-agent-scaffold.md) | P0 (parallel with P0B, P1) | ✅ Done 2026-09-27; Astra approved after 3 review rounds (05 §7). All 25 sources `proposed`, nothing enabled | [#15](https://github.com/mojabbar1/tryp_transit_0.2/pull/15) |
| P3 Connectors (1 PR each) | 2 | [phase-3-connectors](./prompts/phase-3-connectors.md) | P2 | ⏳ `gtfs_static` ☑ `ntd_monthly` ☑ `census_acs` ☐ `eia_gas` ☐ `reference_facts` ☑ `scdot_*` ☐ `gtfs_rt_alerts` ☐. Signed 2026-09-28 (05 §6): `gtfs_static`, `ntd_monthly`, `reference_facts`, `gtfs_rt_alerts`, `eia_gas`; `census_acs` waits for a key | |
| P4a Metrics + read API | 2 | [phase-4 (PR 4a)](./prompts/phase-4-metrics-api-integration.md) | P3 (3.1, 3.2, 3.5) | ⏳ | |
| P4b App integration | 2 | [phase-4 (PR 4b)](./prompts/phase-4-metrics-api-integration.md) | P1, P4a, 05 §2b | ⏳ | |
| **G1 pilot gate** | Gate | [05 §G1](./05-decisions-and-review.md) | D-26; the pilot is honest | ⛔ Blocking, before expansion | |
| P5 Agent + HITL + weekly report | 3 | [phase-5-agent-hitl](./prompts/phase-5-agent-hitl.md) | P1, P4a (parallel with P6) | ⏳ Expansion | |
| P6 Forecasting on real data | 3 | [phase-6-forecasting](./prompts/phase-6-forecasting.md) | G1, P4b (parallel with P5) | ⏳ Expansion | |
| P7 Productionize & measure impact | 3 | [phase-7-productionize](./prompts/phase-7-productionize.md) | P4b, P5, P6 | ⏳ Expansion | |

> **P0 follow-ups** (from [#3](https://github.com/mojabbar1/tryp_transit_0.2/pull/3)). **P0B:** done in the stacked P0B PR. Lint was
> re-run on ESLint 9 (0 errors; `set-state-in-effect` is a warning for 3 existing effects), and the `sharp`/`caniuse-lite`
> build warnings no longer appear on Next 16. **P1:** with a live key, confirm `gemini-3.8-flash` output isn't truncated by the legacy SDK's
> `maxOutputTokens: 2048`, and format the `/routes` saving as currency. **Existing:** a full page load of `/find-rides`
> redirects before auth hydrates. **Later:** drop the `NEXT_PUBLIC_TOMTOM_API_KEY` fallback.

## Before Phase 0 can start (the G0 baseline gate)

1. **Merge the baseline (D-24).** The assessed code (`9b129d6`) lives only on `origin/claude-opus4.5-refactor`, not
   `main`. Merge that branch **and** these docs into `main`, then start every phase from that named commit. Prompts
   never assume `main` already contains the assessed code.
2. Commit or stash your pending edits to `CHANGELOG.md`, `CLEAN_SUMMARY.md`, and `REFACTORING_PLAN.md`. P0 edits
   `REFACTORING_PLAN.md`.
3. **Confirm the Gemini key string in `REFACTORING_PLAN.md` is revoked** in Google Cloud, and record it under D-13.
4. Answer or accept **D-4**, **D-13**, **D-16**, and **D-24** in [05](./05-decisions-and-review.md), complete the
   G0 checklist in [05 §G0](./05-decisions-and-review.md), and sign off P0 in §7.
