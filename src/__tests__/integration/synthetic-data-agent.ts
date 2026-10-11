import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import type { components } from '@/lib/api/data-agent.types';

/**
 * A strict, SYNTHETIC stand-in for the data agent's read API (contracts/data-agent.openapi.json), for the HTTP
 * integration checks only (`npm run test:integration`). Every id, name and attribution says it is synthetic: none of
 * it is CARTA data, a loaded GTFS feed, or a human fact approval, and it is never a fallback for the app. It listens on
 * 127.0.0.1 only, answers GET requests on the contract's paths with the contract's parameters, and records anything
 * else as a violation (answered 404/405/422) so a test can fail on it.
 *
 * Bodies are typed with the generated OpenAPI types, so `npm run typecheck` rejects a fixture that drifts from the
 * contract; `synthetic-data-agent.test.ts` also checks them against the OpenAPI JSON and the app's runtime guards.
 */

type Schemas = components['schemas'];

export const PROVENANCE = 'SYNTHETIC integration fixture: not CARTA data, not a human approval';
export const TIMEZONE = 'America/New_York';
export const ROUTE_ID = 'SYN-IT-ROUTE-1';
export const ROUTE_SHORT_NAME = 'SYN1';
export const IN_VEHICLE_MIN = 23;
export const ACCESS_BUFFER_MIN = 7;
/** Minutes before the arrival target that the best trip departs; the alternatives leave 15, 30 and 45 min earlier. */
export const BEST_DEPARTS_BEFORE_TARGET_MIN = 30;

export const FEED: Schemas['FeedOut'] = {
  source_id: 'synthetic-it-gtfs',
  feed_version_id: 990001,
  feed_label: 'SYNTHETIC-IT-1',
  feed_start: '2000-01-01',
  feed_end: '2099-12-31',
  timezone: TIMEZONE,
  loaded_at: '2026-10-01T12:00:00+00:00',
  attribution: PROVENANCE,
};

const stop = (id: string, name: string, lat: number, lng: number): Schemas['StopOut'] => ({
  id,
  code: null,
  name: `Synthetic ${name} (integration test, not a CARTA stop)`,
  lat,
  lng,
  route_short_names: [ROUTE_SHORT_NAME],
});

/**
 * The origin and one destination per behavior the schedule lookup must handle. Neighbors are about 1.1 km apart, far
 * beyond the app's 400 m mapping bound, so a nearest-stop lookup is never ambiguous.
 */
export const STOPS = {
  origin: stop('SYN-IT-A', 'origin stop A', 32.78, -79.93),
  scheduled: stop('SYN-IT-B', 'stop B (scheduled trip)', 32.79, -79.93),
  noBoardableTrip: stop('SYN-IT-C', 'stop C (no boardable trip)', 32.8, -79.93),
  malformed: stop('SYN-IT-D', 'stop D (malformed schedule)', 32.81, -79.93),
  timeout: stop('SYN-IT-E', 'stop E (schedule never answers)', 32.82, -79.93),
  unavailable: stop('SYN-IT-F', 'stop F (schedule 503)', 32.83, -79.93),
  feedChanged: stop('SYN-IT-G', 'stop G (schedule from another feed)', 32.84, -79.93),
  noTripNoReason: stop('SYN-IT-H', 'stop H (no trip and no reason)', 32.85, -79.93),
} as const;

const ALL_STOPS: Schemas['StopOut'][] = Object.values(STOPS);

const FACT_SOURCE: Schemas['FactSource'] = { source_id: 'synthetic-it-facts', attribution: PROVENANCE, retrieved: '2026-10-01' };

/** Synthetic values, chosen to differ from the approved 05 §2 table so a page shows which source it used. */
export const FACT_VALUES = {
  'cost.basis': 'marginal (SYNTHETIC)',
  'drive.fuel_price_usd_per_gal': 4.321,
  'drive.mpg': 23.4,
  'drive.maintenance_usd_per_mile': 0.1234,
  'drive.total_cost_usd_per_mile': 0.88,
  'parking.downtown_usd': 13.57,
  'transit.base_fare_usd': 9.87,
  'transit.access_buffer_min': ACCESS_BUFFER_MIN,
  'co2.car_g_per_mile': 432,
  'co2.car_occupancy': 1.2,
  'co2.bus_g_per_passenger_mile': 210,
} as const;

export const FACTS: Schemas['FactOut'][] = Object.entries(FACT_VALUES).map(([key, value], index) => ({
  id: 990100 + index,
  key,
  version: 1,
  supersedes_id: null,
  value_num: typeof value === 'number' ? value : null,
  value_text: typeof value === 'string' ? value : null,
  unit: 'synthetic unit',
  geography: 'synthetic',
  period: { start: null, end: null },
  method: PROVENANCE,
  // The access buffer is a decision (no source), as in P4a: its citation names only the fact.
  sources: key === 'transit.access_buffer_min' ? [] : [FACT_SOURCE],
  derived_from: {},
  evidence: { provenance: PROVENANCE },
  status: 'approved',
  confidence: null,
  valid_until: null,
}));

