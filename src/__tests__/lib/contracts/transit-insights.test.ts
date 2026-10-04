/**
 * Contract tests for src/lib/contracts/transit-insights.ts (P1 T1).
 */

import {
  ComparisonSchema,
  MetaSchema,
  NarrationSchema,
  SourceRefSchema,
  TransitInsightRequestSchema,
  TransitInsightResponseSchema,
} from '@/lib/contracts/transit-insights';
import type { Comparison, Meta } from '@/lib/contracts/transit-insights';
import type {
  AdditionalRide,
  IncentiveDetails,
  LocationInterface,
  RequestBody,
  TransitInsightRequest,
  TransitInsightResponse,
} from '@/types/interfaces';

// Compile-time guard: the legacy shapes that clients already consume must not change (`tsc` fails otherwise).
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
interface LegacyIncentiveDetails {
  type: 'eCredit' | 'partnerDiscount' | 'funReward';
  description: string;
  value: string;
}
interface LegacyAdditionalRide {
  departureTime?: string;
  travelTime: number;
  trafficDensity: 'Light' | 'Medium' | 'Heavy';
}
interface LegacyResponse {
  travelTime: number | null;
  trafficDensity: 'Light' | 'Medium' | 'Heavy' | null;
  costSavingsPerTrip: string | null;
  nudgeMessage: string | null;
  incentiveDetails: LegacyIncentiveDetails | null;
  additionalRides: LegacyAdditionalRide[] | null;
}
interface LegacyRequestBody {
  departure: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  timeToDestination: string;
}
// P4b additions are optional only: the stop ids on the request, and a scheduled ride's arrival and route. A
// scheduled ride has no measured traffic, so `trafficDensity` became optional rather than invented (P4b).
type P4bRideAdditions = 'arrivalTime' | 'routeShortName';
type LegacyRideP4b = Omit<LegacyAdditionalRide, 'trafficDensity'> & { trafficDensity?: LegacyAdditionalRide['trafficDensity'] };
const legacyTypesUnchanged: [
  Same<IncentiveDetails, LegacyIncentiveDetails>,
  Same<Omit<AdditionalRide, P4bRideAdditions>, LegacyRideP4b>,
  Same<Omit<TransitInsightResponse, 'comparison' | 'meta' | 'additionalRides'>, Omit<LegacyResponse, 'additionalRides'>>,
  Same<Omit<RequestBody, 'departureStopId' | 'destinationStopId'>, LegacyRequestBody>,
  Same<RequestBody, TransitInsightRequest>,
  Same<LocationInterface, { lat: number; lng: number }>,
] = [true, true, true, true, true, true];
// Every legacy value is still accepted: an old request and an old ride type-check against the new contract.
const legacyAssignable: [LegacyRequestBody extends RequestBody ? true : false, LegacyAdditionalRide extends AdditionalRide ? true : false] = [true, true];
void legacyAssignable;

const request = {
  departure: { lat: 32.7813, lng: -79.9306 },
  destination: { lat: 32.7878, lng: -79.9512 },
  timeToDestination: '08:30',
};

const reward = { type: 'eCredit', description: 'Transit credit', value: '$2.00' } as const;

// A legacy-shaped response: no comparison, no meta, and therefore no reward (D-25).
const legacyResponse: TransitInsightResponse = {
  travelTime: 22,
  trafficDensity: 'Heavy',
  costSavingsPerTrip: '4.25',
  nudgeMessage: 'Beat the rush hour traffic!',
  incentiveDetails: null,
  additionalRides: [{ departureTime: '08:15', travelTime: 25, trafficDensity: 'Heavy' }],
};

const comparison: Comparison = {
  drive: { minutes: 18, delayMinutes: 4, source: { name: 'TomTom Routing API' } },
  transit: { minutes: null, basis: 'unavailable', nextDepartures: [], source: { name: 'none (pre-GTFS)' } },
  costUsd: { drive: 3.1, transit: 2, difference: 1.1, factRefs: ['drive.fuel_price_usd_per_gal', 'transit.base_fare_usd'] },
  co2Kg: { drive: 1.2, transit: 0.87, difference: 0.33, factRefs: ['co2.car_g_per_mile'] },
};

