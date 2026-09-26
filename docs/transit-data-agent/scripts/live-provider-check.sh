#!/usr/bin/env bash
# Live-provider check: the P1 entry precondition carried over from P0 (reviewer R1, waived at the #3 merge).
#
# A human runs this with real keys already configured for the app (src/.env.local or the environment).
# For each provider it starts the production build, sends one fixed trip to POST /api/transit-insights,
# and asserts: HTTP 200, trip JSON, not the hard-coded fallback, and no parse/route errors in the log.
# It never prints keys, prompts, model output, or raw server logs (an error log can include the
# TomTom key inside a request URL). Each provider call is one real, billable request.
#
# Usage:  bash docs/transit-data-agent/scripts/live-provider-check.sh [gemini|openai|both]   (default: both)
#   SKIP_BUILD=1  reuse the existing production build      PORT=3290  port for the temporary server
#   KEEP_LOG=1    keep the server log (it may contain secrets; never share it)
set -uo pipefail
cd "$(git rev-parse --show-toplevel)/src" || { echo "not a git repo"; exit 1; }

which="${1:-both}"
port="${PORT:-3290}"
rev="$(git rev-parse --short HEAD)"
today="$(date +%Y-%m-%d)"
trip='{"departure":{"lat":32.7872,"lng":-79.9416},"destination":{"lat":32.7878,"lng":-79.9512},"timeToDestination":"08:30"}'
fallback_nudge='Take the bus to save money and reduce traffic congestion.'
server_pid=""

case "$which" in
  gemini) providers="gemini" ;;
  openai) providers="openai" ;;
  both) providers="gemini openai" ;;
  *) echo "usage: $0 [gemini|openai|both]"; exit 2 ;;
esac

cleanup() { [ -n "$server_pid" ] && kill "$server_pid" 2>/dev/null; wait 2>/dev/null; }
trap cleanup EXIT

if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$port/"; then
  echo "FAIL: port $port is already in use (set PORT=...)"; exit 1
fi

# Model IDs are not secrets: read only the *_MODEL line from the environment or .env.local.
model_setting() {
  local name="$1" value=""
  case "$name" in
    GEMINI_MODEL) value="${GEMINI_MODEL:-}" ;;
    OPENAI_MODEL) value="${OPENAI_MODEL:-}" ;;
  esac
  if [ -z "$value" ] && [ -f .env.local ]; then
    value="$(grep -E "^${name}=" .env.local | tail -1 | cut -d= -f2- | tr -d "\"' ")"
  fi
  printf '%s' "$value"
}

# Classify a failure from the server log without printing it.
diagnose() {
  local log="$1"
  if grep -q 'TOMTOM_API_KEY environment variable is not set' "$log"; then echo "TomTom key missing"
  elif grep -qE 'status code (401|403)|API key not valid|PERMISSION_DENIED|invalid_api_key|Incorrect API key' "$log"; then echo "a provider rejected the credentials (401/403)"
  elif grep -qE 'status code 404|model_not_found|is not found|NOT_FOUND' "$log"; then echo "model or endpoint not found (check the model ID)"
  elif grep -qE 'status code 429|RESOURCE_EXHAUSTED|insufficient_quota|rate limit' "$log"; then echo "rate limit or quota exceeded"
  elif grep -q 'Failed to parse AI response' "$log"; then echo "the provider reply was not parseable trip JSON (truncated or off-format)"
  else echo "unclassified route error (rerun with KEEP_LOG=1 and inspect locally)"
  fi
}

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "== building the app (next build)"
  NEXT_TELEMETRY_DISABLED=1 npm run build >/dev/null 2>&1 || { echo "FAIL: next build failed (run 'npm run build' in src/ to see why)"; exit 1; }
fi

fails=0
for provider in $providers; do
  if [ "$provider" = gemini ]; then
    use_gemini=true; model="$(model_setting GEMINI_MODEL)"; model="${model:-gemini-3.8-flash}"
  else
    use_gemini=false; model="$(model_setting OPENAI_MODEL)"; model="${model:-gpt-5.6-terra}"
  fi
  log="$(mktemp)"; body="$(mktemp)"; ok=1; code="-"
  echo "== $provider ($model)"

  USE_GEMINI="$use_gemini" NEXT_TELEMETRY_DISABLED=1 npx next start -p "$port" >"$log" 2>&1 &
  server_pid=$!
  for _ in $(seq 1 60); do curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$port/api/health" && break; sleep 1; done

  health="$(curl -s --max-time 30 "http://127.0.0.1:$port/api/health" || true)"
  if ! printf '%s' "$health" | grep -q '"llm":true'; then
    echo "   FAIL: no key configured for $provider (/api/health configured.llm is false)"; ok=0
  fi
  if ! printf '%s' "$health" | grep -q '"traffic":true'; then
    echo "   FAIL: TomTom key not configured (/api/health configured.traffic is false)"; ok=0
  fi

  if [ "$ok" = 1 ]; then
    code="$(curl -s -o "$body" -w '%{http_code}' --max-time 180 -X POST "http://127.0.0.1:$port/api/transit-insights" \
      -H 'Content-Type: application/json' -d "$trip")"
    [ "$code" = 200 ] || { echo "   FAIL: HTTP $code: $(diagnose "$log")"; ok=0; }
  fi
  if [ "$ok" = 1 ]; then
    if ! node -e '
      const b = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      if (typeof b.travelTime !== "number" || typeof b.nudgeMessage !== "string" || !b.trafficDensity) process.exit(1);
      if (b.nudgeMessage === process.argv[2]) process.exit(3);
    ' "$body" "$fallback_nudge"; then
      echo "   FAIL: response is not usable provider trip JSON (missing fields, or the hard-coded fallback)"; ok=0
    fi
    if grep -qE 'Using fallback response|Failed to parse AI response' "$log"; then
      echo "   FAIL: the server used the hard-coded fallback: $(diagnose "$log")"; ok=0
    fi
  fi

  kill "$server_pid" 2>/dev/null; wait "$server_pid" 2>/dev/null; server_pid=""
  if [ "${KEEP_LOG:-0}" = "1" ]; then echo "   server log kept at $log (may contain secrets; never share it)"; else rm -f "$log"; fi
  rm -f "$body"

  if [ "$ok" = 1 ]; then
    echo "   PASS: HTTP 200, provider trip JSON, no fallback"
    echo "   Record in 05 §7 (P1 row): real-key check PASS, $provider/$model @ $rev, $today"
  else
    fails=$((fails + 1))
  fi
done

echo
if [ "$fails" -eq 0 ]; then echo "LIVE-PROVIDER CHECK PASSED ($providers)"; exit 0; fi
echo "LIVE-PROVIDER CHECK FAILED ($fails provider(s)). If the Gemini legacy SDK rejects the model, that pulls P1's @google/genai migration forward: stop and ask."
exit 1