const BUFFER_FACT = FACTS.find((fact) => fact.key === 'transit.access_buffer_min') as Schemas['FactOut'];

export const ASSUMPTIONS: Schemas['AssumptionsOut'] = {
  items: FACTS.map((fact) => ({ key: fact.key, fact })),
  missing: [],
};

export const CITED_STAT: Schemas['StatOut'] = {
  id: 'synthetic.it.ridership',
  label: 'SYNTHETIC integration stat (not CARTA ridership)',
  value_num: 4242,
  value_text: null,
  unit: 'trips',
  period: { start: '2026-09-01', end: '2026-09-30' },
  citations: [{ ...FACT_SOURCE, fact_id: 990201, fact_key: 'synthetic.it.ridership' }],
};

/** A stat with no citation: the app must drop it rather than show an uncited number. */
export const UNCITED_STAT: Schemas['StatOut'] = {
  id: 'synthetic.it.uncited',
  label: 'SYNTHETIC uncited stat (must never render)',
  value_num: 1313,
  value_text: null,
  unit: 'trips',
  period: { start: null, end: null },
  citations: [],
};

export const STATS: Schemas['StatsOut'] = { items: [CITED_STAT, UNCITED_STAT] };

export const ALERT_CITATION: Schemas['Citation'] = {
  source_id: 'synthetic-it-alerts',
  attribution: PROVENANCE,
  retrieved: null,
  fact_id: null,
  fact_key: null,
};

/** One alert on the synthetic route, with markup, a slot-like brace and an unsafe link the app must strip. */
export const ALERTS: Schemas['AlertPage'] = {
  items: [
    {
      alert_id: 'SYN-IT-ALERT-1',
      source_id: 'synthetic-it-alerts',
      cause: null,
      effect: null,
      severity_level: null,
      header_text: 'SYNTHETIC test notice: not a real CARTA alert',
      description_text: 'Synthetic <b>detour</b> text {slot}',
      url: 'javascript:alert(1)',
      active_from: null,
      active_until: null,
      route_ids: [ROUTE_ID],
      stop_ids: [STOPS.origin.id],
    },
  ],
  citations: [ALERT_CITATION],
};

/**
 * The compare citations P4a sends: the feed's source, then the access-buffer fact (a decision, so no source). P4a
 * serializes every field of its models, so the optional ones are present as null, as here.
 */
export const COMPARE_CITATIONS: Schemas['Citation'][] = [
  { source_id: FEED.source_id, attribution: FEED.attribution, retrieved: null, fact_id: null, fact_key: null },
  { source_id: null, attribution: null, retrieved: null, fact_id: BUFFER_FACT.id, fact_key: BUFFER_FACT.key },
];

const MINUTE_MS = 60_000;

function offsetMs(instant: number, timeZone: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(instant)
    .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!match) return 0;
  return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) * MINUTE_MS;
}