const meta: Meta = {
  generatedAt: '2026-09-27T16:32:48.518Z',
  region: 'charleston-sc',
  timezone: 'America/New_York',
  demo: false,
  offerActive: false,
  narration: { source: 'template', provider: 'template', validated: false },
  degraded: [],
  citations: ['drive.mpg'],
};

const liveResponse: TransitInsightResponse = {
  ...legacyResponse,
  travelTime: null,
  incentiveDetails: null,
  additionalRides: [],
  comparison,
  meta,
};

const issuePaths = (result: { success: boolean; error?: { issues: { path: (string | number)[] }[] } }) =>
  result.success ? [] : result.error!.issues.map((issue) => issue.path.join('.'));

describe('TransitInsightRequestSchema', () => {
  it('accepts the smoke-test request', () => {
    expect(TransitInsightRequestSchema.parse(request)).toEqual(request);
  });

  it.each(['00:00', '08:30', '23:59'])('accepts %s', (time) => {
    expect(TransitInsightRequestSchema.safeParse({ ...request, timeToDestination: time }).success).toBe(true);
  });

  it.each(['24:00', '8:30', '08:60', '08:30:00', '', '8.30'])('rejects timeToDestination %p', (time) => {
    expect(issuePaths(TransitInsightRequestSchema.safeParse({ ...request, timeToDestination: time }))).toEqual([
      'timeToDestination',
    ]);
  });

  it.each([
    ['departure.lat', { ...request, departure: { lat: 90.0001, lng: 0 } }],
    ['destination.lng', { ...request, destination: { lat: 0, lng: -180.5 } }],
    ['departure.lat', { ...request, departure: { lat: Number.NaN, lng: 0 } }],
  ])('rejects an out-of-range coordinate at %s', (path, body) => {
    expect(issuePaths(TransitInsightRequestSchema.safeParse(body))).toEqual([path]);
  });

  it('reports the path of every missing field', () => {
    expect(issuePaths(TransitInsightRequestSchema.safeParse({ departure: {} })).sort()).toEqual([
      'departure.lat',
      'departure.lng',
      'destination',
      'timeToDestination',
    ]);
  });
});

describe('TransitInsightResponseSchema', () => {
  it('still accepts a legacy-only response (comparison and meta are additive)', () => {
    expect(TransitInsightResponseSchema.safeParse(legacyResponse).success).toBe(true);
  });

  it('accepts a live v2 response', () => {
    expect(TransitInsightResponseSchema.safeParse(liveResponse).success).toBe(true);
  });

  it('rejects an invented bus time while transit timing is unavailable (D-21)', () => {
    expect(issuePaths(TransitInsightResponseSchema.safeParse({ ...liveResponse, travelTime: 22 }))).toEqual(['travelTime']);
    expect(
      issuePaths(
        TransitInsightResponseSchema.safeParse({
          ...liveResponse,
          additionalRides: [{ travelTime: 25, trafficDensity: 'Heavy' }],
        }),
      ),
    ).toEqual(['additionalRides']);
  });

  it('shows an incentive only while meta.offerActive is true (D-25)', () => {
    const withReward = { ...liveResponse, incentiveDetails: reward };
    expect(issuePaths(TransitInsightResponseSchema.safeParse(withReward))).toEqual(['incentiveDetails']);
    expect(TransitInsightResponseSchema.safeParse({ ...withReward, meta: { ...meta, offerActive: true } }).success).toBe(true);
  });

  it('rejects an incentive when meta is omitted, with or without comparison (D-25)', () => {
    const legacyWithReward = { ...legacyResponse, incentiveDetails: reward };
    expect(issuePaths(TransitInsightResponseSchema.safeParse(legacyWithReward))).toEqual(['incentiveDetails']);
    const withoutMeta = { ...legacyResponse, travelTime: null, additionalRides: [], comparison, incentiveDetails: reward };
    expect(issuePaths(TransitInsightResponseSchema.safeParse(withoutMeta))).toEqual(['incentiveDetails']);
  });
});

