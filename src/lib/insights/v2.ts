import 'server-only';
import {
  type TransitInsightResponse,
  TransitInsightRequestSchema,
  TransitInsightResponseSchema,
} from '@/lib/contracts/transit-insights';
import type { ApiErrorResponse } from '@/types/interfaces';
import { type DriveRoute, getDriveRoute, getTrafficData, type TrafficData } from '@/lib/api/tomtom';
import { calculateCost } from '@/lib/domain/cost';
import { evaluateIncentivePolicy } from '@/lib/domain/incentive-policy';
import { resolveArrival } from '@/lib/domain/time';
import { densityFromFlows } from '@/lib/domain/traffic';
import { getTransitResult } from '@/lib/domain/transit-result';
import { getEnv } from '@/lib/env';
import { COST_FACT_KEYS, costModelFrom, getApprovedFacts } from '@/lib/facts/approved';
import { transitReasonText } from '@/lib/format';
import { narrate } from '@/lib/llm/narrate';
import { getProvider } from '@/lib/llm/provider';
import { renderTemplate } from '@/lib/llm/template';
import { log } from '@/lib/log';
import { buildFacts, costPhrase, leaveByPhrase, NARRATION_FACT_KEYS, onRoute } from './facts';
import { getScheduledTransit, type ScheduleOutcome } from './schedule';

export type InsightsResult =
  | { status: 200; body: TransitInsightResponse }
  | { status: 400; body: ApiErrorResponse };

const REGION = 'charleston-sc';
const TOMTOM_ROUTING = {
  name: 'TomTom Routing API (Calculate Route, arriveAt)',
  url: 'https://developer.tomtom.com/routing-api/documentation/tomtom-maps/calculate-route',
};

/**
 * The single insights engine (D-27: no legacy engine, no switch back to invented numbers). Every number comes from
 * TomTom, the GTFS schedule (data agent, P4b), or approved facts; anything unavailable is omitted and named in
 * `meta.degraded`. No prediction service is called on this path (F-07). With the data agent off or down, this is
 * the P1 behavior plus `data_agent_unavailable` (the rollback path).
 */
