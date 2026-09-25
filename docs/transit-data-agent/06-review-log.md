# 06 — Review log

> This records the independent review of the planning package and the reassessment that followed, and it maps every
> finding to where it was addressed in the revised docs. The `REV-*` and `A*` IDs are used **only here**; the docs
> themselves reference the stable `F-*` findings, `D-*` decisions, and `R-*` risks. Reassessed 2026-09-24.

The revision converged on three structural moves:
1. Each phase prompt is the single source of truth for its phase; [04](./04-implementation-plan.md) is a
   gate-driven roadmap, not a restatement.
2. The pilot (Stage 2) ships honest, cited numbers and stops at the **G1 gate**; the agent, forecasting, and
   productionization are Stage 3 expansion.
3. Two new gates — **G0** (merge the assessed baseline into `main` first) and **G1** (the pilot is honest) — are
   blocking.

## 1. Independent review findings (REV-01…REV-12) — all valid

| ID | Finding | Evidence checked | Where addressed |
|----|---------|------------------|-----------------|
| REV-01 | Phases branched from `main`, which lacks the assessed code | `9b129d6` (assessed) is only on `origin/claude-opus4.5-refactor`; `main` = `a8825ed` | **D-24** + **G0 gate** (05); README "before P0"; every prompt branches from the named baseline |
| REV-02 | TomTom bbox used lat-first order | Incident Details docs require `minLon,minLat,maxLon,maxLat`; code/tests were lat-first | **F-23** (01); P0 T4c fixes the order and test; P1 T4 adds an area guard |
| REV-03 | Loading never cleared after a first-attempt success; zero savings redirected | `page.tsx:126`; `routes/page.tsx:21` | **F-24**, **F-25** (01); P0 T4/T4b (pure reducer + redirect fix) |
| REV-04 | "Numbers appear in the facts" isn't factual validation (the bus/car swap passes) | P1 T5 spec; swap counterexample | **Numbers by reference** rewrite: P1 T5 (`narrate.ts`/`validate-claims.ts`), 02 §7.3, shared vectors incl. swap |
| REV-05 | Placeholder bus times and unfunded rewards reached live users | GTFS check: 32/62 stops > 800 m from CARTA; three unfunded reward schemes | **D-21** → `unavailable`; **D-25** rewards gate; **F-26**; signed cost difference (P1 T3/T6, 02 §8.1) |
| REV-06 | `arrive_by` could pick a bus that already left | P4 compare algorithm | Boardability rules + `basis` enum (P4a T2); `no_boardable_trip` reason; 02 §8.3 |
| REV-07 | Rollback couldn't restore an overwritten value | P3 upserts + P2 delete-based rollback | Append-only observations + `current_*` views; `tda runs rollback` marks `rolled_back`; versioned facts (02 §6.0/6.1; P2 T3/T6; P3 steps 2–3) |
| REV-08 | Reader couldn't see freshness; CI never created roles; DB tests could skip | P2 T3/T8/T11 | `source_freshness` view; `tda db bootstrap`; `TDA_REQUIRE_DB_TESTS=1`; plain `postgresql://` URLs (P2 T3/T10/T11) |
| REV-09 | Phase graph omitted needed artifacts | P5 needs P1's vectors; P4a endpoints need 3.6/3.7 tables | P5 depends on **P1 + P4a**; P4a builds conditional endpoints; `export-stops` moved to P4a; Typer sub-apps (P4a T6/T7; P5 preconditions; P2 T9) |
| REV-10 | Engagement isn't mode shift | P7 events were clicks/views only | Measurement tiers + **D-26** (02 §12; P7 §7b, tier-labeled) |
| REV-11 | Traffic volume was presented as congestion | 02 §7.2; P5 "congestion hotspots"; P6 "congestion context" | Renamed to **volume** throughout (`get_volume_profile`, `volume.py`, `volume_hotspots`; 02 §9; P4a T3; P5 T4; P6 T5) |
| REV-12 | Budget/validation gaps where side effects happen | P5 T1–T3 | Model gets **no write tools**; runtime submits after validation; atomic budget reservation; rate limiting before public deploy (P5 T1–T3; P7 §7a) |

## 2. Smaller corrections (all valid)

| Correction | Where addressed |
|------------|-----------------|
| Stop count is 62, not 66 | 01 (F-06, F-20); P0 T10 corrects the CHANGELOG entry |
| Say "unverified" not "synthetic" for the stops | 01 (F-06), README TL;DR |
| The model is *fed* NYC data, not *trained* on it | 01 (F-07), 00 |
| The `@hookform/resolvers` major bump is optional | P0B (only `lucide-react` required for React 19) |
| Keep each fake-timer test on its own clock (15:00 / 10:00) | P0 T2 |
| Give `psql` a plain URL, not the SQLAlchemy form | P2/P3/P4/P6 verification blocks |
| Explicit hosts and asserting `curl`/`jq -e` in commands | P0/P1/P4/P6 verification blocks |
| One schema for manual runs (`acquisition`) and one retention model | 03 §3.1; 02 §6; P2 T3 |
| Say "no public API found"; Transitland flags are registry metadata | 03 (S-8, S-1) |
| Say "no 14.x fix is currently published" not "unpatchable" | 01 (F-22) |

## 3. Reassessment — what the review missed (A1…A11)

| ID | Issue | Where addressed |
|----|-------|-----------------|
| A1 | The 02 fact example modeled TomTom 15-minute sampling, which D-7's default forbids | 02 §6.3 replaced with an NTD-based example |
| A2 | `INSIGHTS_ENGINE=legacy` kept a runtime switch back to invented numbers | **D-27**; P1 has one v2 engine; P7 drops the removal step |
| A3 | After P1 the live app never calls `model_service`, yet P2 compose still ran it | Dropped from P2 compose; re-added at P6 per D-10 (decided at G1) |
| A4 | Three conflicting, unfulfillable reward schemes | **F-26**; gated by **D-25** (rewards demo-only until an offer inventory exists) |
| A5 | The P0 weekend demo targeted Folly Beach (3.7 km from any CARTA stop) | Isle of Palms / 14th Ave (~342 m); P0 T4, P4b task 5, 05 §2b |
| A6 | README claimed "the LLM invents every number", but the stats pages use unsourced constants | README TL;DR reworded |
| A7 | Stop evidence needed measurement (32/62 > 800 m; 1 exact name match) | 01 (F-06) rewritten with measured GTFS evidence |
| A8 | CARTA `feed_info.txt` has an empty `feed_license` | 03 (S-1): license flags are registry metadata only |
| A9 | The CHANGELOG 0.2.1 entry claimed 66 stops | Folded into **F-20**; P0 T10 corrects it |
| A10 | TomTom `arriveAt` confirmed; targets too soon to reach need a fallback | P1 T4 adds `arrival_target_too_soon`; 05 assumptions/D notes |
| A11 | Only the P0 model-ID stopgap is time-critical (`gpt-3.5-turbo` shuts down 2026-10-23) | P0 T8 may ship as a standalone hotfix PR; README time-sensitive note |

## 4. Adjudication

The council verdict on the original package was **REVISE** (two deliberators blocked, none irreducible). This
revision closes every REV/A finding above. The docs are execution-ready pending the human decisions and gate
sign-offs recorded in [05](./05-decisions-and-review.md).