describe('ComparisonSchema', () => {
  it('has no "estimated" basis', () => {
    const transit = { ...comparison.transit, basis: 'estimated' };
    expect(issuePaths(ComparisonSchema.safeParse({ ...comparison, transit }))).toEqual(['transit.basis']);
  });

  it('carries no minutes or departures when basis is "unavailable"', () => {
    const withMinutes = { ...comparison, transit: { ...comparison.transit, minutes: 22 } };
    const withDepartures = { ...comparison, transit: { ...comparison.transit, nextDepartures: ['08:15'] } };
    expect(issuePaths(ComparisonSchema.safeParse(withMinutes))).toEqual(['transit.minutes']);
    expect(issuePaths(ComparisonSchema.safeParse(withDepartures))).toEqual(['transit.nextDepartures']);
  });

  it('requires minutes for scheduled timing', () => {
    const scheduled = { ...comparison, transit: { ...comparison.transit, basis: 'scheduled' } };
    expect(issuePaths(ComparisonSchema.safeParse(scheduled))).toEqual(['transit.minutes']);
    expect(ComparisonSchema.safeParse({ ...scheduled, transit: { ...scheduled.transit, minutes: 24 } }).success).toBe(true);
  });

  it('keeps a negative cost difference when transit costs more (no zero-clamp)', () => {
    const costUsd = { drive: 1.5, transit: 2, difference: -0.5, factRefs: ['transit.base_fare_usd'] };
    expect(ComparisonSchema.safeParse({ ...comparison, costUsd }).success).toBe(true);
  });

  it.each([
    ['reversed sign', -1.1],
    ['clamped to zero', 0],
    ['absolute value of a negative', 0.5],
  ])('rejects a cost difference that is not drive − transit (%s)', (_label, difference) => {
    const drive = difference === 0.5 ? 1.5 : 3.1;
    const costUsd = { drive, transit: 2, difference, factRefs: ['transit.base_fare_usd'] };
    expect(issuePaths(ComparisonSchema.safeParse({ ...comparison, costUsd }))).toEqual(['costUsd.difference']);
  });

  it('checks the CO2 difference at gram precision and requires a fact reference', () => {
    const co2Kg = { ...comparison.co2Kg!, difference: 0.332 };
    expect(issuePaths(ComparisonSchema.safeParse({ ...comparison, co2Kg }))).toEqual(['co2Kg.difference']);
    const uncited = { ...comparison.costUsd!, factRefs: [] };
    expect(issuePaths(ComparisonSchema.safeParse({ ...comparison, costUsd: uncited }))).toEqual(['costUsd.factRefs']);
  });
});

describe('NarrationSchema (fail closed)', () => {
  it.each([
    [{ source: 'llm', provider: 'gemini', model: 'gemini-3.8-flash', validated: true }],
    [{ source: 'template', provider: 'template', validated: false }],
    [{ source: 'template', provider: 'openai', model: 'gpt-5.6-terra', validated: false }],
  ])('accepts %j', (narration) => {
    expect(NarrationSchema.safeParse(narration).success).toBe(true);
  });

  it.each([
    ['validated', { source: 'llm', provider: 'gemini', validated: false }],
    ['provider', { source: 'llm', provider: 'template', validated: true }],
    ['validated', { source: 'template', provider: 'template', validated: true }],
    ['model', { source: 'template', provider: 'template', model: 'x', validated: false }],
  ])('rejects an inconsistent narration at %s', (path, narration) => {
    expect(issuePaths(NarrationSchema.safeParse(narration))).toEqual([path]);
  });
});

describe('MetaSchema and SourceRefSchema', () => {
  it('accepts snake_case degraded codes and rejects free text', () => {
    expect(MetaSchema.safeParse({ ...meta, degraded: ['arrival_target_too_soon'] }).success).toBe(true);
    const leaky = { ...meta, degraded: ['Request failed: https://api.tomtom.com/?key=abc'] };
    expect(issuePaths(MetaSchema.safeParse(leaky))).toEqual(['degraded.0']);
  });

  it('requires an ISO timestamp', () => {
    expect(issuePaths(MetaSchema.safeParse({ ...meta, generatedAt: 'Sun Sep 27 2026' }))).toEqual(['generatedAt']);
  });

  it('accepts http(s) source links only', () => {
    expect(SourceRefSchema.safeParse({ name: 'EIA', url: 'https://www.eia.gov/', retrieved: '2026-09-27' }).success).toBe(true);
    for (const url of ['javascript:alert(1)', 'not a url', 'ftp://example.com/']) {
      expect(issuePaths(SourceRefSchema.safeParse({ name: 'x', url }))).toEqual(['url']);
    }
  });
});

it('keeps the compile-time legacy-type guard', () => {
  expect(legacyTypesUnchanged.every(Boolean)).toBe(true);
});
