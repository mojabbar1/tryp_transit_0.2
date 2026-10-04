/**
 * P4b: the server-only data-agent client (src/lib/api/data-agent.ts). `fetch` is mocked; nothing leaves the process.
 */

import {
  clearDataAgentCaches,
  compareTrip,
  DATA_AGENT_TIMEOUT_MS,
  getAssumptions,
  listStops,
  nearestStops,
} from '@/lib/api/data-agent';

const env = { dataAgentEnabled: true, dataAgentBaseUrl: 'http://data-agent.test/prefix' };
const feed = {
  source_id: 's', feed_version_id: 1, feed_label: null, feed_start: '2026-01-01', feed_end: '2026-12-31',
  timezone: 'America/New_York', loaded_at: '2026-10-01T00:00:00Z', attribution: null,
};
const fetchMock = jest.fn();

beforeEach(() => {
  clearDataAgentCaches();
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ feed, items: [] })));
  global.fetch = fetchMock as unknown as typeof fetch;
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('data-agent client', () => {
  it('disabled: never calls fetch and reports disabled', async () => {
    expect(await listStops({ dataAgentEnabled: false, dataAgentBaseUrl: 'http://x.test' })).toEqual({ ok: false, reason: 'disabled' });
    expect(await nearestStops({ dataAgentEnabled: true, dataAgentBaseUrl: undefined }, { lat: 1, lng: 2 })).toEqual({ ok: false, reason: 'disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps a base-URL path prefix and encodes the query', async () => {
    await compareTrip(env, { originStopId: 'A&B', destStopId: 'C D', date: '2026-10-05', arriveBy: '08:30' });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe('/prefix/v1/compare');
    expect(url.searchParams.get('origin_stop_id')).toBe('A&B');
    expect(url.searchParams.get('dest_stop_id')).toBe('C D');
  });

  it('uses a 3 s deadline', () => {
    expect(DATA_AGENT_TIMEOUT_MS).toBe(3000);
  });

  it.each([
    ['a timeout', () => Promise.reject(new DOMException('t', 'TimeoutError')), { ok: false, reason: 'timeout' }],
    ['a network error', () => Promise.reject(new TypeError('fetch failed')), { ok: false, reason: 'unreachable' }],
    ['a 503', () => Promise.resolve(new Response('{}', { status: 503 })), { ok: false, reason: 'unavailable', status: 503 }],
    ['a 422', () => Promise.resolve(new Response('{}', { status: 422 })), { ok: false, reason: 'rejected', status: 422 }],
    ['a 502', () => Promise.resolve(new Response('{}', { status: 502 })), { ok: false, reason: 'http_error', status: 502 }],
    ['non-JSON', () => Promise.resolve(new Response('<html>', { status: 200 })), { ok: false, reason: 'malformed', status: 200 }],
    ['an oversized body', () => Promise.resolve(new Response(' '.repeat(2_000_001), { status: 200 })), { ok: false, reason: 'malformed', status: 200 }],
    ['a wrong shape', () => Promise.resolve(new Response(JSON.stringify({ items: [{ id: 1 }] }))), { ok: false, reason: 'malformed', status: 200 }],
  ])('%s is a typed failure, never data', async (_label, reply, expected) => {
    fetchMock.mockImplementation(reply);
    expect(await nearestStops(env, { lat: 32.78, lng: -79.93 })).toEqual(expected);
  });

  it('rejects a fact that is not approved', async () => {
    const fact = {
      id: 1, key: 'drive.mpg', version: 1, supersedes_id: null, value_num: 22.2, value_text: null, unit: 'mpg', geography: null,
      period: { start: null, end: null }, method: null, sources: [], derived_from: {}, evidence: {}, status: 'candidate',
      confidence: null, valid_until: null,
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ items: [{ key: 'drive.mpg', fact }], missing: [] })));
    expect(await getAssumptions(env)).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('caches the shared stop list but not failures', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    expect((await listStops(env)).ok).toBe(false);
    expect((await listStops(env)).ok).toBe(true);
    expect((await listStops(env)).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never caches a personalized lookup', async () => {
    await nearestStops(env, { lat: 32.78, lng: -79.93 });
    await nearestStops(env, { lat: 32.78, lng: -79.93 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
