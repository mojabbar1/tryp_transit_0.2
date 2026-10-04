import 'server-only';
import type {
  AdditionalRide,
  CitationRef,
  Comparison,
  LatLng,
  TransitAlert,
  TransitReason,
} from '@/lib/contracts/transit-insights';
import {
  type AgentCompare,
  type AgentTrip,
  compareTrip,
  type DataAgentResult,
  getAlerts,
  nearestStops,
} from '@/lib/api/data-agent';
import type { ServerEnv } from '@/lib/env';
import { citationFromAgent } from '@/lib/facts/approved';

/**
 * P4b: scheduled transit from the data agent (`/v1/compare`, D-6 direct-route lookup), or an honest
 * `unavailable` leg naming why. No number here is computed by the web app except in-vehicle + wait minutes.
 */

/**
 * The farthest a rider's point may be from the stop it maps to (engineering default, about a five-minute walk,
 * in line with the approved 5-minute `transit.access_buffer_min`). Farther than this, no stop is assumed.
 */
export const MAX_STOP_DISTANCE_M = 400;
export const MAX_ALERTS = 3;
const ALERT_HEADER_MAX = 200;
const ALERT_DESCRIPTION_MAX = 500;

type AgentEnv = Pick<ServerEnv, 'dataAgentEnabled' | 'dataAgentBaseUrl'>;

export interface ScheduledTrip {
  minutes: number;
  leaveBy?: string;
  departure: string;
  arrival: string;
  routeId: string;
  routeShortName?: string;
}

export interface ScheduleOutcome {
  transit: Comparison['transit'];
  travelTime: number | null;
  additionalRides: AdditionalRide[];
  trip: ScheduledTrip | null;
  reason: TransitReason | null;
  alerts: TransitAlert[];
  citations: CitationRef[];
  degraded: string[];
}

const UNAVAILABLE_SOURCE = { name: 'none (schedule unavailable)' };

function unavailable(degraded: string[], extra: Partial<Pick<ScheduleOutcome, 'reason' | 'citations'>> = {}): ScheduleOutcome {
  const reason = extra.reason ?? null;
  return {
    transit: {
      basis: 'unavailable',
      minutes: null,
      nextDepartures: [],
      source: UNAVAILABLE_SOURCE,
      ...(reason ? { reason, routing: 'direct_only' as const } : {}),
    },
    travelTime: null,
    additionalRides: [],
    trip: null,
    reason,
    alerts: [],
    citations: extra.citations ?? [],
    degraded,
  };
}

/** HH:MM as printed in an ISO local time with offset (the agent returns local times), without host-TZ math. */
export function localHhmm(iso: string): string | null {
  const match = /T(\d{2}):(\d{2})/.exec(iso);
  return match ? `${match[1]}:${match[2]}` : null;
}

