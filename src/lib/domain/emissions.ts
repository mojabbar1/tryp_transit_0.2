import type { Comparison } from '@/lib/contracts/transit-insights';
import { assumptions, type AssumptionKey } from './assumptions';

export type TripEmissions = {
  driveGrams: number;
  transitGrams: number;
  differenceGrams: number;
  assumptionKeys: AssumptionKey[];
  co2Kg: NonNullable<Comparison['co2Kg']>;
};

/** Caller supplies both distances explicitly; no bus route distance is inferred.
 * Bus intensity is the approved 2010 national proxy, not a CARTA measurement.
 */
export function calculateEmissions(driveMiles: number, transitMiles: number): TripEmissions {
  if (![driveMiles, transitMiles].every((miles) => Number.isFinite(miles) && miles >= 0)) {
    throw new RangeError('Expected finite, nonnegative drive and transit distances in miles');
  }
  const driveGrams = Math.round(driveMiles * assumptions['co2.car_g_per_mile'].value
    / assumptions['co2.car_occupancy'].value);
  const transitGrams = Math.round(transitMiles * assumptions['co2.bus_g_per_passenger_mile'].value);
  if (!Number.isSafeInteger(driveGrams) || !Number.isSafeInteger(transitGrams)) {
    throw new RangeError('Trip emissions exceed safe integer grams');
  }
  const differenceGrams = driveGrams - transitGrams;
  const assumptionKeys: AssumptionKey[] = [
    'co2.car_g_per_mile', 'co2.car_occupancy', 'co2.bus_g_per_passenger_mile',
  ];
  return {
    driveGrams,
    transitGrams,
    differenceGrams,
    assumptionKeys,
    co2Kg: {
      drive: driveGrams / 1000,
      transit: transitGrams / 1000,
      difference: differenceGrams / 1000,
      factRefs: [...assumptionKeys],
    },
  };
}
