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
  listStops,
  nearestStops,
  searchStops,
  STOP_LIST_LIMIT,
} from '@/lib/api/data-agent';
import type { ServerEnv } from '@/lib/env';
import { citationFromAgent } from '@/lib/facts/approved';

/**
 * P4b: scheduled transit from the data agent (`/v1/compare`, D-6 direct-route lookup), or an honest
 * `unavailable` leg naming why. The only numbers computed here are the in-vehicle + wait minutes, the elapsed minutes
 * from leave-by to arrival (for a like-for-like comparison with the drive, only when both points are at their stops),
 * and a picked stop's distance from its point.
 */

/**
 * The farthest a rider's point may be from the stop it maps to (engineering default, about a five-minute walk,
 * in line with the approved 5-minute `transit.access_buffer_min`). Farther than this, no stop is assumed. The same
 * bound applies to a stop id sent with the point, so the schedule and the drive always describe the same journey.
 */
export const MAX_STOP_DISTANCE_M = 400;
/**
 * The farthest a point may be from its stop and still count as the stop itself (engineering default): coordinate
 * rounding only, since a stop's coordinates rounded to five decimal places stay within 0.8 m of it. One bound for
 * both ends and both mappings (a picked stop's distance and the agent's nearest-stop distance, each to 0.1 m). No walk
 * is measured, so a point any farther, even one inside `MAX_STOP_DISTANCE_M`, leaves the door-to-door time unknown.
 */
export const AT_STOP_TOLERANCE_M = 1;
export const MAX_ALERTS = 3;
const ALERT_HEADER_MAX = 200;
const ALERT_DESCRIPTION_MAX = 500;
// The data agent's great-circle radius for `/v1/stops/nearest` (P4a feeds.py), so both mappings measure alike.
const EARTH_RADIUS_M = 6_371_008.8;
// An exact id search ranks id and code matches first (P4a), so a few results always include the id if it exists.
const STOP_ID_SEARCH_LIMIT = 10;

type AgentEnv = Pick<ServerEnv, 'dataAgentEnabled' | 'dataAgentBaseUrl'>;

