/**
 * P4b: GET /api/stops and GET /api/stats, plus the rollback test (data agent off or unreachable). Upstreams are a
 * mocked `fetch`; every stop and stat below is synthetic test data.
 */

let mockEnvSource: Record<string, string | undefined> = {};
const mockGetDriveRoute = jest.fn();
const mockGetTrafficData = jest.fn();
jest.mock('@/lib/env', () => {
  const actual = jest.requireActual('@/lib/env');
  return { ...actual, getEnv: () => actual.parseEnv(mockEnvSource) };
});
jest.mock('@/lib/api/tomtom', () => ({
  getDriveRoute: (...args: unknown[]) => mockGetDriveRoute(...args),
  getTrafficData: (...args: unknown[]) => mockGetTrafficData(...args),
}));
jest.mock('@/lib/llm/provider', () => ({ getProvider: () => null }));

import { NextRequest } from 'next/server';
import { GET as getStops } from '@/app/api/stops/route';
import { GET as getStatsRoute } from '@/app/api/stats/route';
import { POST as postInsights } from '@/app/api/transit-insights/route';
import { busStopCoordinates } from '@/app/data/busStopCoordinates';
import { clearDataAgentCaches } from '@/lib/api/data-agent';
import { TransitInsightResponseSchema } from '@/lib/contracts/transit-insights';
import { getStopCatalog, looksLikeFixture } from '@/lib/stops/catalog';
import { StopsResponseSchema, stopRequestFields } from '@/lib/stops/types';
import { StatsResponseSchema } from '@/lib/stats/types';

const BASE = 'http://data-agent.test';
const ENABLED = { DATA_AGENT_ENABLED: 'true', DATA_AGENT_BASE_URL: BASE };
const feed = {
  source_id: 'synthetic-gtfs', feed_version_id: 1, feed_label: 'synthetic-1', feed_start: '2026-01-01', feed_end: '2026-12-31',
  timezone: 'America/New_York', loaded_at: '2026-10-01T00:00:00Z', attribution: 'Synthetic test feed',
};
const stopPage = {
  feed,
  items: [
    { id: 'SYN-1', code: null, name: 'Synthetic Alpha', lat: 32.78, lng: -79.93, route_short_names: ['10'] },
    { id: 'SYN-2', code: null, name: 'Synthetic Beta', lat: 32.79, lng: -79.94, route_short_names: ['20', '10'] },
    { id: 'SYN-3', code: null, name: null, lat: 32.8, lng: -79.95, route_short_names: [] },
  ],
};
const stats = {
  items: [
    {
      id: 'ridership.bus.latest_month', label: 'SYN ridership, bus (latest month)', value_num: 1000, value_text: null, unit: 'trips',
      period: { start: '2026-08-01', end: '2026-08-31' },
      citations: [{ source_id: 'synthetic-ntd', attribution: 'Synthetic NTD', fact_id: 11, fact_key: 'syn.ridership.upt.monthly.bus', retrieved: '2026-10-01' }],
    },
    { id: 'uncited', label: 'Uncited', value_num: 5, value_text: null, unit: null, period: { start: null, end: null }, citations: [] },
    { id: 'empty', label: 'Empty', value_num: null, value_text: null, unit: null, period: { start: null, end: null }, citations: [{ source_id: 'x', attribution: null }] },
  ],
};

let replies: Record<string, () => Response>;
const serve = async (input: URL | string) => {
  const reply = replies[new URL(String(input)).pathname];
  return reply ? reply() : new Response('{}', { status: 404 });
};
const fetchMock = jest.fn(serve);
const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });

const stopsRequest = (query = '') => new NextRequest(`http://localhost/api/stops${query}`);

