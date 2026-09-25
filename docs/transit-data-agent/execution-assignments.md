# Execution assignments — who builds, who reviews

> Companion to [04 (roadmap)](./04-implementation-plan.md) and the [prompts/](./prompts/). It assigns a **builder**
> and a **reviewer** model to each phase and wires the work to the G0/G1 gates. The models in play are **Claude
> Opus** and **GPT Astra**.

## Operating rules (these matter more than which model is "smarter")

1. **The tests and each prompt's Definition of Done are the verdict** — not a model's confidence. No phase merges
   until its asserting verification block passes and CI is green.
2. **Reviewer ≠ builder, every phase.** Cross-model review catches what same-model review cannot.
3. **One model per PR.** Don't co-mingle builders inside a single PR; it muddies the review.
4. **Astra reviews the correctness/security-critical spots regardless of who built them:** P1 claim validator,
   P2 grants + rollback, P4a boardability, P5 injection/budget, P0 secrets, P7 rate-limiting/CSP.
5. **Unsigned phase = blocked.** A coding session must stop and report if its entry gate or preconditions aren't met.

## Gate map

| Gate | Owner | Blocks | Mechanical check |
|------|-------|--------|------------------|
| **G0** baseline | **Human** | everything | `scripts/g0-check.sh` (baseline merged, no key in tree, files present) + human sign-off |
| **G1** pilot | **Human** | all Stage 3 (P5/P6/P7) | 05 §G1 checklist (schedule spot-checks, provenance scan, drills, measurement design) |

## Per-phase assignments

| Phase | Branch | Entry | Builder | Reviewer | Reviewer's sharpest focus |
|-------|--------|-------|---------|----------|---------------------------|
| P0 Stabilize | `feat/tda-phase-0-stabilize` | G0 | **Opus** | **Astra** | secrets, bbox/reducer/redirect correctness |
| P0B Framework upgrade | `feat/tda-phase-0b-framework` | P0 merged | **Opus** | **Astra** | behavior-neutrality, peer-dep conformance |
| P1 Web seams | `feat/tda-phase-1-web-seams` | P0B merged | **Opus** (contracts/route) + **Astra** (domain math + `validate-claims`) | **Astra** | validator rejects swap/negation/unit vectors; fail-closed |
| P2 Scaffold | `feat/tda-phase-2-scaffold` | P0 merged | **Opus** | **Astra** | reader-role grants, append-only + non-destructive rollback |
| P3 Connectors (1 PR each) | `feat/tda-phase-3-<connector>` | P2 merged | **Either** (one model/PR) | **the other** | DQ checks, append-only load, idempotency |
| P4a Metrics + API | `feat/tda-phase-4a-metrics-api` | P3 3.1/3.2/3.5 | **Astra** | **Opus** | boardability edge cases; conditional endpoints; contract |
| P4b App integration | `feat/tda-phase-4b-web-integration` | P1 + P4a | **Opus** | **Astra** | every page number cited or "unavailable"; `basis` |
| **G1 pilot gate** | — | P4b | **Human** | — | honest, cited pilot |
| P5 Agent + HITL | `feat/tda-phase-5-agent` | P1 + P4a (after G1) | **Astra** | **Opus** | no write tools, injection, budget reservation |
| P6 Forecasting | `feat/tda-phase-6-forecasting` | P4b (after G1) | **Astra** | **Opus** | beats seasonal-naive; determinism; adds its own `/v1/series/*` |
| P7 Productionize | `feat/tda-phase-7-*` (4 PRs) | P4b+P5+P6 | **Opus** | **Astra** | rate limiting, CSP, PII-free event schema, D-26 tiers |

## What's automated vs. what needs you

**Automated (a build session does this unattended):** branch from the baseline → execute the phase prompt →
run the prompt's asserting verification → open a PR with the output pasted → hand off to the reviewer session.
The reviewer session reads the diff, runs the same checks, and posts findings.

**Only you can do (by design — the plan is human-in-the-loop):**
- **G0:** merge `claude-opus4.5-refactor` **and** these docs into `main`; **revoke the leaked Gemini key** in
  Google Cloud; answer **D-4, D-13, D-16, D-24**; sign G0 in 05 §G0 and P0 in §7.
- **Per-phase sign-off:** sign each phase in 05 §7 before its session may start.
- **Source approvals (P3):** review each source's terms and flip `status: approved` by PR.
- **Live smoke tests that need real API keys** and the **G1 gate** decision.
- **Publishing** any agent report or enabling any source (queue approval).

## Session orchestration

Each phase runs as its own tracked session on its assigned model, in an isolated Git worktree, using the
self-contained brief below. A session **must** run `scripts/g0-check.sh` (and confirm its entry gate) before
writing any code; if the gate fails it reports the blockers and stops.

### Builder brief (template)

```
You are the BUILDER for <PHASE> of the Tryp Transit refactor, running on <MODEL>.
1. Run `bash docs/transit-data-agent/scripts/g0-check.sh`. If it exits non-zero, or <PHASE>'s entry gate in
   docs/transit-data-agent/05-decisions-and-review.md §7 is not signed, STOP and report the exact blockers.
2. Otherwise branch `<BRANCH>` from the G0 baseline commit on main.
3. Execute docs/transit-data-agent/prompts/<PHASE-PROMPT>.md exactly. Respect every "stop and ask".
4. Run the prompt's Verification block; every command must assert its result. Fix until green.
5. Open a PR; paste the verification output and the Definition-of-done checklist. Do not merge.
Constraints: docs-only decisions are already made; never invent numbers; never enable a source or publish; keep
the diff surgical and one logical commit per task.
```

### Reviewer brief (template)

```
You are the REVIEWER for <PHASE>, running on <MODEL> (you did NOT build it).
Review the open PR for <BRANCH> against docs/transit-data-agent/prompts/<PHASE-PROMPT>.md and its Definition of
done. Re-run the verification block yourself. Focus especially on: <REVIEWER FOCUS>. Report high-confidence bugs,
contract violations, and any invented number or uncited claim. Do not rubber-stamp; if the DoD isn't met, say so.
```

Fill `<PHASE>`, `<MODEL>`, `<BRANCH>`, `<PHASE-PROMPT>`, `<REVIEWER FOCUS>` from the table above.
