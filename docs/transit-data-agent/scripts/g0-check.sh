#!/usr/bin/env bash
# G0 baseline gate — mechanical checks only.
#
# This automates the parts of G0 a machine can verify. It CANNOT confirm the human-only items
# (cloud key revocation, decision answers, sign-offs) — those are printed as a reminder checklist.
# Exit 0 = mechanical checks pass; exit 1 = not ready.
#
# Usage:  bash docs/transit-data-agent/scripts/g0-check.sh
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || { echo "not a git repo"; exit 1; }

BASELINE="9b129d6"          # claude-opus4.5-refactor (the assessed code)
fail=0
ok(){ printf '  OK   %s\n' "$*"; }
no(){ printf ' FAIL  %s\n' "$*"; fail=1; }

echo "== G0 mechanical checks =="

# 1. baseline commit is present locally
if git cat-file -t "$BASELINE" >/dev/null 2>&1; then
  ok "baseline commit $BASELINE present"
else
  no "baseline commit $BASELINE missing — run: git fetch origin claude-opus4.5-refactor"
fi

# 2. baseline is merged into the current HEAD (D-24)
if git merge-base --is-ancestor "$BASELINE" HEAD 2>/dev/null; then
  ok "baseline is an ancestor of HEAD (merged)"
else
  no "baseline NOT merged into HEAD — D-24: merge claude-opus4.5-refactor into main first"
fi

# 3. the assessed files the prompts reference actually exist
for f in src/lib/api/tomtom.ts src/jest.config.js; do
  if [ -f "$f" ]; then ok "assessed file present: $f"
  else no "missing assessed file: $f (baseline not merged into this branch)"; fi
done

# 4. no Google API key string sits in tracked files (D-13 — revocation is separate/human)
if git grep -nIE 'AIza[0-9A-Za-z_-]{20,}' -- . >/dev/null 2>&1; then
  no "a Google API key string is present in tracked files — remove it and revoke the key (D-13)"
  git grep -nIE 'AIza[0-9A-Za-z_-]{20,}' -- . | sed 's/^/       /' | head -5
else
  ok "no AIza… key string in tracked files"
fi

# 5. working tree state (informational, not a hard fail)
if [ -z "$(git status --porcelain)" ]; then
  ok "working tree clean"
else
  printf '  NOTE  working tree has uncommitted changes\n'
fi

echo
echo "== Human-only G0 items (cannot be auto-verified) =="
echo "  [ ] Gemini key confirmed REVOKED in Google Cloud, recorded under D-13"
echo "  [ ] Decisions D-4, D-13, D-16, D-24 answered in 05-decisions-and-review.md"
echo "  [ ] G0 checklist signed in 05 §G0; P0 signed off in 05 §7"

echo
if [ "$fail" -eq 0 ]; then
  echo "MECHANICAL G0 CHECKS PASSED — confirm the human-only items above, then P0 may start."
  exit 0
else
  echo "G0 NOT READY — resolve the FAIL lines above before starting P0."
  exit 1
fi