/** An instant as P4a prints it: local wall time in the feed's zone, with its UTC offset. */
export function localIso(instant: number, timeZone = TIMEZONE): string {
  const offset = offsetMs(instant, timeZone);
  const wall = new Date(instant + offset).toISOString().slice(0, 19);
  const sign = offset < 0 ? '-' : '+';
  const minutes = Math.abs(offset) / MINUTE_MS;
  return `${wall}${sign}${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** The instant of a local date and HH:MM in the feed's zone (a wall time inside a DST gap shifts by the gap). */
export function localInstant(date: string, hhmm: string, timeZone = TIMEZONE): number {
  const wall = Date.parse(`${date}T${hhmm}:00Z`);
  let instant = wall;
  for (let i = 0; i < 2; i += 1) instant = wall - offsetMs(instant, timeZone);
  return instant;
}

function trip(index: number, departure: number): Schemas['TripOut'] {
  return {
    basis: 'scheduled',
    trip_id: `SYN-IT-TRIP-${index}`,
    route_id: ROUTE_ID,
    route_short_name: ROUTE_SHORT_NAME,
    route_long_name: 'Synthetic integration route (not CARTA)',
    headsign: 'Synthetic headsign',
    direction_id: 0,
    service_date: localIso(departure).slice(0, 10),
    departure: localIso(departure),
    arrival: localIso(departure + IN_VEHICLE_MIN * MINUTE_MS),
    in_vehicle_min: IN_VEHICLE_MIN,
    leave_by: localIso(departure - ACCESS_BUFFER_MIN * MINUTE_MS),
    wait_min: null,
    interpolated: false,
  };
}

export type CompareVariant = 'scheduled' | 'no_boardable_trip' | 'no_trip_no_reason' | 'other_feed';

/**
 * An arrive-by answer shaped like P4a's: the best direct trip departs `BEST_DEPARTS_BEFORE_TARGET_MIN` before the
 * target and three earlier alternatives follow, all arriving before the target. `variant` shapes the other answers.
 */
export function compareBody(date: string, arriveBy: string, variant: CompareVariant = 'scheduled'): Schemas['CompareOut'] {
  const target = localInstant(date, arriveBy);
  const best = target - BEST_DEPARTS_BEFORE_TARGET_MIN * MINUTE_MS;
  const trips = [0, 1, 2, 3].map((index) => trip(index, best - index * 15 * MINUTE_MS));
  const noTrip = variant === 'no_boardable_trip' || variant === 'no_trip_no_reason';
  return {
    transit: noTrip ? null : trips[0],
    // A no-trip answer carrying alternatives is contract-valid, but they must never surface as rides (no phantom trips).
    alternatives: trips.slice(1),
    reason: variant === 'no_boardable_trip' ? 'no_boardable_trip' : null,
    routing: 'direct_only',
    mode: 'arrive_by',
    target: localIso(target),
    access_buffer_min: ACCESS_BUFFER_MIN,
    feed: variant === 'other_feed' ? { ...FEED, feed_version_id: FEED.feed_version_id + 1 } : FEED,
    citations: COMPARE_CITATIONS,
  };
}

export function stopPage(query: string | null, limit: number): Schemas['StopPage'] {
  const needle = query?.trim().toLowerCase() ?? '';
  const items = ALL_STOPS.filter((item) => !needle || item.id.toLowerCase() === needle || (item.name ?? '').toLowerCase().includes(needle));
  return { feed: FEED, items: items.slice(0, limit) };
}

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return Math.round(6_371_008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h))) * 10) / 10;
}

export function nearestPage(lat: number, lng: number, limit: number): Schemas['NearbyStopPage'] {
  const items = ALL_STOPS.map((item) => ({ ...item, distance_m: haversineM({ lat, lng }, item) }))
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, limit);
  return { feed: FEED, items };
}

/** A body the app's guards must reject: the right paths, the wrong shape. */
export const MALFORMED_BODY = { items: 'SYNTHETIC-NOT-AN-ARRAY', feed: null } as const;

/** The healthy-mode compare answer for one destination stop (the origin is always `STOPS.origin`). */
export function compareReply(destStopId: string, date: string, arriveBy: string): { status: number; body: unknown } | 'hold' | null {
  switch (destStopId) {
    case STOPS.scheduled.id:
      return { status: 200, body: compareBody(date, arriveBy, 'scheduled') };
    case STOPS.noBoardableTrip.id:
      return { status: 200, body: compareBody(date, arriveBy, 'no_boardable_trip') };
    case STOPS.noTripNoReason.id:
      return { status: 200, body: compareBody(date, arriveBy, 'no_trip_no_reason') };
    case STOPS.feedChanged.id:
      return { status: 200, body: compareBody(date, arriveBy, 'other_feed') };
    case STOPS.malformed.id: {
      const valid = compareBody(date, arriveBy);
      return { status: 200, body: { ...valid, transit: { ...valid.transit, in_vehicle_min: 'SYNTHETIC-NaN' } } };
    }
    case STOPS.timeout.id:
      return 'hold';
    case STOPS.unavailable.id:
      return { status: 503, body: { detail: 'SYNTHETIC: no active GTFS feed' } };
    default:
      return null;
  }
}

/**
 * - `healthy`: contract-valid answers; the schedule's behavior depends on the destination stop (see `STOPS`).
 * - `unavailable`: every path answers 503 with a FastAPI `detail` envelope (the source is absent).
 * - `malformed`: every path answers 200 with a body that breaks the contract.
 * - `timeout`: every path holds the request open and never answers (the app's deadline must fire).
 * - `reset`: every connection is closed on accept (the agent is unreachable).
 */
export type AgentMode = 'healthy' | 'unavailable' | 'malformed' | 'timeout' | 'reset';

export interface AgentRequest {
  method: string;
  path: string;
  query: Record<string, string>;
}

export interface SyntheticDataAgent {
  url: string;
  /** Every request received, in order (none are recorded in `reset` mode: the connection never gets that far). */
  requests: AgentRequest[];
  /** Requests outside the contract or the fixture's bounds; a passing run has none. */
  violations: string[];
  calls(path: string, match?: Record<string, string>): AgentRequest[];
  close(): Promise<void>;
}

const PARAMS: Record<string, { allowed: string[]; required: string[] }> = {
  '/v1/stops': { allowed: ['query', 'limit', 'source_id'], required: [] },
  '/v1/stops/nearest': { allowed: ['lat', 'lng', 'limit', 'source_id'], required: ['lat', 'lng'] },
  '/v1/compare': {
    allowed: ['origin_stop_id', 'dest_stop_id', 'date', 'arrive_by', 'depart_at', 'source_id'],
    required: ['origin_stop_id', 'dest_stop_id', 'date'],
  },
  '/v1/assumptions': { allowed: [], required: [] },
  '/v1/stats': { allowed: [], required: [] },
  '/v1/alerts': { allowed: ['route_id'], required: [] },
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// A held request is destroyed after this long (well past the app's 3 s deadline), so nothing outlives a run.
const HOLD_LIMIT_MS = 15_000;

type Reply = { status: number; body: unknown } | 'hold';

function healthyReply(path: string, query: Record<string, string>, violation: (message: string) => Reply): Reply {
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 2000) return violation(`${path}: limit out of range`);
  switch (path) {
    case '/v1/stops':
      return { status: 200, body: stopPage(query.query ?? null, limit) };
    case '/v1/stops/nearest': {
      const lat = Number(query.lat);
      const lng = Number(query.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return violation('/v1/stops/nearest: invalid lat/lng');
      }
      return { status: 200, body: nearestPage(lat, lng, limit) };
    }
    case '/v1/assumptions':
      return { status: 200, body: ASSUMPTIONS };
    case '/v1/stats':
      return { status: 200, body: STATS };
    case '/v1/alerts':
      return { status: 200, body: query.route_id === ROUTE_ID ? ALERTS : { items: [], citations: [] } };
    case '/v1/compare': {
      // The web app asks arrive-by questions only, for a real date and HH:MM.
      if (query.depart_at !== undefined || !query.arrive_by || !HHMM.test(query.arrive_by) || !DATE.test(query.date)) {
        return violation('/v1/compare: expected date=YYYY-MM-DD and arrive_by=HH:MM only');
      }
      if (query.origin_stop_id !== STOPS.origin.id) return violation('/v1/compare: unexpected origin stop');
      return compareReply(query.dest_stop_id, query.date, query.arrive_by) ?? violation('/v1/compare: unexpected destination stop');
    }
    default:
      return violation(`unknown path ${path}`);
  }
}

/** Starts the synthetic agent on 127.0.0.1 with an OS-assigned port; rejects (failing the suite) if it can't bind. */
export function startSyntheticDataAgent(mode: AgentMode): Promise<SyntheticDataAgent> {
  const requests: AgentRequest[] = [];
  const violations: string[] = [];
  const sockets = new Set<Socket>();
  const held = new Set<http.ServerResponse>();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const query = Object.fromEntries(url.searchParams);
    requests.push({ method: req.method ?? '', path: url.pathname, query });
    const violation = (message: string): Reply => {
      violations.push(message);
      return { status: 422, body: { detail: `SYNTHETIC fixture rejected the request: ${message}` } };
    };

    let reply: Reply;
    const spec = PARAMS[url.pathname];
    if (req.method !== 'GET') {
      violations.push(`${req.method} ${url.pathname}: the read API is GET-only`);
      reply = { status: 405, body: { detail: 'Method Not Allowed' } };
    } else if (!spec) {
      violations.push(`unknown path ${url.pathname}`);
      reply = { status: 404, body: { detail: 'Not Found' } };
    } else {
      const unexpected = Object.keys(query).filter((name) => !spec.allowed.includes(name));
      const missing = spec.required.filter((name) => !query[name]);
      if (unexpected.length || missing.length) {
        reply = violation(`${url.pathname}: unexpected [${unexpected.join(',')}], missing [${missing.join(',')}]`);
      } else if (mode === 'unavailable') {
        reply = { status: 503, body: { detail: 'SYNTHETIC: source unavailable' } };
      } else if (mode === 'malformed') {
        reply = { status: 200, body: MALFORMED_BODY };
      } else if (mode === 'timeout') {
        reply = 'hold';
      } else {
        reply = healthyReply(url.pathname, query, violation);
      }
    }

    if (reply === 'hold') {
      held.add(res);
      const limit = setTimeout(() => res.destroy(), HOLD_LIMIT_MS);
      res.on('close', () => {
        clearTimeout(limit);
        held.delete(res);
      });
      return;
    }
    res.writeHead(reply.status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-fixture-provenance': PROVENANCE });
    res.end(JSON.stringify(reply.body));
  });

  server.on('connection', (socket) => {
    if (mode === 'reset') {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        violations,
        calls: (path, match = {}) =>
          requests.filter((request) => request.path === path && Object.entries(match).every(([name, value]) => request.query[name] === value)),
        close: () =>
          new Promise<void>((done) => {
            held.forEach((res) => res.destroy());
            sockets.forEach((socket) => socket.destroy());
            server.close(() => done());
          }),
      });
    });
  });
}
