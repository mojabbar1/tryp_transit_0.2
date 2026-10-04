import 'server-only';
import type { Comparison, TrafficDensity, TransitAlert } from '@/lib/contracts/transit-insights';
import type { DriveRoute, TrafficIncident } from '@/lib/api/tomtom';
import type { TripCost } from '@/lib/domain/cost';
import { formatClock } from '@/lib/format';
import type { NarrationFact, NarrationFlags } from '@/lib/llm/validate-claims';
import type { ScheduledTrip } from './schedule';

const money = (cents: number) => `$${(Math.abs(cents) / 100).toFixed(2)}`;

/** Signed cost phrase: drive − transit, so positive means the bus base fare is cheaper than driving. */
export function costPhrase(differenceCents: number): string {
  if (differenceCents > 0) return `about ${money(differenceCents)} less than driving`;
  if (differenceCents < 0) return `about ${money(differenceCents)} more than driving`;
  return 'about the same as driving';
}

/** " on route 10", or "" when the feed has no short name. */
export const onRoute = (trip: Pick<ScheduledTrip, 'routeShortName'>) => (trip.routeShortName ? ` on route ${trip.routeShortName}` : '');

export interface FactInputs {
  route: DriveRoute | null;
  density: TrafficDensity | null;
  cost: TripCost | null;
  incidents: TrafficIncident[] | null;
  transit: Comparison['transit'];
  offerActive: boolean;
  /** The approved base fare in USD, or null when no approved value is available (the fact is then omitted). */
  fareUsd: number | null;
  /** The scheduled direct trip (P4b), if one was found. */
  trip?: ScheduledTrip | null;
  /** The first active alert for the trip's route, already reduced to plain text (P4b). */
  alert?: TransitAlert | null;
}

/**
 * Self-describing facts for narration, rendered by code from measured or approved values only.
 * Labels avoid claim words, so a fact never contradicts the flags built alongside it.
 */
export function buildFacts({ route, density, cost, incidents, transit, offerActive, fareUsd, trip, alert }: FactInputs): {
  facts: NarrationFact[];
  flags: NarrationFlags;
} {
  const facts: NarrationFact[] = [];
  if (density) facts.push({ id: 'traffic_now', label: 'Traffic now', phrase: `${density.toLowerCase()} traffic right now` });
  if (route) {
    facts.push({ id: 'drive_minutes', label: 'Drive time', phrase: `about ${route.minutes} min by car` });
    if (route.delayMinutes > 0) {
      facts.push({ id: 'drive_delay_minutes', label: 'Expected delay', phrase: `about ${route.delayMinutes} min of delay on the drive` });
    }
  }
  if (trip) {
    facts.push({ id: 'bus_minutes', label: 'Scheduled bus', phrase: `about ${trip.minutes} min by bus${onRoute(trip)}` });
    if (trip.leaveBy) facts.push({ id: 'leave_by', label: 'Leave by', phrase: `leave by ${formatClock(trip.leaveBy)}` });
  }
  // The alert is CARTA's text, carried as data: it is quoted, never followed, and the validator still applies to
  // any narration that references it (a phrase that contradicts the flags fails closed).
  if (alert) facts.push({ id: 'service_alert', label: 'Service alert', phrase: `CARTA service alert: “${alert.header}”` });
  if (fareUsd !== null) {
    facts.push({ id: 'bus_fare', label: 'Bus fare', phrase: `a ${money(Math.round(fareUsd * 100))} base fare` });
  }
  if (cost) facts.push({ id: 'cost_difference_per_trip', label: 'Cost difference per trip', phrase: costPhrase(cost.differenceCents) });
  if (incidents && incidents.length > 0) {
    const count = incidents.length;
    facts.push({ id: 'incidents_nearby', label: 'Incidents nearby', phrase: `${count} incident${count === 1 ? '' : 's'} reported near the route` });
  }
  return {
    facts,
    flags: {
      transitServiceKnown: transit.basis !== 'unavailable',
      transitFaster: Boolean(trip && route && transit.basis !== 'unavailable' && trip.minutes < route.minutes),
      transitCheaper: cost !== null && cost.differenceCents > 0,
      offerActive,
      trafficNow: density !== null,
    },
  };
}
