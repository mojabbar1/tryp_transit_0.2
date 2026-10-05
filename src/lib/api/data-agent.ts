import 'server-only';
import { z } from 'zod';
import type { ServerEnv } from '@/lib/env';
import { log } from '@/lib/log';
import type { components } from './data-agent.types';

/**
 * Server-only client for the data agent's read API (P4b; contract: contracts/data-agent.openapi.json).
 *
 * - Off unless `env.dataAgentEnabled` (DATA_AGENT_ENABLED=true plus a base URL); every call then reports
 *   `disabled` and the caller degrades honestly.
 * - Every request has a 3 s deadline and is never cached by fetch (`no-store`), so a personalized query (a stop
 *   pair, a rider's coordinates) never lands in a shared cache and a next-bus answer is never stale.
 * - Every response is checked at runtime; anything that doesn't match the contract is `malformed`, not data. A body
 *   over `MAX_BODY_BYTES` is `malformed` too, and its stream is cancelled as soon as it passes the cap.
 * - Logs carry the endpoint template, a reason code and the HTTP status only: never a query string, a coordinate,
 *   a stop id, or the base URL.
 */

export const DATA_AGENT_TIMEOUT_MS = 3000;
// The largest legitimate body is the full stop list (≤ 2,000 stops); anything far bigger is not trusted. Counted in
// bytes as they arrive, so an oversized body is cancelled rather than buffered.
export const MAX_BODY_BYTES = 2_000_000;

type Schemas = components['schemas'];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoDateTime = z.string().datetime({ offset: true });
const finite = z.number().finite();

const CitationSchema = z.object({
  source_id: z.string().nullable(),
  attribution: z.string().nullable(),
  fact_id: z.number().int().nullable().optional(),
  fact_key: z.string().nullable().optional(),
  retrieved: isoDate.nullable().optional(),
});

const FeedSchema = z.object({
  source_id: z.string(),
  feed_version_id: z.number().int(),
  feed_label: z.string().nullable(),
  feed_start: isoDate,
  feed_end: isoDate,
  timezone: z.string(),
  loaded_at: isoDateTime,
  attribution: z.string().nullable(),
});

const StopSchema = z.object({
  id: z.string().min(1).max(100),
  code: z.string().nullable(),
  name: z.string().nullable(),
  lat: finite.min(-90).max(90),
  lng: finite.min(-180).max(180),
  route_short_names: z.array(z.string()),
});

const StopPageSchema = z.object({ feed: FeedSchema, items: z.array(StopSchema) });
const NearbyStopPageSchema = z.object({
  feed: FeedSchema,
  items: z.array(StopSchema.extend({ distance_m: finite.nonnegative() })),
});

const TripSchema = z.object({
  basis: z.literal('scheduled'),
  trip_id: z.string(),
  route_id: z.string(),
  route_short_name: z.string().nullable(),
  route_long_name: z.string().nullable(),
  headsign: z.string().nullable(),
  direction_id: z.number().int().nullable(),
  service_date: isoDate,
  departure: isoDateTime,
  arrival: isoDateTime,
  in_vehicle_min: finite.nonnegative(),
  leave_by: isoDateTime.nullable(),
  wait_min: finite.nullable(),
  interpolated: z.boolean(),
});

const CompareSchema = z.object({
  transit: TripSchema.nullable(),
  alternatives: z.array(TripSchema),
  reason: z.enum(['no_boardable_trip', 'transfer_required', 'no_service', 'unknown_stop']).nullable(),
  routing: z.literal('direct_only'),
  mode: z.enum(['arrive_by', 'depart_at']),
  target: isoDateTime,
  access_buffer_min: finite,
  feed: FeedSchema,
  citations: z.array(CitationSchema),
});

const FactSchema = z.object({
  id: z.number().int(),
  key: z.string(),
  version: z.number().int(),
  supersedes_id: z.number().int().nullable(),
  value_num: finite.nullable(),
  value_text: z.string().nullable(),
  unit: z.string().nullable(),
  geography: z.string().nullable(),
  period: z.object({ start: isoDate.nullable(), end: isoDate.nullable() }),
  method: z.string().nullable(),
  sources: z.array(z.object({ source_id: z.string(), attribution: z.string().nullable(), retrieved: isoDate.nullable() })),
  derived_from: z.record(z.unknown()),
  evidence: z.record(z.unknown()),
  // The API serves approved facts only; anything else is rejected rather than shown.
  status: z.literal('approved'),
  confidence: z.string().nullable(),
  valid_until: isoDate.nullable(),
});

const AssumptionsSchema = z.object({
  items: z.array(z.object({ key: z.string(), fact: FactSchema })),
  missing: z.array(z.string()),
});

const StatsSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      value_num: finite.nullable(),
      value_text: z.string().nullable(),
      unit: z.string().nullable(),
      period: z.object({ start: isoDate.nullable(), end: isoDate.nullable() }),
      citations: z.array(CitationSchema),
    }),
  ),
});

const AlertPageSchema = z.object({
  items: z.array(
    z.object({
      alert_id: z.string(),
      source_id: z.string(),
      cause: z.string().nullable(),
      effect: z.string().nullable(),
      severity_level: z.string().nullable(),
      header_text: z.string().nullable(),
      description_text: z.string().nullable(),
      url: z.string().nullable(),
      active_from: isoDateTime.nullable(),
      active_until: isoDateTime.nullable(),
      route_ids: z.array(z.string()),
      stop_ids: z.array(z.string()),
    }),
  ),
  citations: z.array(CitationSchema),
});

export type AgentFeed = z.infer<typeof FeedSchema>;
export type AgentCitation = z.infer<typeof CitationSchema>;
export type AgentStopPage = z.infer<typeof StopPageSchema>;
export type AgentNearbyStopPage = z.infer<typeof NearbyStopPageSchema>;
export type AgentTrip = z.infer<typeof TripSchema>;
export type AgentCompare = z.infer<typeof CompareSchema>;
export type AgentFact = z.infer<typeof FactSchema>;
export type AgentAssumptions = z.infer<typeof AssumptionsSchema>;
export type AgentStats = z.infer<typeof StatsSchema>;
export type AgentAlertPage = z.infer<typeof AlertPageSchema>;

// Compile-time contract check: each runtime guard must accept only values the generated OpenAPI types allow.
// Regenerating data-agent.types.ts after a contract change breaks the build here if the guards drift.
type Conforms<Guard, Contract> = Guard extends Contract ? true : never;
const contractConformance: [
  Conforms<AgentStopPage, Schemas['StopPage']>,
  Conforms<AgentNearbyStopPage, Schemas['NearbyStopPage']>,
  Conforms<AgentCompare, Schemas['CompareOut']>,
  Conforms<AgentAssumptions, Schemas['AssumptionsOut']>,
  Conforms<AgentStats, Schemas['StatsOut']>,
  Conforms<AgentAlertPage, Schemas['AlertPage']>,
] = [true, true, true, true, true, true];
void contractConformance;

export type DataAgentFailure = 'disabled' | 'timeout' | 'unreachable' | 'unavailable' | 'rejected' | 'http_error' | 'malformed';
export type DataAgentResult<T> = { ok: true; data: T } | { ok: false; reason: DataAgentFailure; status?: number };

type Query = Record<string, string | number | undefined>;
type AgentEnv = Pick<ServerEnv, 'dataAgentEnabled' | 'dataAgentBaseUrl'>;