beforeEach(() => {
  clearDataAgentCaches();
  mockEnvSource = { ...ENABLED };
  replies = { '/v1/stops': json(stopPage), '/v1/stats': json(stats) };
  fetchMock.mockReset().mockImplementation(serve);
  global.fetch = fetchMock as unknown as typeof fetch;
  mockGetDriveRoute.mockReset().mockResolvedValue({ route: { minutes: 21, delayMinutes: 4, distanceMiles: 5 }, degraded: [] });
  mockGetTrafficData.mockReset().mockResolvedValue({ flows: [null, null], incidents: [], degraded: [] });
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('GET /api/stops', () => {
  it('proxies the active feed: GTFS stop ids, names, routes, the feed attribution, and a day-long shared cache', async () => {
    const response = await getStops(stopsRequest());
    const body = StopsResponseSchema.parse(await response.json());
    expect(body.source).toBe('data_agent');
    expect(body.stops.map((s) => [s.key, s.kind, s.id, s.name])).toEqual([
      ['stop:SYN-1', 'gtfs_stop', 'SYN-1', 'Synthetic Alpha'],
      ['stop:SYN-2', 'gtfs_stop', 'SYN-2', 'Synthetic Beta'],
      ['stop:SYN-3', 'gtfs_stop', 'SYN-3', 'SYN-3'],
    ]);
    expect(body.feed).toMatchObject({ sourceId: 'synthetic-gtfs', attribution: 'Synthetic test feed' });
    expect(body.citations[0]).toMatchObject({ attribution: 'Synthetic test feed' });
    expect(response.headers.get('cache-control')).toContain('s-maxage=86400');
    const upstream = new URL(String(fetchMock.mock.calls[0][0]));
    expect(upstream.searchParams.get('limit')).toBe('2000');
  });

  it('a search filters on the server, never sends the text upstream, and is private and uncached', async () => {
    await getStops(stopsRequest());
    fetchMock.mockClear();
    const response = await getStops(stopsRequest('?query=beta'));
    const body = StopsResponseSchema.parse(await response.json());
    expect(body.stops.map((s) => s.id)).toEqual(['SYN-2']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    // An exact route name matches too.
    const byRoute = StopsResponseSchema.parse(await (await getStops(stopsRequest('?query=20'))).json());
    expect(byRoute.stops.map((s) => s.id)).toEqual(['SYN-2']);
  });

  it('rejects an oversized query or a bad limit', async () => {
    expect((await getStops(stopsRequest(`?query=${'x'.repeat(101)}`))).status).toBe(400);
    expect((await getStops(stopsRequest('?limit=0'))).status).toBe(400);
    expect((await getStops(stopsRequest('?limit=abc'))).status).toBe(400);
  });

  it.each([
    ['disabled', () => { mockEnvSource = {}; }],
    ['unreachable', () => { fetchMock.mockImplementation(async () => { throw new TypeError('fetch failed'); }); }],
    ['timing out', () => { fetchMock.mockImplementation(async () => { throw new DOMException('timed out', 'TimeoutError'); }); }],
    ['malformed', () => { replies['/v1/stops'] = () => new Response('{"feed":{}}', { status: 200 }); }],
    ['503', () => { replies['/v1/stops'] = json({ detail: 'no active feed' }, 503); }],
    ['empty', () => { replies['/v1/stops'] = json({ feed, items: [] }); }],
  ])('agent %s: no real export exists yet, so the P1 places are served, labeled as places, and flagged', async (_label, arrange) => {
    arrange();
    const response = await getStops(stopsRequest());
    const body = StopsResponseSchema.parse(await response.json());
    expect(body.source).toBe('legacy_places');
    expect(body.stops.every((s) => s.kind === 'place' && s.id === null)).toBe(true);
    expect(body.stops).toHaveLength(Object.keys(busStopCoordinates).length);
    expect(body.degraded).toEqual(['data_agent_unavailable', 'stops_fallback_unavailable']);
    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
  });
});

describe('stop catalog fallback order', () => {
  const disabled = { dataAgentEnabled: false, dataAgentBaseUrl: undefined };

  it('a real committed export is served as GTFS stops when the agent is off', async () => {
    const catalog = await getStopCatalog(disabled, [{ id: '1234', name: 'Meeting St & Mary St', lat: 32.79, lng: -79.93 }]);
    expect(catalog.source).toBe('gtfs_fallback');
    expect(catalog.stops).toEqual([{ key: 'stop:1234', kind: 'gtfs_stop', id: '1234', name: 'Meeting St & Mary St', lat: 32.79, lng: -79.93, routes: [] }]);
  });

  it('fixture or synthetic output is never served as real stops', async () => {
    for (const stops of [
      [{ id: 'FX01', name: 'Fixture Stop 01', lat: 32.774, lng: -79.937 }],
      [{ id: '9', name: 'Synthetic Gamma', lat: 32.7, lng: -79.9 }],
    ]) {
      expect(looksLikeFixture(stops)).toBe(true);
      const catalog = await getStopCatalog(disabled, stops);
      expect(catalog.source).toBe('legacy_places');
      expect(catalog.degraded).toContain('stops_fallback_rejected');
    }
  });
});

describe('rollback: data agent off or unreachable', () => {
  it.each([
    ['DATA_AGENT_ENABLED=false', () => { mockEnvSource = { DATA_AGENT_BASE_URL: BASE, TOMTOM_API_KEY: 'placeholder-tomtom-value' }; }],
    ['unreachable', () => {
      mockEnvSource = { ...ENABLED, TOMTOM_API_KEY: 'placeholder-tomtom-value' };
      fetchMock.mockImplementation(async () => { throw new TypeError('fetch failed'); });
    }],
  ])('%s: stops load from the fallback and a trip is a 200 degraded answer built from its coordinates', async (_label, arrange) => {
    arrange();
    const stops = StopsResponseSchema.parse(await (await getStops(stopsRequest())).json());
    const [from, to] = stops.stops;
    const departure = stopRequestFields(from);
    const destination = stopRequestFields(to);
    expect(departure.stopId).toBeUndefined();
    const response = await postInsights(new NextRequest('http://localhost/api/transit-insights', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ departure: departure.point, destination: destination.point, timeToDestination: '08:30' }),
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(TransitInsightResponseSchema.safeParse(body).success).toBe(true);
    expect(body.comparison.transit).toMatchObject({ basis: 'unavailable', minutes: null, nextDepartures: [] });
    expect(body.travelTime).toBeNull();
    expect(body.meta.degraded).toContain('data_agent_unavailable');
    expect(mockGetDriveRoute.mock.calls[0].slice(1, 3)).toEqual([departure.point, destination.point]);
    expect(body.comparison.drive).toMatchObject({ minutes: 21 });
  });
});

describe('GET /api/stats', () => {
  it('returns only cited, valued stats from approved facts, cached for an hour', async () => {
    const response = await getStatsRoute();
    const body = StatsResponseSchema.parse(await response.json());
    expect(body.available).toBe(true);
    expect(body.items.map((item) => item.id)).toEqual(['ridership.bus.latest_month']);
    expect(body.items[0].citations[0]).toMatchObject({ ref: 'syn.ridership.upt.monthly.bus', factId: 11, attribution: 'Synthetic NTD', retrieved: '2026-10-01' });
    expect(response.headers.get('cache-control')).toContain('s-maxage=3600');
  });

  it('a second request within the hour is served from the shared cache', async () => {
    await getStatsRoute();
    await getStatsRoute();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['disabled', () => { mockEnvSource = {}; }],
    ['down', () => { fetchMock.mockImplementation(async () => { throw new TypeError('fetch failed'); }); }],
    ['malformed', () => { replies['/v1/stats'] = json({ items: [{ id: 1 }] }); }],
    ['a non-approved status leak', () => { replies['/v1/stats'] = json({ items: 'nope' }); }],
  ])('agent %s: unavailable, no numbers, and not cached', async (_label, arrange) => {
    arrange();
    const response = await getStatsRoute();
    const body = StatsResponseSchema.parse(await response.json());
    expect(body).toEqual({ available: false, items: [], degraded: ['data_agent_unavailable'] });
    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
  });

  it('only uncited or empty stats: unavailable rather than uncited numbers', async () => {
    replies['/v1/stats'] = json({ items: stats.items.slice(1) });
    const body = StatsResponseSchema.parse(await (await getStatsRoute()).json());
    expect(body).toEqual({ available: false, items: [], degraded: ['stats_unavailable'] });
  });
});
