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

/** The approved values the marginal-cost model reads. P4b supplies them from /v1/assumptions when it can. */
export type CostValues = {
  fuelPriceUsdPerGal: number;
  mpg: number;
  maintenanceUsdPerMile: number;
  baseFareUsd: number;
};

/** The approved 05 §2 values in assumptions.ts: the flagged fallback when the fact store can't supply them. */
export const LOCAL_COST_VALUES: CostValues = {
  fuelPriceUsdPerGal: assumptions['drive.fuel_price_usd_per_gal'].value,
  mpg: assumptions['drive.mpg'].value,
  maintenanceUsdPerMile: assumptions['drive.maintenance_usd_per_mile'].value,
  baseFareUsd: assumptions['transit.base_fare_usd'].value,
};

/** Marginal-cost comparison against the approved fixed-route base fare, not a fare quote.
 * Parking is excluded: its rate is approved, but its applicability is not.
 * Total ownership cost is reserved for annual statistics, never this calculation.
 */
export function calculateCost(distanceMiles: number, values: CostValues = LOCAL_COST_VALUES): TripCost {
  if (!Number.isFinite(distanceMiles) || distanceMiles < 0) {
    throw new RangeError('Expected a finite, nonnegative distance in miles');
  }
  if (!(values.mpg > 0) || ![values.fuelPriceUsdPerGal, values.maintenanceUsdPerMile, values.baseFareUsd].every((v) => Number.isFinite(v) && v >= 0)) {
    throw new RangeError('Expected positive mpg and finite, nonnegative prices');
  }
  const perMile = values.fuelPriceUsdPerGal / values.mpg + values.maintenanceUsdPerMile;
  const driveCents = Math.round(distanceMiles * perMile * 100);
  const transitCents = Math.round(values.baseFareUsd * 100);
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
