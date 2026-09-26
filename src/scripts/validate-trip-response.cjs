#!/usr/bin/env node
/**
 * Validate a POST /api/transit-insights response body against the trip contract the app renders
 * (src/types/interfaces.ts TransitInsightResponse, as the live prompt specifies it).
 *
 * Used by docs/transit-data-agent/scripts/live-provider-check.sh. It prints ONLY a fixed verdict
 * (never response content, parser messages, or stack traces), so provider output can't leak:
 *   ok                  usable trip JSON                       (exit 0)
 *   not-json            the body is not parseable JSON        (exit 2)
 *   contract:<field>    a required field is missing or invalid (exit 3)
 *   fallback            the route's hard-coded fallback        (exit 4)
 *
 * Usage: node scripts/validate-trip-response.cjs <body-file>
 */
'use strict';

const fs = require('fs');

// Must match createFallbackResponse() in src/app/api/transit-insights/route.ts
const FALLBACK_NUDGE = 'Take the bus to save money and reduce traffic congestion.';
const DENSITIES = ['Light', 'Medium', 'Heavy'];
const INCENTIVE_TYPES = ['eCredit', 'partnerDiscount', 'funReward'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MONEY = /^-?\d+(\.\d+)?$/;

const positive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
const text = (s) => typeof s === 'string' && s.trim().length > 0;

/** Returns 'ok', 'fallback', or 'contract:<field>' for a parsed body. */
function checkTrip(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'contract:body';
  if (!positive(body.travelTime)) return 'contract:travelTime';
  if (!DENSITIES.includes(body.trafficDensity)) return 'contract:trafficDensity';
  if (typeof body.costSavingsPerTrip !== 'string' || !MONEY.test(body.costSavingsPerTrip)) return 'contract:costSavingsPerTrip';
  if (!text(body.nudgeMessage)) return 'contract:nudgeMessage';
  if (body.nudgeMessage === FALLBACK_NUDGE) return 'fallback';

  const incentive = body.incentiveDetails;
  if (!incentive || typeof incentive !== 'object') return 'contract:incentiveDetails';
  if (!INCENTIVE_TYPES.includes(incentive.type)) return 'contract:incentiveDetails.type';
  if (!text(incentive.description)) return 'contract:incentiveDetails.description';
  if (!text(incentive.value)) return 'contract:incentiveDetails.value';

  if (body.additionalRides !== undefined && body.additionalRides !== null) {
    if (!Array.isArray(body.additionalRides)) return 'contract:additionalRides';
    for (const ride of body.additionalRides) {
      if (!ride || typeof ride !== 'object') return 'contract:additionalRides';
      if (!positive(ride.travelTime)) return 'contract:additionalRides.travelTime';
      if (!DENSITIES.includes(ride.trafficDensity)) return 'contract:additionalRides.trafficDensity';
      if (ride.departureTime !== undefined && !HHMM.test(ride.departureTime)) return 'contract:additionalRides.departureTime';
    }
  }
  return 'ok';
}

/** Returns the verdict for raw body text; never throws. */
function verdictFor(raw) {
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return 'not-json';
  }
  try {
    return checkTrip(body);
  } catch {
    return 'contract:body';
  }
}

const EXIT = { ok: 0, 'not-json': 2, fallback: 4 };

module.exports = { checkTrip, verdictFor, FALLBACK_NUDGE };

if (require.main === module) {
  let verdict;
  try {
    verdict = verdictFor(fs.readFileSync(process.argv[2], 'utf8'));
  } catch {
    verdict = 'not-json';
  }
  process.stdout.write(`${verdict}\n`);
  process.exitCode = EXIT[verdict] ?? 3;
}
