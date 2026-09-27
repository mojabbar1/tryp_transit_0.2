import type { Comparison } from '@/lib/contracts/transit-insights';

/** D-21: no schedule before GTFS. A base-fare cost assumption is not a trip fare or service promise. */
export function getTransitResult(): Comparison['transit'] {
  return {
    basis: 'unavailable',
    minutes: null,
    nextDepartures: [],
    source: { name: 'none (pre-GTFS)' },
  };
}