/** The local calendar date of an instant in `tz` (the GTFS service date to ask about). */
export function localDate(instant: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(instant);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * A trip is usable only when it is internally consistent and hasn't left: the agent already applies the
 * boardability rules, and this is the web app's defense in depth against a phantom or departed bus.
 */
function usableTrip(trip: AgentTrip, now: Date): boolean {
  const departure = Date.parse(trip.departure);
  const arrival = Date.parse(trip.arrival);
  return (
    trip.basis === 'scheduled'
    && Number.isFinite(departure)
    && Number.isFinite(arrival)
    && arrival >= departure
    && departure >= now.getTime()
    && trip.in_vehicle_min >= 0
    && trip.in_vehicle_min <= 24 * 60
    && (trip.wait_min === null || (trip.wait_min >= 0 && trip.wait_min <= 24 * 60))
    && localHhmm(trip.departure) !== null
    && localHhmm(trip.arrival) !== null
  );
}

const tripKey = (trip: AgentTrip) => `${trip.trip_id}|${trip.service_date}`;

// Control and format characters (including bidi overrides) are dropped from alert text; braces too, so the text
// can't look like a narration slot. React escapes the rest when it renders.
const CONTROL = /[\p{Cc}\p{Cf}]/gu;
export function plainAlertText(value: string | null, max: number): string | undefined {
  if (!value) return undefined;
  const text = value.replace(CONTROL, ' ').replace(/<[^>]*>/g, ' ').replace(/[{}<>]/g, '').replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function safeUrl(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

async function resolveStop(env: AgentEnv, point: LatLng, explicit: string | undefined): Promise<DataAgentResult<string | null>> {
  if (explicit) return { ok: true, data: explicit };
  const nearest = await nearestStops(env, point, 1);
  if (!nearest.ok) return nearest;
  const stop = nearest.data.items[0];
  return { ok: true, data: stop && stop.distance_m <= MAX_STOP_DISTANCE_M ? stop.id : null };
}

async function loadAlerts(env: AgentEnv, routeId: string): Promise<{ alerts: TransitAlert[]; citations: CitationRef[]; degraded: string[] }> {
  const result = await getAlerts(env, routeId);
  if (!result.ok) return { alerts: [], citations: [], degraded: ['alerts_unavailable'] };
  const alerts: TransitAlert[] = [];
  for (const item of result.data.items) {
    const header = plainAlertText(item.header_text, ALERT_HEADER_MAX) ?? plainAlertText(item.description_text, ALERT_HEADER_MAX);
    if (!header) continue;
    const description = plainAlertText(item.description_text, ALERT_DESCRIPTION_MAX);
    const url = safeUrl(item.url);
    alerts.push({ header, ...(description && description !== header ? { description } : {}), ...(url ? { url } : {}) });
    if (alerts.length === MAX_ALERTS) break;
  }
  const citations = alerts.length ? result.data.citations.map((citation) => citationFromAgent(citation, 'gtfs_rt.alerts')) : [];
  return { alerts, citations, degraded: [] };
}

function scheduledLeg(compare: AgentCompare, best: AgentTrip, alternatives: AgentTrip[], minutes: number, alerts: TransitAlert[]): Comparison['transit'] {
  const leaveBy = best.leave_by ? localHhmm(best.leave_by) : null;
  const feed = compare.feed;
  return {
    basis: 'scheduled',
    minutes,
    nextDepartures: [best, ...alternatives].map((trip) => localHhmm(trip.departure) as string),
    source: {
      name: `${feed.attribution ?? feed.source_id} GTFS schedule${feed.feed_label ? ` (feed ${feed.feed_label})` : ''}`,
      retrieved: feed.loaded_at,
    },
    routing: 'direct_only',
    ...(leaveBy ? { leaveBy } : {}),
    ...(best.route_short_name ? { routeShortName: best.route_short_name } : {}),
    ...(alerts.length ? { alerts } : {}),
  };
}

/**
 * The transit leg for one request. Never throws for upstream trouble: a disabled, down, slow or malformed agent
 * yields `basis: "unavailable"` and a degraded code. Coordinates and stop ids are never logged here.
 */
export async function getScheduledTransit(
  env: AgentEnv & Pick<ServerEnv, 'regionTimezone'>,
  input: {
    departure: LatLng;
    destination: LatLng;
    departureStopId?: string;
    destinationStopId?: string;
    arriveBy: string;
    arrivalUtc: string;
    now: Date;
  },
): Promise<ScheduleOutcome> {
  if (!env.dataAgentEnabled) return unavailable(['data_agent_unavailable']);

  const [origin, dest] = await Promise.all([
    resolveStop(env, input.departure, input.departureStopId),
    resolveStop(env, input.destination, input.destinationStopId),
  ]);
  if (!origin.ok || !dest.ok) return unavailable(['data_agent_unavailable']);
  if (origin.data === null || dest.data === null) return unavailable(['stop_mapping_unavailable']);
  if (origin.data === dest.data) return unavailable(['stop_mapping_same_stop']);

  const result = await compareTrip(env, {
    originStopId: origin.data,
    destStopId: dest.data,
    date: localDate(new Date(input.arrivalUtc), env.regionTimezone),
    arriveBy: input.arriveBy,
  });
  if (!result.ok) {
    return unavailable([result.reason === 'unavailable' || result.reason === 'rejected' ? 'transit_schedule_unavailable' : 'data_agent_unavailable']);
  }
  const compare = result.data;
  const citations = compare.citations.map((citation) => citationFromAgent(citation, citation.fact_key ?? 'gtfs.schedule'));
  if (!compare.transit) {
    // No trip means no alternatives either, whatever else the payload carries (no phantom trips).
    return compare.reason
      ? unavailable([], { reason: compare.reason, citations })
      : unavailable(['transit_schedule_unavailable']);
  }
  const best = compare.transit;
  if (!usableTrip(best, input.now)) return unavailable(['transit_schedule_unavailable']);

  const seen = new Set([tripKey(best)]);
  const alternatives = compare.alternatives.filter((trip) => {
    if (!usableTrip(trip, input.now) || seen.has(tripKey(trip))) return false;
    seen.add(tripKey(trip));
    return true;
  }).slice(0, 3);

  const minutes = Math.round(best.in_vehicle_min + (best.wait_min ?? 0));
  const alerts = await loadAlerts(env, best.route_id);
  const additionalRides: AdditionalRide[] = alternatives.map((trip) => ({
    departureTime: localHhmm(trip.departure) as string,
    arrivalTime: localHhmm(trip.arrival) as string,
    travelTime: Math.round(trip.in_vehicle_min + (trip.wait_min ?? 0)),
    ...(trip.route_short_name ? { routeShortName: trip.route_short_name } : {}),
  }));
  const leaveBy = best.leave_by ? localHhmm(best.leave_by) ?? undefined : undefined;
  return {
    transit: scheduledLeg(compare, best, alternatives, minutes, alerts.alerts),
    travelTime: minutes,
    additionalRides,
    trip: {
      minutes,
      ...(leaveBy ? { leaveBy } : {}),
      departure: localHhmm(best.departure) as string,
      arrival: localHhmm(best.arrival) as string,
      routeId: best.route_id,
      ...(best.route_short_name ? { routeShortName: best.route_short_name } : {}),
    },
    reason: null,
    alerts: alerts.alerts,
    citations: [...citations, ...alerts.citations],
    degraded: alerts.degraded,
  };
}
