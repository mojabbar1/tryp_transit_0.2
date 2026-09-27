import { Co2ComparisonSchema } from '@/lib/contracts/transit-insights';
import { calculateEmissions } from '@/lib/domain/emissions';

describe('calculateEmissions', () => {
  it.each([
    [10, 10, 4000, 2900, 1100],
    [0, 0, 0, 0, 0],
    [1, 2, 400, 580, -180],
    // Rounded legs differ by a gram; rounding the raw difference would give zero.
    [0.0013, 0.0013, 1, 0, 1],
  ])('computes grams for drive %s / transit %s miles', (drive, transit, driveGrams, transitGrams, differenceGrams) => {
    const result = calculateEmissions(drive, transit);
    expect(result.driveGrams).toBe(driveGrams);
    expect(result.transitGrams).toBe(transitGrams);
    expect(result.differenceGrams).toBe(differenceGrams);
    expect(result.co2Kg).toEqual({
      drive: driveGrams / 1000, transit: transitGrams / 1000,
      difference: differenceGrams / 1000, factRefs: result.assumptionKeys,
    });
    expect(Co2ComparisonSchema.parse(result.co2Kg)).toEqual(result.co2Kg);
  });

  it('cites every approved factor, including drive-alone occupancy and the bus proxy', () => {
    const result = calculateEmissions(1, 1);
    expect(result.assumptionKeys).toEqual([
      'co2.car_g_per_mile', 'co2.car_occupancy', 'co2.bus_g_per_passenger_mile',
    ]);
    expect(result.co2Kg.factRefs).toEqual(result.assumptionKeys);
  });

  it.each([-1, NaN, Infinity, -Infinity, Number.MAX_VALUE])('surfaces bad drive or transit distance %p', (miles) => {
    expect(() => calculateEmissions(miles, 1)).toThrow(RangeError);
    expect(() => calculateEmissions(1, miles)).toThrow(RangeError);
  });
});
