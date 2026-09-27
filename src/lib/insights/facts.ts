import 'server-only';
import type { Comparison, TrafficDensity } from '@/lib/contracts/transit-insights';
import type { DriveRoute, TrafficIncident } from '@/lib/api/tomtom';
import { assumptions } from '@/lib/domain/assumptions';
import type { TripCost } from '@/lib/domain/cost';
import type { NarrationFact, NarrationFlags } from '@/lib/llm/validate-claims';

const money = (cents: number) => `$${(Math.abs(cents) / 100).toFixed(2)}`;

/** Signed cost phrase: drive − transit, so positive means the bus base fare is cheaper than driving. */
export function costPhrase(differenceCents: number): string {
  if (differenceCents > 0) return `about ${money(differenceCents)} less than driving`;
  if (differenceCents < 0) return `about ${money(differenceCents)} more than driving`;
  return 'about the same as driving';
}

export interface FactInputs {
  route: DriveRoute | null;
  density: TrafficDensity | null;
  cost: TripCost | null;
  incidents: TrafficIncident[] | null;
  transit: Comparison['transit'];
  offerActive: boolean;
}

/**
 * Self-describing facts for narration, rendered by code from measured or approved values only.
 * Labels avoid claim words, so a fact never contradicts the flags built alongside it.
 */
export function buildFacts({ route, density, cost, incidents, transit, offerActive }: FactInputs): {
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
  const fareCents = Math.round(assumptions['transit.base_fare_usd'].value * 100);
  facts.push({ id: 'bus_fare', label: 'Bus fare', phrase: `a ${money(fareCents)} base fare` });
  if (cost) facts.push({ id: 'cost_difference_per_trip', label: 'Cost difference per trip', phrase: costPhrase(cost.differenceCents) });
  if (incidents && incidents.length > 0) {
    const count = incidents.length;
    facts.push({ id: 'incidents_nearby', label: 'Incidents nearby', phrase: `${count} incident${count === 1 ? '' : 's'} reported near the route` });
  }
  return {
    facts,
    flags: {
      transitServiceKnown: transit.basis !== 'unavailable',
      transitFaster: false,
      transitCheaper: cost !== null && cost.differenceCents > 0,
      offerActive,
      trafficNow: density !== null,
    },
  };
}
