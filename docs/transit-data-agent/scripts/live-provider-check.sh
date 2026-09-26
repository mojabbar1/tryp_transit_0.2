#!/usr/bin/env bash
# Live-provider check: the P1 entry precondition carried over from P0 (reviewer R1, waived at the #3 merge).
#
# A human runs this with real keys already configured for the app (src/.env.local or the environment).
# For each provider it starts the production build, sends one fixed trip to POST /api/transit-insights,
# and asserts: HTTP 200, a trip response that satisfies the app's contract, not the hard-coded fallback,
# and no fallback, parse, or missing-field lines in the server log.
# It never prints keys, prompts, model output, or raw server logs (an error log can include the TomTom
# key inside a request URL). Each provider call is one real, billable request.
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
server_pid=""
curl_pid=""
log=""
body=""

case "$which" in
  gemini) providers="gemini" ;;
  openai) providers="openai" ;;
  both) providers="gemini openai" ;;
  *) echo "usage: $0 [gemini|openai|both]"; exit 2 ;;
esac

stop_server() {
  if [ -n "$server_pid" ]; then kill "$server_pid" 2>/dev/null; wait "$server_pid" 2>/dev/null; fi
  server_pid=""
}
remove_temp() {
  [ -n "$body" ] && rm -f "$body" "$body.code"
  if [ -n "$log" ]; then
    if [ "${KEEP_LOG:-0}" = "1" ]; then echo "   server log kept at $log (may contain secrets; never share it)"; else rm -f "$log"; fi
  fi
  body=""; log=""
}
cleanup() { [ -n "$curl_pid" ] && kill "$curl_pid" 2>/dev/null; curl_pid=""; stop_server; remove_temp; }
trap 'status=$?; cleanup; exit $status' EXIT
trap 'cleanup; trap - EXIT; exit 130' INT
trap 'cleanup; trap - EXIT; exit 143' TERM

port_in_use() {
  if command -v lsof >/dev/null 2>&1; then lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  else curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$port/"; fi
}
if port_in_use; then echo "FAIL: port $port is already in use (set PORT=...)"; exit 1; fi

# The model the app will call: resolved with Next's own env loader (same files and precedence as
# `next start`), then the app's rule `value.trim() || DEFAULT_*_MODEL`. Prints only a model-ID-shaped value.
effective_model() {
  node -e '
    const { loadEnvConfig } = require("@next/env");
    const silent = { info() {}, warn() {}, error() {} };
    const env = loadEnvConfig(process.cwd(), false, silent).combinedEnv;
    const configured = String(env[process.argv[1]] || "").trim();
    const source = require("fs").readFileSync(process.argv[2], "utf8");
    const fallback = (source.match(/DEFAULT_[A-Z]+_MODEL = .([A-Za-z0-9._:-]+)./) || [])[1] || "";
    const id = configured || fallback;
    process.stdout.write(/^[A-Za-z0-9._:\/-]{1,100}$/.test(id) ? id : "(unrecognized model id)");
  ' "$1" "$2" 2>/dev/null || printf '(unknown)'
}

# Classify a failure from the server log without printing it.
diagnose() {
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
    use_gemini=true; model="$(effective_model GEMINI_MODEL lib/api/gemini.ts)"
  else
    use_gemini=false; model="$(effective_model OPENAI_MODEL lib/api/openai.ts)"
  fi
  log="$(mktemp)"; body="$(mktemp)"; ok=1; code="-"
  echo "== $provider ($model)"

  USE_GEMINI="$use_gemini" NEXT_TELEMETRY_DISABLED=1 npx next start -p "$port" >"$log" 2>&1 &
  server_pid=$!
  ready=0
  for _ in $(seq 1 60); do
    if ! kill -0 "$server_pid" 2>/dev/null; then break; fi
    if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$port/api/health"; then ready=1; break; fi
    sleep 1
  done
  if [ "$ready" != 1 ]; then
    echo "   FAIL: the server did not start on port $port (rerun with KEEP_LOG=1 to inspect)"; ok=0
  fi

  if [ "$ok" = 1 ]; then
    health="$(curl -s --max-time 30 "http://127.0.0.1:$port/api/health" || true)"
    if ! printf '%s' "$health" | grep -q '"llm":true'; then
      echo "   FAIL: no key configured for $provider (/api/health configured.llm is false)"; ok=0
    fi
    if ! printf '%s' "$health" | grep -q '"traffic":true'; then
      echo "   FAIL: TomTom key not configured (/api/health configured.traffic is false)"; ok=0
    fi
  fi

  if [ "$ok" = 1 ]; then
    # Backgrounded + wait, so INT/TERM run the cleanup trap immediately instead of after curl returns
    curl -s -o "$body" -w '%{http_code}' --max-time 180 -X POST "http://127.0.0.1:$port/api/transit-insights" \
      -H 'Content-Type: application/json' -d "$trip" >"$body.code" &
    curl_pid=$!
    wait "$curl_pid"; curl_status=$?; curl_pid=""
    code="$(cat "$body.code" 2>/dev/null || echo "-")"
    if [ "$curl_status" != 0 ]; then
      echo "   FAIL: the request did not complete (curl exit $curl_status, e.g. timeout or dropped connection)"; ok=0
    elif [ "$code" != 200 ]; then
      echo "   FAIL: HTTP $code: $(diagnose)"; ok=0
    fi
  fi
  if [ "$ok" = 1 ]; then
    verdict="$(node scripts/validate-trip-response.cjs "$body" 2>/dev/null)"
    case "$verdict" in
      ok) ;;
      fallback) echo "   FAIL: the response is the hard-coded fallback: $(diagnose)"; ok=0 ;;
      not-json) echo "   FAIL: the response is not JSON"; ok=0 ;;
      contract:*) echo "   FAIL: the response breaks the trip contract (${verdict#contract:} missing or invalid)"; ok=0 ;;
      *) echo "   FAIL: could not validate the response"; ok=0 ;;
    esac
    if grep -qE 'Using fallback response|Failed to parse AI response' "$log"; then
      echo "   FAIL: the server used the hard-coded fallback: $(diagnose)"; ok=0
    fi
    if grep -qE 'AI response missing fields|Incentive details missing fields' "$log"; then
      echo "   FAIL: the server logged missing fields in the provider reply"; ok=0
    fi
  fi

  stop_server
  remove_temp

  if [ "$ok" = 1 ]; then
    echo "   PASS: HTTP 200, provider trip JSON matches the contract, no fallback"
    echo "   Record in 05 §7 (P1 row): real-key check PASS, $provider/$model @ $rev, $today"
  else
    fails=$((fails + 1))
  fi
done

echo
if [ "$fails" -eq 0 ]; then echo "LIVE-PROVIDER CHECK PASSED ($providers)"; exit 0; fi
echo "LIVE-PROVIDER CHECK FAILED ($fails provider(s)). If the Gemini legacy SDK rejects the model, that pulls P1's @google/genai migration forward: stop and ask."
exit 1
