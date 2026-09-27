import { ComparisonSchema } from '@/lib/contracts/transit-insights';
import { getTransitResult } from '@/lib/domain/transit-result';

describe('getTransitResult', () => {
  it('returns the contract-valid unavailable leg with no timing, departures, or fare', () => {
    const result = getTransitResult();
    expect(result).toEqual({
      basis: 'unavailable', minutes: null, nextDepartures: [], source: { name: 'none (pre-GTFS)' },
    });
    expect(ComparisonSchema.shape.transit.parse(result)).toEqual(result);
    expect(result).not.toHaveProperty('fare');
    expect(result).not.toHaveProperty('fareCents');
  });

  it('does not share mutable departure arrays across requests', () => {
    getTransitResult().nextDepartures.push('08:30');
    expect(getTransitResult().nextDepartures).toEqual([]);
  });
});
