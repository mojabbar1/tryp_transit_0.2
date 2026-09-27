import type { Comparison } from '@/lib/contracts/transit-insights';
import { assumptions, type AssumptionKey } from './assumptions';

export type TripCost = {
  driveCents: number;
  transitCents: number;
  differenceCents: number;
  assumptionKeys: AssumptionKey[];
  costUsd: NonNullable<Comparison['costUsd']>;
  degraded: ['parking_not_approved'];
};

/** Marginal-cost comparison against the approved fixed-route base fare, not a fare quote.
 * Parking is excluded: its rate is approved, but its applicability is not.
 * Total ownership cost is reserved for annual statistics, never this calculation.
 */
export function calculateCost(distanceMiles: number): TripCost {
  if (!Number.isFinite(distanceMiles) || distanceMiles < 0) {
    throw new RangeError('Expected a finite, nonnegative distance in miles');
  }
  const perMile = assumptions['drive.fuel_price_usd_per_gal'].value / assumptions['drive.mpg'].value
    + assumptions['drive.maintenance_usd_per_mile'].value;
  const driveCents = Math.round(distanceMiles * perMile * 100);
  const transitCents = Math.round(assumptions['transit.base_fare_usd'].value * 100);
  if (!Number.isSafeInteger(driveCents)) throw new RangeError('Trip cost exceeds safe integer cents');
  const differenceCents = driveCents - transitCents;
  const assumptionKeys: AssumptionKey[] = [
    'cost.basis',
    'drive.fuel_price_usd_per_gal',
    'drive.mpg',
    'drive.maintenance_usd_per_mile',
    'transit.base_fare_usd',
  ];
  return {
    driveCents,
    transitCents,
    differenceCents,
    assumptionKeys,
    costUsd: {
      drive: driveCents / 100,
      transit: transitCents / 100,
      difference: differenceCents / 100,
      factRefs: [...assumptionKeys],
    },
    degraded: ['parking_not_approved'],
  };
}
