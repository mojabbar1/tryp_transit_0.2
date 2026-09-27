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
import { narrate } from '@/lib/llm/narrate';
import { getProvider } from '@/lib/llm/provider';
import { renderTemplate } from '@/lib/llm/template';
import { log } from '@/lib/log';
import { buildFacts, costPhrase } from './facts';

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
 * TomTom or the approved assumptions; anything unavailable is omitted and named in `meta.degraded`. No prediction
 * service is called on this path (F-07).
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
  const { departure, destination, timeToDestination } = request.data;
  const env = getEnv();
  const arrival = resolveArrival(timeToDestination, now, env.regionTimezone);
  const degraded = new Set<string>();

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

  const density = traffic ? densityFromFlows(traffic.flows) : null;
  if (traffic && density === null) degraded.add('traffic_flow_unavailable');
  const cost = route ? calculateCost(route.distanceMiles) : null;
  cost?.degraded.forEach((code) => degraded.add(code));
  if (!cost) degraded.add('cost_unavailable');
  // CO2 needs a bus distance, and there is none before GTFS (P4); the drive distance is not an approved proxy.
  degraded.add('co2_transit_distance_unavailable');
  const transit = getTransitResult();
  const incentive = evaluateIncentivePolicy();

  const { facts, flags } = buildFacts({
    route,
    density,
    cost,
    incidents: traffic?.incidents ?? null,
    transit,
    offerActive: incentive.offerActive,
  });
  const template = renderTemplate({
    density,
    drivePhrase: route ? `about ${route.minutes} min by car` : undefined,
    cost: cost ? { differenceCents: cost.differenceCents, phrase: costPhrase(cost.differenceCents) } : undefined,
    basis: transit.basis,
  });
  const outcome = await narrate({ provider: getProvider(env), facts, flags, timeoutMs: env.llmTimeoutMs, template });
  if (outcome.fallbackReason) {
    degraded.add('narration_fallback');
    log.warn('narration_fallback', { requestId, reason: outcome.fallbackReason, provider: outcome.narration.provider });
  }

  const body: TransitInsightResponse = {
    travelTime: null,
    trafficDensity: density,
    costSavingsPerTrip: cost ? (cost.differenceCents / 100).toFixed(2) : null,
    nudgeMessage: outcome.nudge,
    incentiveDetails: incentive.incentiveDetails,
    additionalRides: [],
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
      citations: cost ? [...cost.assumptionKeys] : [],
      ...(density ? { trafficDensityLabel: 'Traffic now' as const } : {}),
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
    degraded: body.meta?.degraded,
  });
  return { status: 200, body };
}
