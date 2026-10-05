/**
 * P4b: the server-only data-agent client (src/lib/api/data-agent.ts). `fetch` is mocked; nothing leaves the process.
 */

import {
  clearDataAgentCaches,
  compareTrip,
  DATA_AGENT_TIMEOUT_MS,
  getAssumptions,
  listStops,
  MAX_BODY_BYTES,
  nearestStops,
  reloadStops,
} from '@/lib/api/data-agent';

const env = { dataAgentEnabled: true, dataAgentBaseUrl: 'http://data-agent.test/prefix' };
const feed = {
  source_id: 's', feed_version_id: 1, feed_label: null, feed_start: '2026-01-01', feed_end: '2026-12-31',
  timezone: 'America/New_York', loaded_at: '2026-10-01T00:00:00Z', attribution: null,
};
const point = { lat: 32.78, lng: -79.93 };
const fetchMock = jest.fn();

const CHUNK = 64 * 1024;
const REVIEW_BODY_BYTES = 8_388_608;
/**
 * A pull-only body (high-water mark 0): nothing is produced until the client reads, so `served` is exactly what it
 * consumed, and `cancelled` records whether it gave the stream up.
 */
function meteredBody(total: number, chunk = CHUNK) {
  const meter = { served: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (meter.served >= total) {
          controller.close();
          return;
        }
        const size = Math.min(chunk, total - meter.served);
        meter.served += size;
        controller.enqueue(new Uint8Array(size).fill(0x20));
      },
      cancel() {
        meter.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, meter };
}
/** The given bytes, `size` bytes per chunk, so multibyte characters can straddle chunk boundaries. */
function chunkedBody(bytes: Uint8Array, size: number) {
  const meter = { served: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (meter.served >= bytes.byteLength) {
          controller.close();
          return;
        }
        const chunk = bytes.slice(meter.served, meter.served + size);
        meter.served += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel() {
        meter.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, meter };
}
const encode = (text: string) => new TextEncoder().encode(text);

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

  it('reloadStops replaces the shared stop list with one fresh read, and a failed read leaves no stale copy (review R2-2)', async () => {
    const page = (version: number) => new Response(JSON.stringify({ feed: { ...feed, feed_version_id: version }, items: [] }));
    fetchMock.mockResolvedValueOnce(page(1)).mockResolvedValueOnce(page(2)).mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValueOnce(page(3));
    const version = async (read: Promise<Awaited<ReturnType<typeof listStops>>>) => {
      const result = await read;
      return result.ok ? result.data.feed.feed_version_id : result.reason;
    };
    expect(await version(listStops(env))).toBe(1);
    expect(await version(listStops(env))).toBe(1);
    expect(await version(reloadStops(env))).toBe(2);
    expect(await version(listStops(env))).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await version(reloadStops(env))).toBe('unavailable');
    expect(await version(listStops(env))).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('never caches a personalized lookup', async () => {
    await nearestStops(env, { lat: 32.78, lng: -79.93 });
    await nearestStops(env, { lat: 32.78, lng: -79.93 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('data-agent client: byte-bounded body (review F5)', () => {
  const malformed = { ok: false, reason: 'malformed', status: 200 };

  it('cancels an 8 MiB streamed body just past the cap instead of buffering it', async () => {
    const { stream, meter } = meteredBody(REVIEW_BODY_BYTES);
    fetchMock.mockResolvedValue(new Response(stream, { status: 200 }));
    expect(await nearestStops(env, point)).toEqual(malformed);
    expect(meter.cancelled).toBe(true);
    // Read up to the first chunk past the cap, then stopped: never the whole body.
    expect(meter.served).toBe(Math.ceil((MAX_BODY_BYTES + 1) / CHUNK) * CHUNK);
    expect(meter.served).toBeLessThan(REVIEW_BODY_BYTES);
  });

  it('refuses a declared Content-Length over the cap before reading a byte', async () => {
    const { stream, meter } = meteredBody(REVIEW_BODY_BYTES);
    fetchMock.mockResolvedValue(new Response(stream, { status: 200, headers: { 'content-length': String(REVIEW_BODY_BYTES) } }));
    expect(await nearestStops(env, point)).toEqual(malformed);
    expect(meter.served).toBe(0);
    expect(meter.cancelled).toBe(true);
  });

  it.each([
    ['understates the body', '64'],
    ['is not a number', 'lots'],
  ])('a Content-Length that %s is not trusted: the byte count still stops the stream', async (_label, header) => {
    const { stream, meter } = meteredBody(REVIEW_BODY_BYTES);
    fetchMock.mockResolvedValue(new Response(stream, { status: 200, headers: { 'content-length': header } }));
    expect(await nearestStops(env, point)).toEqual(malformed);
    expect(meter.cancelled).toBe(true);
    expect(meter.served).toBeLessThanOrEqual(MAX_BODY_BYTES + CHUNK);
  });

  it('accepts a body of exactly the cap, with or without its Content-Length', async () => {
    const json = JSON.stringify({ feed, items: [] });
    const exact = json + ' '.repeat(MAX_BODY_BYTES - encode(json).byteLength);
    expect(encode(exact).byteLength).toBe(MAX_BODY_BYTES);
    fetchMock.mockImplementation(async () => new Response(exact, { status: 200 }));
    expect(await nearestStops(env, point)).toMatchObject({ ok: true, data: { items: [] } });
    fetchMock.mockImplementation(async () => new Response(exact, { status: 200, headers: { 'content-length': String(MAX_BODY_BYTES) } }));
    expect(await nearestStops(env, point)).toMatchObject({ ok: true });
    fetchMock.mockImplementation(async () => new Response(`${exact} `, { status: 200 }));
    expect(await nearestStops(env, point)).toEqual(malformed);
  });

  it('counts bytes, not characters: multibyte text under the cap in characters is still over it in bytes', async () => {
    // 700,000 three-byte characters: 2.1 MB on the wire, though the string is well under 2,000,000 characters long.
    const text = JSON.stringify({ feed, items: [], note: '€'.repeat(700_000) });
    expect(text.length).toBeLessThan(MAX_BODY_BYTES);
    const bytes = encode(text);
    expect(bytes.byteLength).toBeGreaterThan(MAX_BODY_BYTES);
    const { stream, meter } = chunkedBody(bytes, CHUNK);
    fetchMock.mockResolvedValue(new Response(stream, { status: 200 }));
    expect(await nearestStops(env, point)).toEqual(malformed);
    expect(meter.cancelled).toBe(true);
    expect(meter.served).toBeLessThan(bytes.byteLength);
  });

  it('decodes a multibyte character split across chunks intact', async () => {
    const name = 'Café ☕ 🚌 Ñandú';
    const bytes = encode(JSON.stringify({
      feed,
      items: [{ id: 'S1', code: null, name, lat: 32.78, lng: -79.93, route_short_names: ['10'], distance_m: 12.5 }],
    }));
    for (const size of [1, 2, 3, 5]) {
      fetchMock.mockResolvedValueOnce(new Response(chunkedBody(bytes, size).stream, { status: 200 }));
      const result = await nearestStops(env, point);
      expect(result).toMatchObject({ ok: true });
      expect(result.ok && result.data.items[0].name).toBe(name);
    }
  });

  it('treats bytes that are not UTF-8 as malformed, not as replacement text', async () => {
    const head = encode(`{"feed":${JSON.stringify(feed)},"items":[],"note":"`);
    const bytes = new Uint8Array([...head, 0xff, 0xfe, ...encode('"}')]);
    fetchMock.mockResolvedValue(new Response(bytes, { status: 200 }));
    expect(await nearestStops(env, point)).toEqual(malformed);
  });

  it('a body stream that fails mid-read is unreachable, never partial data', async () => {
    let pulls = 0;
    const failing = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          if (pulls === 1) controller.enqueue(encode('{"feed":'));
          else controller.error(new TypeError('terminated'));
        },
      },
      { highWaterMark: 0 },
    );
    fetchMock.mockResolvedValue(new Response(failing, { status: 200 }));
    expect(await nearestStops(env, point)).toEqual({ ok: false, reason: 'unreachable' });
  });

  it('the 3 s deadline also covers the body: a stall mid-body is a timeout', async () => {
    const deadline = new AbortController();
    const timeout = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      // Like fetch: once the request's signal aborts, the body stream errors with the signal's reason.
      const stalled = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            return new Promise<void>((resolve) => {
              signal.addEventListener('abort', () => {
                controller.error(signal.reason);
                resolve();
              });
            });
          },
        },
        { highWaterMark: 0 },
      );
      return new Response(stalled, { status: 200 });
    });
    const pending = nearestStops(env, point);
    await new Promise((resolve) => setImmediate(resolve));
    deadline.abort(new DOMException('The operation timed out.', 'TimeoutError'));
    expect(await pending).toEqual({ ok: false, reason: 'timeout' });
    expect(timeout).toHaveBeenCalledWith(DATA_AGENT_TIMEOUT_MS);
  });

  it.each([503, 404, 502])('releases the body of a %s without reading it', async (status) => {
    const { stream, meter } = meteredBody(REVIEW_BODY_BYTES);
    fetchMock.mockResolvedValue(new Response(stream, { status }));
    expect(await nearestStops(env, point)).toMatchObject({ ok: false, status });
    expect(meter.served).toBe(0);
    expect(meter.cancelled).toBe(true);
  });
});