function endpointUrl(base: string, path: string, query: Query): URL {
  const url = new URL(path.replace(/^\//, ''), base.endsWith('/') ? base : `${base}/`);
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(name, String(value));
  }
  return url;
}

/** Releases a body that won't be read (the cancel settles on its own; a failure to cancel changes nothing). */
function discardBody(stream: ReadableStream<Uint8Array> | ReadableStreamDefaultReader<Uint8Array> | null) {
  void stream?.cancel().catch(() => undefined);
}

/**
 * The body's bytes, or null when it is larger than `maxBytes`. A declared Content-Length over the limit is refused
 * before any read; otherwise bytes are counted as they arrive (the header may be absent or wrong, and fetch may have
 * decompressed the body), and the stream is cancelled the moment the count passes the limit. A read error or the
 * request's deadline rejects, like fetch itself.
 */
async function readBodyCapped(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = response.headers.get('content-length')?.trim();
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    discardBody(response.body);
    return null;
  }
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      discardBody(reader);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function getJson<T>(env: AgentEnv, path: string, query: Query, schema: z.ZodType<T>): Promise<DataAgentResult<T>> {
  const fail = (reason: DataAgentFailure, status?: number): DataAgentResult<T> => {
    if (reason !== 'disabled') log.warn('data_agent_request_failed', { endpoint: path, reason, status });
    return status === undefined ? { ok: false, reason } : { ok: false, reason, status };
  };
  if (!env.dataAgentEnabled || !env.dataAgentBaseUrl) return fail('disabled');

  let response: Response;
  let bytes: Uint8Array | null;
  try {
    response = await fetch(endpointUrl(env.dataAgentBaseUrl, path, query), {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      redirect: 'error',
      // One deadline for the headers and the body: fetch errors a body still streaming when it fires.
      signal: AbortSignal.timeout(DATA_AGENT_TIMEOUT_MS),
    });
    if (!response.ok) discardBody(response.body);
    if (response.status === 503) return fail('unavailable', 503);
    if (response.status === 404 || response.status === 422) return fail('rejected', response.status);
    if (!response.ok) return fail('http_error', response.status);
    bytes = await readBodyCapped(response, MAX_BODY_BYTES);
  } catch (error) {
    // AbortSignal.timeout rejects with a DOMException, which isn't always `instanceof Error` across realms.
    const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
    return fail(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'unreachable');
  }
  if (bytes === null) return fail('malformed', response.status);
  let json: unknown;
  try {
    // JSON is UTF-8 (RFC 8259): bytes that aren't valid UTF-8 are malformed, never replacement characters.
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return fail('malformed', response.status);
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? { ok: true, data: parsed.data } : fail('malformed', response.status);
}

/** A tiny TTL cache for **non-personalized** responses only (the full stop list, assumptions, stats). */
class TtlCache<T> {
  private entry: { at: number; value: T } | null = null;
  constructor(private readonly ttlMs: number) {}
  get(now: number): T | null {
    return this.entry && now - this.entry.at < this.ttlMs ? this.entry.value : null;
  }
  set(now: number, value: T) {
    this.entry = { at: now, value };
  }
  clear() {
    this.entry = null;
  }
}

const HOUR_MS = 3_600_000;
export const STOP_LIST_TTL_MS = 24 * HOUR_MS;
export const ASSUMPTIONS_TTL_MS = HOUR_MS;
export const STATS_TTL_MS = HOUR_MS;
export const STOP_LIST_LIMIT = 2000;

const caches = {
  stops: new TtlCache<AgentStopPage>(STOP_LIST_TTL_MS),
  assumptions: new TtlCache<AgentAssumptions>(ASSUMPTIONS_TTL_MS),
  stats: new TtlCache<AgentStats>(STATS_TTL_MS),
};

/** Test hook: forget the shared caches. */
export function clearDataAgentCaches() {
  Object.values(caches).forEach((cache) => cache.clear());
}

async function cached<T>(cache: TtlCache<T>, load: () => Promise<DataAgentResult<T>>): Promise<DataAgentResult<T>> {
  const hit = cache.get(Date.now());
  if (hit) return { ok: true, data: hit };
  const result = await load();
  // Failures are never cached, so the app recovers as soon as the agent does.
  if (result.ok) cache.set(Date.now(), result.data);
  return result;
}

/** Every stop in the active feed (the picker's list), shared for a day. Holds no rider data. */
export function listStops(env: AgentEnv): Promise<DataAgentResult<AgentStopPage>> {
  if (!env.dataAgentEnabled) return getJson(env, '/v1/stops', {}, StopPageSchema);
  return cached(caches.stops, () => getJson(env, '/v1/stops', { limit: STOP_LIST_LIMIT }, StopPageSchema));
}

/** A name or id search; not cached (the text is a rider's input). */
export function searchStops(env: AgentEnv, query: string, limit: number): Promise<DataAgentResult<AgentStopPage>> {
  return getJson(env, '/v1/stops', { query, limit }, StopPageSchema);
}

/** The stops nearest a rider's point; personalized, so never cached. */
export function nearestStops(env: AgentEnv, point: { lat: number; lng: number }, limit = 1) {
  return getJson(env, '/v1/stops/nearest', { lat: point.lat, lng: point.lng, limit }, NearbyStopPageSchema);
}

/** The scheduled direct-trip lookup (D-6); personalized and time-sensitive, so never cached. */
export function compareTrip(
  env: AgentEnv,
  input: { originStopId: string; destStopId: string; date: string; arriveBy: string },
): Promise<DataAgentResult<AgentCompare>> {
  return getJson(
    env,
    '/v1/compare',
    { origin_stop_id: input.originStopId, dest_stop_id: input.destStopId, date: input.date, arrive_by: input.arriveBy },
    CompareSchema,
  );
}

/** The approved cost and CO2 facts, shared for an hour (the same for every rider). */
export function getAssumptions(env: AgentEnv): Promise<DataAgentResult<AgentAssumptions>> {
  if (!env.dataAgentEnabled) return getJson(env, '/v1/assumptions', {}, AssumptionsSchema);
  return cached(caches.assumptions, () => getJson(env, '/v1/assumptions', {}, AssumptionsSchema));
}

/** Headline stats from approved facts, shared for an hour. */
export function getStats(env: AgentEnv): Promise<DataAgentResult<AgentStats>> {
  if (!env.dataAgentEnabled) return getJson(env, '/v1/stats', {}, StatsSchema);
  return cached(caches.stats, () => getJson(env, '/v1/stats', {}, StatsSchema));
}

/** Active alerts for one route; never cached, so an ended alert disappears at once. */
export function getAlerts(env: AgentEnv, routeId: string): Promise<DataAgentResult<AgentAlertPage>> {
  return getJson(env, '/v1/alerts', { route_id: routeId }, AlertPageSchema);
}
