/**
 * Demo scenarios and the demo route (P1 T6/T8): contract-valid, badged as demo, and off unless NEXT_PUBLIC_DEMO_MODE.
 */

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/transit-insights-demo/route';
import { TransitInsightResponseSchema } from '@/lib/contracts/transit-insights';
import { DEMO_SCENARIO_IDS, demoResponse } from '@/lib/demo/scenarios';

const saved = process.env.NEXT_PUBLIC_DEMO_MODE;
afterEach(() => {
  jest.useRealTimers();
  if (saved === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE;
  else process.env.NEXT_PUBLIC_DEMO_MODE = saved;
});

const call = (payload: unknown) =>
  POST(new NextRequest('http://localhost/api/transit-insights-demo', { method: 'POST', body: JSON.stringify(payload) }));

describe('demo scenarios', () => {
  it.each(DEMO_SCENARIO_IDS)('%s parses with the response schema and is marked demo', (id) => {
    const response = demoResponse(id, new Date('2026-09-27T12:00:00Z'));
    expect(TransitInsightResponseSchema.safeParse(response).success).toBe(true);
    expect(response.meta).toMatchObject({ demo: true, offerActive: true });
  });
});

describe('POST /api/transit-insights-demo', () => {
  it('is off (404) unless NEXT_PUBLIC_DEMO_MODE is "true"', async () => {
    delete process.env.NEXT_PUBLIC_DEMO_MODE;
    expect((await call({ demoScenario: 'weekend' })).status).toBe(404);
    process.env.NEXT_PUBLIC_DEMO_MODE = 'false';
    expect((await call({ demoScenario: 'weekend' })).status).toBe(404);
  });

  it('serves the requested scenario in demo mode, falling back to rush-hour', async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = 'true';
    jest.useFakeTimers();
    const pending = call({ demoScenario: 'weekend' });
    await jest.advanceTimersByTimeAsync(3000);
    const weekend = await (await pending).json();
    expect(weekend).toMatchObject({ trafficDensity: 'Light', meta: { demo: true } });

    const fallback = call({ demoScenario: '__proto__' });
    await jest.advanceTimersByTimeAsync(3000);
    expect(await (await fallback).json()).toMatchObject({ trafficDensity: 'Heavy', costSavingsPerTrip: '4.25' });
  });
});
