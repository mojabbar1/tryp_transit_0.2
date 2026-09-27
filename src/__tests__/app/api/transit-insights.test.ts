/**
 * Route tests for POST /api/transit-insights (P1 T8). TomTom, the LLM provider, and the env are mocked;
 * keys are placeholders and nothing leaves the process.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mockGetDriveRoute = jest.fn();
const mockGetTrafficData = jest.fn();
const mockGetProvider = jest.fn();
let mockEnvSource: Record<string, string | undefined> = {};

jest.mock('@/lib/api/tomtom', () => ({
  getDriveRoute: (...args: unknown[]) => mockGetDriveRoute(...args),
  getTrafficData: (...args: unknown[]) => mockGetTrafficData(...args),
}));
jest.mock('@/lib/llm/provider', () => ({ getProvider: (...args: unknown[]) => mockGetProvider(...args) }));
jest.mock('@/lib/env', () => {
  const actual = jest.requireActual('@/lib/env');
  return { ...actual, getEnv: () => actual.parseEnv(mockEnvSource) };
});

import { NextRequest } from 'next/server';
import vectors from '../../../../contracts/claim-validation.vectors.json';
import { POST } from '@/app/api/transit-insights/route';
import { TransitInsightResponseSchema } from '@/lib/contracts/transit-insights';
import { LlmError } from '@/lib/llm/shared';
import type { LlmProvider } from '@/lib/llm/provider';

const body = {
  departure: { lat: 32.7813, lng: -79.9306 },
  destination: { lat: 32.7878, lng: -79.9512 },
  timeToDestination: '08:30',
};
const flow = { currentSpeed: 20, freeFlowSpeed: 40, currentTravelTime: 90, freeFlowTravelTime: 45, confidence: 1 };
const route = (distanceMiles: number) => ({
  route: { minutes: 21, delayMinutes: 4, distanceMiles, freeFlowMinutes: 17 },
  degraded: [] as string[],
});
const provider = (reply: () => Promise<unknown>): LlmProvider => ({
  name: 'openai',
  model: 'gpt-5.6-terra',
  generateJson: <T,>() => reply() as Promise<T>,
});

async function post(payload: unknown) {
  const request = new NextRequest('http://localhost/api/transit-insights', {
    method: 'POST',
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    headers: { 'content-type': 'application/json' },
  });
  const response = await POST(request);
  return { status: response.status, json: await response.json() };
}

beforeEach(() => {
  mockEnvSource = { TOMTOM_API_KEY: 'placeholder-tomtom-value', LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'placeholder-openai-value' };
  mockGetDriveRoute.mockReset().mockResolvedValue(route(5));
  mockGetTrafficData.mockReset().mockResolvedValue({ flows: [flow, flow], incidents: [], degraded: [] });
  mockGetProvider.mockReset().mockReturnValue(null);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('POST /api/transit-insights (v2)', () => {
  it('happy path: deterministic numbers, validated narration, contract-valid', async () => {
    mockGetProvider.mockReturnValue(
      provider(async () => ({ nudge: 'Traffic now; Drive time: {{drive_minutes}}. Consider transit.', slots: ['drive_minutes'] })),
    );
    const { status, json } = await post(body);

    expect(status).toBe(200);
    expect(TransitInsightResponseSchema.safeParse(json).success).toBe(true);
    expect(json).toMatchObject({
      travelTime: null,
      trafficDensity: 'Heavy',
      additionalRides: [],
      incentiveDetails: null,
      nudgeMessage: 'Traffic now; Drive time: about 21 min by car. Consider transit.',
      comparison: { drive: { minutes: 21, delayMinutes: 4 }, transit: { basis: 'unavailable', minutes: null } },
      meta: { demo: false, offerActive: false, trafficDensityLabel: 'Traffic now', narration: { source: 'llm', provider: 'openai', validated: true } },
    });
    // 5 mi x (4.163 / 22.2 + 0.1104) = 149 cents vs a 200-cent fare
    expect(json.comparison.costUsd).toEqual({ drive: 1.49, transit: 2, difference: -0.51, factRefs: expect.arrayContaining(['transit.base_fare_usd']) });
    expect(json.meta.degraded).toEqual(expect.arrayContaining(['parking_not_approved', 'co2_transit_distance_unavailable']));
  });

  it('keeps a negative difference when transit costs more (no zero-clamp)', async () => {
    const { json } = await post(body);
    expect(json.comparison.costUsd.difference).toBeLessThan(0);
    expect(json.costSavingsPerTrip).toBe('-0.51');
  });

  it('reports a positive difference for a long drive', async () => {
    mockGetDriveRoute.mockResolvedValue(route(20));
    const { json } = await post(body);
    expect(json.comparison.costUsd).toMatchObject({ drive: 5.96, transit: 2, difference: 3.96 });
  });

  it('TomTom down: still 200, with degraded reasons and no invented numbers', async () => {
    mockGetDriveRoute.mockRejectedValue(new Error('timeout'));
    mockGetTrafficData.mockRejectedValue(new Error('down'));
    const { status, json } = await post(body);

    expect(status).toBe(200);
    expect(TransitInsightResponseSchema.safeParse(json).success).toBe(true);
    expect(json).toMatchObject({ trafficDensity: null, costSavingsPerTrip: null, comparison: { drive: null, transit: { basis: 'unavailable' } } });
    expect(json.comparison.costUsd).toBeUndefined();
    expect(json.meta.degraded).toEqual(expect.arrayContaining(['drive_route_unavailable', 'traffic_flow_unavailable', 'cost_unavailable']));
  });

  it('no provider: template narration', async () => {
    const { json } = await post(body);
    expect(json.meta.narration).toEqual({ source: 'template', provider: 'template', validated: false });
    expect(json.nudgeMessage).toContain('Traffic now is heavy, and driving takes about 21 min by car.');
  });

  it('no TomTom key and no provider: template + unavailable (the P1 smoke case)', async () => {
    mockEnvSource = {};
    const { json } = await post(body);
    expect(json.meta.narration.provider).toBe('template');
    expect(json.comparison.transit.basis).toBe('unavailable');
    expect(json.meta.degraded).toContain('traffic_not_configured');
    expect(mockGetDriveRoute).not.toHaveBeenCalled();
  });

  it('provider timeout: template, with the fallback recorded', async () => {
    mockGetProvider.mockReturnValue(provider(async () => { throw new LlmError('llm_timeout'); }));
    const { json } = await post(body);
    expect(json.meta.narration).toEqual({ source: 'template', provider: 'openai', model: 'gpt-5.6-terra', validated: false });
    expect(json.meta.degraded).toContain('narration_fallback');
  });

  it('numbers by reference: a nudge with a digit is rejected and the template is used', async () => {
    mockGetProvider.mockReturnValue(provider(async () => ({ nudge: 'Leave by 8 to beat the traffic.', slots: [] })));
    const { json } = await post(body);
    expect(json.meta.narration.validated).toBe(false);
    expect(json.nudgeMessage).not.toContain('Leave by 8');
  });

  it('swap counterexample from the shared vectors is rejected', async () => {
    const swap = vectors.cases.find((entry) => entry.id === 'swap');
    mockGetProvider.mockReturnValue(provider(async () => ({ nudge: swap?.nudge, slots: swap?.slots })));
    const { json } = await post(body);
    expect(json.meta.narration).toMatchObject({ source: 'template', validated: false });
  });

  it('invalid body: 400 with the issue paths', async () => {
    const { status, json } = await post({ departure: {} });
    expect(status).toBe(400);
    expect(json.details.split(', ').sort()).toEqual(['departure.lat', 'departure.lng', 'destination', 'timeToDestination']);
    expect((await post('not json')).status).toBe(400);
  });

  it('passes the resolved arrival time to getDriveRoute and surfaces arrival_target_too_soon', async () => {
    mockGetDriveRoute.mockResolvedValue({ ...route(5), degraded: ['arrival_target_too_soon'] });
    const { json } = await post(body);
    const [key, dep, dest, arriveAt, now, tz] = mockGetDriveRoute.mock.calls[0];
    expect([key, dep, dest, tz]).toEqual(['placeholder-tomtom-value', body.departure, body.destination, 'America/New_York']);
    expect(arriveAt).toBeInstanceOf(Date);
    expect(arriveAt.getTime()).toBeGreaterThanOrEqual(now.getTime());
    expect(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(arriveAt)).toBe('08:30');
    expect(json.meta.degraded).toContain('arrival_target_too_soon');
  });

  it('never imports or calls the ridership client', () => {
    // Built from parts so the repo-wide DoD grep for the service name stays meaningful.
    const forbidden = new RegExp(['ridership', ['model', 'service'].join('_'), ['model', 'service'].join('-')].join('|'), 'i');
    const files = ['app/api/transit-insights/route.ts', 'lib/insights/v2.ts', 'lib/insights/facts.ts'];
    for (const file of files) {
      const source = readFileSync(join(__dirname, '../../..', file), 'utf8');
      expect(source).not.toMatch(forbidden);
    }
  });

  it('never returns a secret in the response', async () => {
    const { json } = await post(body);
    expect(JSON.stringify(json)).not.toMatch(/placeholder-(tomtom|openai)-value/);
  });
});