export async function buildTransitInsights(
  input: unknown,
  options: { now?: Date; requestId?: string } = {},
): Promise<InsightsResult> {
  const started = Date.now();
  const now = options.now ?? new Date();
  const { requestId } = options;

  const request = TransitInsightRequestSchema.safeParse(input);
  if (!request.success) {
    const paths = [...new Set(request.error.issues.map((issue) => issue.path.join('.') || '(body)'))];
    return { status: 400, body: { error: 'Invalid request', details: paths.join(', ') } };
  }
  const { departure, destination, timeToDestination, departureStopId, destinationStopId } = request.data;
  const env = getEnv();
  const arrival = resolveArrival(timeToDestination, now, env.regionTimezone);
  const degraded = new Set<string>();

  // The schedule and the approved facts come from the data agent; they run alongside TomTom.
  const schedulePromise = getScheduledTransit(env, {
    departure,
    destination,
    departureStopId,
    destinationStopId,
    arriveBy: timeToDestination,
    arrivalUtc: arrival.arrivalUtc,
    now,
  }).catch((): ScheduleOutcome | null => null);
  const factsPromise = getApprovedFacts(env, COST_FACT_KEYS).catch(() => null);

  let route: DriveRoute | null = null;
  let traffic: TrafficData | null = null;
  if (env.tomtomApiKey) {
    const [routed, flowed] = await Promise.allSettled([
      getDriveRoute(env.tomtomApiKey, departure, destination, new Date(arrival.arrivalUtc), now, env.regionTimezone),
      getTrafficData(env.tomtomApiKey, departure, destination),
    ]);
    if (routed.status === 'fulfilled') {
      route = routed.value.route;
      routed.value.degraded.forEach((code) => degraded.add(code));
    } else {
      degraded.add('drive_route_unavailable');
    }
    if (flowed.status === 'fulfilled') {
      traffic = flowed.value;
      traffic.degraded.forEach((code) => degraded.add(code));
    } else {
      degraded.add('traffic_flow_unavailable');
    }
  } else {
    degraded.add('traffic_not_configured');
  }

  const [scheduleResult, approved] = await Promise.all([schedulePromise, factsPromise]);

  const density = traffic ? densityFromFlows(traffic.flows) : null;
  if (traffic && density === null) degraded.add('traffic_flow_unavailable');

  // Cost inputs: the approved facts from the data agent, else the approved 05 §2 values as a whole (a flagged
  // fallback). Either way each value comes with the sources of where it came from, never another's.
  approved?.degraded.forEach((code) => degraded.add(code));
  const costModel = costModelFrom(approved);
  if (costModel.localFallback) degraded.add('assumptions_local_fallback');
  const cost = route ? calculateCost(route.distanceMiles, costModel.values) : null;
  cost?.degraded.forEach((code) => degraded.add(code));
  if (!cost) degraded.add('cost_unavailable');
  // CO2 needs a bus distance; the schedule gives minutes, not miles, and the drive distance is not an approved proxy.
  degraded.add('co2_transit_distance_unavailable');

  const schedule = scheduleResult;
  if (!schedule) degraded.add('data_agent_unavailable');
  schedule?.degraded.forEach((code) => degraded.add(code));
  const transit = schedule?.transit ?? getTransitResult();
  const trip = schedule?.trip ?? null;
  const reasonText = transitReasonText(schedule?.reason) ?? undefined;
  const incentive = evaluateIncentivePolicy();

  const { facts, flags } = buildFacts({
    route,
    density,
    cost,
    incidents: traffic?.incidents ?? null,
    transit,
    offerActive: incentive.offerActive,
    fareUsd: costModel.values.baseFareUsd,
    trip,
    alert: schedule?.alerts[0] ?? null,
    timeZone: env.regionTimezone,
    now,
  });
  const template = renderTemplate({
    density,
    drivePhrase: route ? `about ${route.minutes} min by car` : undefined,
    cost: cost ? { differenceCents: cost.differenceCents, phrase: costPhrase(cost.differenceCents) } : undefined,
    basis: transit.basis,
    busPhrase: trip ? `about ${trip.minutes} min${onRoute(trip)}` : undefined,
    leaveByPhrase: trip ? leaveByPhrase(trip, env.regionTimezone, now) : undefined,
    reasonText,
  });
  const outcome = await narrate({ provider: getProvider(env), facts, flags, timeoutMs: env.llmTimeoutMs, template });
  if (outcome.fallbackReason) {
    degraded.add('narration_fallback');
    log.warn('narration_fallback', { requestId, reason: outcome.fallbackReason, provider: outcome.narration.provider });
  }

  // Cite only what the response shows: every cost input when a cost was computed, and otherwise the approved facts
  // behind any figure the served narration quotes (the fare alone needs no drive). The template quotes no fare.
  const narratedKeys = new Set((outcome.factIds ?? []).flatMap((id) => NARRATION_FACT_KEYS[id] ?? []));
  const citedCostKeys = COST_FACT_KEYS.filter((key) => cost !== null || narratedKeys.has(key));
  const sources = [...citedCostKeys.flatMap((key) => costModel.sources[key] ?? []), ...(schedule?.citations ?? [])];
  const citations = [...new Set([...citedCostKeys, ...sources.map((source) => source.ref)])];
  const body: TransitInsightResponse = {
    travelTime: schedule?.travelTime ?? null,
    trafficDensity: density,
    costSavingsPerTrip: cost ? (cost.differenceCents / 100).toFixed(2) : null,
    nudgeMessage: outcome.nudge,
    incentiveDetails: incentive.incentiveDetails,
    additionalRides: schedule?.additionalRides ?? [],
    comparison: {
      drive: route
        ? { minutes: route.minutes, delayMinutes: route.delayMinutes, source: { ...TOMTOM_ROUTING, retrieved: now.toISOString() } }
        : null,
      transit,
      ...(cost ? { costUsd: cost.costUsd } : {}),
    },
    meta: {
      generatedAt: now.toISOString(),
      region: REGION,
      timezone: env.regionTimezone,
      demo: false,
      offerActive: incentive.offerActive,
      narration: outcome.narration,
      degraded: [...degraded],
      citations,
      ...(density ? { trafficDensityLabel: 'Traffic now' as const } : {}),
      ...(sources.length ? { sources } : {}),
    },
  };

  const checked = TransitInsightResponseSchema.safeParse(body);
  if (!checked.success) {
    log.warn('response_contract_mismatch', { requestId, paths: checked.error.issues.map((issue) => issue.path.join('.')) });
  }
  log.info('transit_insights', {
    requestId,
    durationMs: Date.now() - started,
    narration: outcome.narration.source,
    transitBasis: transit.basis,
    degraded: body.meta?.degraded,
  });
  return { status: 200, body };
}