export interface ScheduledTrip {
  /** In-vehicle minutes (plus any wait the agent reports): the bus ride itself, not the whole trip. */
  minutes: number;
  /**
   * Elapsed minutes from leaving (the leave-by time: the departure minus the approved walk-to-stop buffer) to the
   * scheduled arrival, which is the span a drive covers too. Only set when that holds like for like: with a leave-by,
   * and with both points at their stops (within `AT_STOP_TOLERANCE_M`, as when picked from the list). The buffer is a
   * fixed allowance, not a measured walk from an arbitrary point to the origin stop, and no walk from the destination
   * stop is measured either, so neither is ever guessed.
   */
  elapsedMinutes?: number;
  leaveBy?: string;
  departure: string;
  arrival: string;
  /** The full times (offset-qualified local ISO, as the agent gives them) behind the HH:MM fields, and the service day. */
  leaveByAt?: string;
  departureAt: string;
  arrivalAt: string;
  serviceDate: string;
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

function unavailable(
  degraded: string[],
  extra: Partial<Pick<ScheduleOutcome, 'reason' | 'citations'>> & { targetAt?: string } = {},
): ScheduleOutcome {
  const reason = extra.reason ?? null;
  return {
    transit: {
      basis: 'unavailable',
      minutes: null,
      nextDepartures: [],
      source: UNAVAILABLE_SOURCE,
      ...(reason ? { reason, routing: 'direct_only' as const } : {}),
      ...(extra.targetAt ? { targetAt: extra.targetAt } : {}),
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
  const leaveBy = trip.leave_by === null ? null : Date.parse(trip.leave_by);
  return (
    trip.basis === 'scheduled'
    && Number.isFinite(departure)
    && Number.isFinite(arrival)
    && arrival >= departure
    && departure >= now.getTime()
    && (leaveBy === null || (Number.isFinite(leaveBy) && leaveBy <= departure))
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

/** Great-circle distance in meters (haversine), as the data agent computes it, to 0.1 m as its API reports it. */
export function greatCircleMeters(a: LatLng, b: LatLng): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return Math.round(EARTH_RADIUS_M * 2 * Math.asin(Math.min(1, Math.sqrt(h))) * 10) / 10;
}

type StopList = () => ReturnType<typeof listStops>;

/**
 * A stop of the active feed by exact id, or null when the feed has none: the shared stop list first (cached for a day,
 * no rider data; the pickers offer from it), then an exact id search only if that list may have been cut at its limit.
 */
async function findStop(env: AgentEnv, stopList: StopList, id: string): Promise<DataAgentResult<LatLng | null>> {
  const list = await stopList();
  if (!list.ok) return list;
  const listed = list.data.items.find((stop) => stop.id === id);
  if (listed || list.data.items.length < STOP_LIST_LIMIT) return { ok: true, data: listed ?? null };
  const search = await searchStops(env, id, STOP_ID_SEARCH_LIMIT);
  if (!search.ok) return search;
  return { ok: true, data: search.data.items.find((stop) => stop.id === id) ?? null };
}

type StopMappingProblem = 'stop_mapping_unavailable' | 'stop_mapping_unknown_stop' | 'stop_mapping_mismatch';
/** A mapped stop and how far it is from the rider's point (meters, to 0.1 m), or why there is none. */
type StopMapping = { stopId: string; distanceM: number } | { problem: StopMappingProblem };

/**
 * The stop for one end of the trip. A stop id sent with the point is never trusted on its own: it must be a stop of the
 * active feed within `MAX_STOP_DISTANCE_M` of that point, else the schedule would describe another journey than the
 * drive (which always uses the point). Without an id, the point maps to its nearest stop within the same bound.
 */
async function resolveStop(
  env: AgentEnv,
  stopList: StopList,
  point: LatLng,
  explicit: string | undefined,
): Promise<DataAgentResult<StopMapping>> {
  if (explicit) {
    const stop = await findStop(env, stopList, explicit);
    if (!stop.ok) return stop;
    if (!stop.data) return { ok: true, data: { problem: 'stop_mapping_unknown_stop' } };
    const distanceM = greatCircleMeters(point, stop.data);
    return { ok: true, data: distanceM <= MAX_STOP_DISTANCE_M ? { stopId: explicit, distanceM } : { problem: 'stop_mapping_mismatch' } };
  }
  const nearest = await nearestStops(env, point, 1);
  if (!nearest.ok) return nearest;
  const stop = nearest.data.items[0];
  return {
    ok: true,
    data: stop && stop.distance_m <= MAX_STOP_DISTANCE_M ? { stopId: stop.id, distanceM: stop.distance_m } : { problem: 'stop_mapping_unavailable' },
  };
}

/**
 * Minutes from leaving to arriving, comparable with a drive between the same points, or undefined when that can't be
 * established. It needs a leave-by (the departure minus the approved access buffer) and both points at their stops,
 * within `AT_STOP_TOLERANCE_M`: the buffer is a fixed allowance, not a measured walk from an arbitrary point to the
 * origin stop, and no walk from the destination stop to another point is measured either.
 */
function elapsedMinutes(trip: AgentTrip, originDistanceM: number, destinationDistanceM: number): number | undefined {
  if (trip.leave_by === null || originDistanceM > AT_STOP_TOLERANCE_M || destinationDistanceM > AT_STOP_TOLERANCE_M) return undefined;
  return Math.round((Date.parse(trip.arrival) - Date.parse(trip.leave_by)) / 60_000);
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
    ...(best.leave_by ? { leaveByAt: best.leave_by } : {}),
    departureAt: best.departure,
    arrivalAt: best.arrival,
    serviceDate: best.service_date,
    targetAt: compare.target,
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

  // Both ends share one read of the stop list (itself cached for a day), even on a cold cache.
  let stops: ReturnType<StopList> | undefined;
  const stopList: StopList = () => (stops ??= listStops(env));
  const [origin, dest] = await Promise.all([
    resolveStop(env, stopList, input.departure, input.departureStopId),
    resolveStop(env, stopList, input.destination, input.destinationStopId),
  ]);
  if (!origin.ok || !dest.ok) return unavailable(['data_agent_unavailable']);
  if (!('stopId' in origin.data) || !('stopId' in dest.data)) {
    const problems = [...new Set([origin.data, dest.data].flatMap((mapping) => ('problem' in mapping ? [mapping.problem] : [])))];
    // An id the active feed doesn't have gets the same rider-facing reason the schedule lookup would give.
    return unavailable(problems, problems.includes('stop_mapping_unknown_stop') ? { reason: 'unknown_stop' } : {});
  }
  if (origin.data.stopId === dest.data.stopId) return unavailable(['stop_mapping_same_stop']);

  const result = await compareTrip(env, {
    originStopId: origin.data.stopId,
    destStopId: dest.data.stopId,
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
      ? unavailable([], { reason: compare.reason, citations, targetAt: compare.target })
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
    departureAt: trip.departure,
    arrivalAt: trip.arrival,
    serviceDate: trip.service_date,
  }));
  const leaveBy = best.leave_by ? localHhmm(best.leave_by) ?? undefined : undefined;
  const elapsed = elapsedMinutes(best, origin.data.distanceM, dest.data.distanceM);
  return {
    transit: scheduledLeg(compare, best, alternatives, minutes, alerts.alerts),
    travelTime: minutes,
    additionalRides,
    trip: {
      minutes,
      ...(elapsed !== undefined ? { elapsedMinutes: elapsed } : {}),
      ...(leaveBy ? { leaveBy } : {}),
      departure: localHhmm(best.departure) as string,
      arrival: localHhmm(best.arrival) as string,
      ...(best.leave_by ? { leaveByAt: best.leave_by } : {}),
      departureAt: best.departure,
      arrivalAt: best.arrival,
      serviceDate: best.service_date,
      routeId: best.route_id,
      ...(best.route_short_name ? { routeShortName: best.route_short_name } : {}),
    },
    reason: null,
    alerts: alerts.alerts,
    citations: [...citations, ...alerts.citations],
    degraded: alerts.degraded,
  };
}
