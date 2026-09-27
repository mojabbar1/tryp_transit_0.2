import { CostComparisonSchema } from '@/lib/contracts/transit-insights';
import { assumptions } from '@/lib/domain/assumptions';
import { calculateCost } from '@/lib/domain/cost';

describe('calculateCost', () => {
  it.each([
    [0, 0, -200],
    [1, 30, -170],
    [10, 298, 98],
  ])('computes marginal cost for %s miles without clamping', (miles, driveCents, differenceCents) => {
    const result = calculateCost(miles);
    expect(result.driveCents).toBe(driveCents);
    expect(result.transitCents).toBe(200);
    expect(result.differenceCents).toBe(differenceCents);
    expect(result.costUsd).toEqual({
      drive: driveCents / 100, transit: 2, difference: differenceCents / 100, factRefs: result.assumptionKeys,
    });
    expect(CostComparisonSchema.parse(result.costUsd)).toEqual(result.costUsd);
  });

  it('reports zero savings at the rounded break-even point', () => {
    const perMile = 4.163 / 22.2 + 0.1104;
    expect(calculateCost(2 / perMile).differenceCents).toBe(0);
    expect(calculateCost(2 / perMile).costUsd.difference).toBe(0);
  });

  it('never adds the approved parking rate without approved applicability', () => {
    expect(assumptions['parking.downtown_usd'].value).toBe(24);
    const result = calculateCost(10);
    expect(result.driveCents).toBe(Math.round(10 * (4.163 / 22.2 + 0.1104) * 100));
    expect(result.degraded).toEqual(['parking_not_approved']);
    expect(result.assumptionKeys).not.toContain('parking.downtown_usd');
    expect(result.assumptionKeys).not.toContain('drive.total_cost_usd_per_mile');
    expect(result.costUsd.factRefs).toEqual([
      'cost.basis', 'drive.fuel_price_usd_per_gal', 'drive.mpg',
      'drive.maintenance_usd_per_mile', 'transit.base_fare_usd',
    ]);
  });

  it.each([0.001, 0.0168, 6.71, 17.123456, 100.005])('preserves integer-cent contract arithmetic at %s miles', (miles) => {
    const result = calculateCost(miles);
    expect(result.differenceCents).toBe(result.driveCents - result.transitCents);
    expect(CostComparisonSchema.safeParse(result.costUsd).success).toBe(true);
    expect(result.costUsd.factRefs.length).toBeGreaterThan(0);
  });

  it.each([-1, NaN, Infinity, -Infinity, Number.MAX_VALUE])('surfaces invalid or unrepresentable distance %p', (miles) => {
    expect(() => calculateCost(miles)).toThrow(RangeError);
  });
});
