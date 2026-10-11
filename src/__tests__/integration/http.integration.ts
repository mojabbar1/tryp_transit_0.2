/**
 * HTTP integration checks: the PRODUCTION Next app (`next build` + `next start`) against a strict SYNTHETIC data
 * agent on 127.0.0.1. Run with `npm run test:integration` (see SETUP.md). Each scenario gets its own server process,
 * so the app's in-memory caches (stop list, assumptions, stats) and its parsed env start empty; nothing is asserted
 * against warm state from another scenario.
 *
 * This is HTTP-level: status codes, response contracts (the app's own zod schemas), invariants, upstream calls and
 * server-rendered page text. It is not a browser/UI test, and it validates nothing about the real data agent, CARTA
 * data, or any fact approval: every upstream answer is synthetic.
 */
import { fallbackFeed, fallbackStops } from '@/app/data/stops.fallback.generated';
import { type TransitInsightResponse, TransitInsightResponseSchema } from '@/lib/contracts/transit-insights';
import { StatsResponseSchema } from '@/lib/stats/types';
import { type StopsResponse, StopsResponseSchema } from '@/lib/stops/types';
import { BLOCK_MARKER, httpRequest, type NextApp, startNextApp, visibleText } from './next-app';
import {
  ALERT_CITATION,
  type AgentMode,
  CITED_STAT,
  compareBody,
  COMPARE_CITATIONS,
  FEED,
  PROVENANCE,
  ROUTE_ID,
  ROUTE_SHORT_NAME,
  startSyntheticDataAgent,
  STOPS,
  type SyntheticDataAgent,
  UNCITED_STAT,
} from './synthetic-data-agent';

const TIMEZONE = 'America/New_York';
type Stop = (typeof STOPS)[keyof typeof STOPS];

/** The figures of the old uncited dashboard: live mode must never render them. */
const OLD_UNCITED_FIGURES = [/2,?847/, /89\.3/];
const FALLBACK_NOTE = 'Some values come from the approved assumptions table because the fact store is unavailable.';

/** An arrival 150 min ahead (so no trip has left) as the HH:MM a rider sends, and its local service date. */
function arrivalTarget(now = Date.now()): { hhmm: string; date: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now + 150 * 60_000);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return { hhmm: `${part('hour')}:${part('minute')}`, date: `${part('year')}-${part('month')}-${part('day')}` };
}

const point = (stop: Stop, latShift = 0) => ({ lat: stop.lat + latShift, lng: stop.lng });

function tripRequest(from: Stop, to: Stop, hhmm: string, ids: { departureStopId?: string; destinationStopId?: string } | 'none' = {}) {
  return {
    departure: point(from),
    destination: point(to),
    timeToDestination: hhmm,
    ...(ids === 'none' ? {} : { departureStopId: from.id, destinationStopId: to.id, ...ids }),
  };
}

async function getJson(app: NextApp, pathname: string) {
  const result = await httpRequest(app.url, pathname);
  expect(result.headers.get('content-type')).toMatch(/^application\/json/);
  return { ...result, body: JSON.parse(result.text) as unknown };
}

async function getPage(app: NextApp, pathname: string) {
  const result = await httpRequest(app.url, pathname);
  expect(result.status).toBe(200);
  expect(result.headers.get('content-type')).toMatch(/^text\/html/);
  return { html: result.text, text: visibleText(result.text) };
}

/** POST /api/transit-insights: 200, never cached, the app's own contract, and the live-mode invariants. */
async function postTrip(app: NextApp, body: unknown): Promise<TransitInsightResponse> {
  const result = await httpRequest(app.url, '/api/transit-insights', { method: 'POST', json: body });
  expect(result.status).toBe(200);
  expect(result.headers.get('cache-control')).toBe('private, no-store');
  const parsed = TransitInsightResponseSchema.safeParse(JSON.parse(result.text));
  if (!parsed.success) throw new Error(`response breaks the contract: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  const trip = parsed.data;
  // No TomTom key and no LLM in these runs, and no live reward or demo data in live mode.
  expect(trip.comparison?.drive).toBeNull();
  expect(trip.trafficDensity).toBeNull();
  expect(trip.costSavingsPerTrip).toBeNull();
  expect(trip.comparison?.costUsd).toBeUndefined();
  expect(trip.incentiveDetails).toBeNull();
  expect(trip.meta?.offerActive).toBe(false);
  expect(trip.meta?.demo).toBe(false);
  expect(trip.meta?.narration).toEqual({ source: 'template', provider: 'template', validated: false });
  return trip;
}

/** A transit leg with no trip: no minutes, departures, rides or trip times (D-21). */
function expectNoTrip(trip: TransitInsightResponse) {
  const transit = trip.comparison?.transit;
  expect(transit?.basis).toBe('unavailable');
  expect(transit?.minutes).toBeNull();
  expect(transit?.nextDepartures).toEqual([]);
  expect(transit?.source).toEqual({ name: 'none (schedule unavailable)' });
  for (const key of ['leaveBy', 'leaveByAt', 'departureAt', 'arrivalAt', 'serviceDate', 'alerts'] as const) {
    expect(transit?.[key]).toBeUndefined();
  }
  expect(trip.travelTime).toBeNull();
  expect(trip.additionalRides).toEqual([]);
}

const degradedOf = (trip: TransitInsightResponse) => [...(trip.meta?.degraded ?? [])].sort();

/** The JSON log lines the server wrote (src/lib/log.ts), parsed; other output is ignored. */
function logLines(app: NextApp): Array<Record<string, unknown>> {
  return app.output().split('\n').flatMap((line) => {
    if (!line.startsWith('{')) return [];
    try {
      return [JSON.parse(line) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}

const upstreamFailures = (app: NextApp) => logLines(app).filter((line) => line.msg === 'data_agent_request_failed');

/** Nothing tried to leave loopback, no response broke its contract, and no log carries a stop id or a coordinate. */
function expectCleanServerOutput(app: NextApp) {
  const output = app.output();
  expect(output).not.toContain(BLOCK_MARKER);
  expect(output).not.toContain('response_contract_mismatch');
  expect(output).not.toMatch(/SYN-IT-[A-Z]\b/);
  expect(output).not.toMatch(/32\.(78|79|8\d)\d*|-79\.93/);
}

async function expectHealthWithoutProviders(app: NextApp) {
  const health = await getJson(app, '/api/health');
  expect(health.status).toBe(200);
  // Proves the run's pinned env won: no LLM or TomTom key leaked in from the shell or a local .env file.
  expect(health.body).toEqual({ status: 'ok', configured: { llm: false, traffic: false } });
}

function expectSavedStops(stops: StopsResponse) {
  // The committed `tda gtfs export-stops` file (the real CARTA feed, P4b pilot): GTFS stops, cited to that feed.
  expect(stops.source).toBe('gtfs_fallback');
  expect(stops.stops).toHaveLength(fallbackStops.length);
  for (const option of stops.stops) {
    expect(option.kind).toBe('gtfs_stop');
    expect(option.key).toBe(`stop:${option.id}`);
  }
  expect(stops.feed).toEqual(fallbackFeed);
  expect(stops.citations).toEqual([{ ref: 'gtfs.stops.fallback', sourceId: fallbackFeed?.sourceId, attribution: fallbackFeed?.attribution }]);
  expect(stops.degraded).toEqual(['data_agent_unavailable']);
}

async function expectStatsUnavailable(app: NextApp) {
  const stats = await getJson(app, '/api/stats');
  expect(stats.status).toBe(200);
  expect(StatsResponseSchema.parse(stats.body)).toEqual({ available: false, items: [], degraded: ['data_agent_unavailable'] });
  expect(stats.headers.get('cache-control')).toBe('public, max-age=60');

  const page = await getPage(app, '/dashboard');
  expect(page.text).toContain('Data unavailable');
  expect(page.text).toContain('No approved, cited headline figures are available right now, so none are shown.');
  expect(page.text).not.toContain(CITED_STAT.label);
  for (const figure of OLD_UNCITED_FIGURES) expect(page.html).not.toMatch(figure);
}

async function expectFactPagesOnFallback(app: NextApp) {
  const cost = await getPage(app, '/safety-cost-comparison');
  expect(cost.text).toContain(FALLBACK_NOTE);
  expect(cost.text).toContain('$2.00'); // the approved 05 §2 fare, flagged as the fallback
  expect(cost.text).not.toContain('$9.87');
  expect(cost.text).not.toContain(PROVENANCE);
  const emissions = await getPage(app, '/emissions-stats');
  expect(emissions.text).toContain(FALLBACK_NOTE);
  expect(emissions.text).not.toContain(PROVENANCE);
}

const LOCAL_FALLBACK_DEGRADED = [
  'assumptions_local_fallback',
  'co2_transit_distance_unavailable',
  'cost_unavailable',
  'data_agent_unavailable',
  'traffic_not_configured',
].sort();

describe('HTTP integration: production app with a SYNTHETIC data agent', () => {
  describe('data agent enabled and healthy', () => {
    let agent: SyntheticDataAgent;
    let app: NextApp;
    const { hhmm, date } = arrivalTarget();
    const expected = compareBody(date, hhmm, 'scheduled');
    const hhmmOf = (iso: string) => iso.slice(11, 16);

    beforeAll(async () => {
      agent = await startSyntheticDataAgent('healthy');
      app = await startNextApp('healthy', { enabled: true, baseUrl: agent.url });
    });
    afterAll(async () => {
      await app?.stop();
      await agent?.close();
    });

    test('health: the pinned env holds (no LLM or traffic provider)', async () => {
      await expectHealthWithoutProviders(app);
    });

    test('/api/stops proxies the synthetic feed with its citation; a search never goes upstream', async () => {
      const list = await getJson(app, '/api/stops');
      expect(list.status).toBe(200);
      const stops = StopsResponseSchema.parse(list.body);
      expect(stops.source).toBe('data_agent');
      expect(stops.stops.map((option) => option.id)).toEqual(Object.values(STOPS).map((stop) => stop.id));
      expect(stops.stops.every((option) => option.kind === 'gtfs_stop' && option.routes.includes(ROUTE_SHORT_NAME))).toBe(true);
      expect(stops.feed).toEqual({
        sourceId: FEED.source_id,
        label: FEED.feed_label,
        validFrom: FEED.feed_start,
        validTo: FEED.feed_end,
        attribution: FEED.attribution,
      });
      expect(stops.citations).toEqual([{ ref: 'gtfs.stops', sourceId: FEED.source_id, attribution: PROVENANCE }]);
      expect(stops.degraded).toEqual([]);
      expect(list.headers.get('cache-control')).toContain('s-maxage=86400');

      const search = await getJson(app, `/api/stops?query=${encodeURIComponent('stop B')}`);
      expect(search.status).toBe(200);
      expect(StopsResponseSchema.parse(search.body).stops.map((option) => option.id)).toEqual([STOPS.scheduled.id]);
      expect(search.headers.get('cache-control')).toBe('private, no-store');

      // One shared read of the whole list (limit 2000); the rider's text stays on the server.
      expect(agent.calls('/v1/stops')).toEqual([{ method: 'GET', path: '/v1/stops', query: { limit: '2000' } }]);
    });

    test('scheduled trip: explicit stop ids at their own coordinates, on one feed', async () => {
      const stopReads = agent.calls('/v1/stops').length;
      const trip = await postTrip(app, tripRequest(STOPS.origin, STOPS.scheduled, hhmm));
      const best = expected.transit!;

      expect(trip.comparison?.transit).toEqual({
        basis: 'scheduled',
        minutes: 23,
        nextDepartures: [best, ...expected.alternatives].map((entry) => hhmmOf(entry.departure)),
        source: { name: `${PROVENANCE} GTFS schedule (feed ${FEED.feed_label})`, retrieved: FEED.loaded_at },
        routing: 'direct_only',
        leaveBy: hhmmOf(best.leave_by!),
        routeShortName: ROUTE_SHORT_NAME,
        // Alert text is data: markup and braces stripped, a non-http link dropped.
        alerts: [{ header: 'SYNTHETIC test notice: not a real CARTA alert', description: 'Synthetic detour text slot' }],
        leaveByAt: best.leave_by,
        departureAt: best.departure,
        arrivalAt: best.arrival,
        serviceDate: best.service_date,
        targetAt: expected.target,
      });
      expect(trip.travelTime).toBe(23);
      expect(trip.additionalRides).toEqual(
        expected.alternatives.map((alternative) => ({
          departureTime: hhmmOf(alternative.departure),
          arrivalTime: hhmmOf(alternative.arrival),
          travelTime: 23,
          routeShortName: ROUTE_SHORT_NAME,
          departureAt: alternative.departure,
          arrivalAt: alternative.arrival,
          serviceDate: alternative.service_date,
        })),
      );
      // Cited: the schedule's feed, the approved access-buffer fact (by id), and the alert source.
      expect(trip.meta?.sources).toEqual([
        { ref: 'gtfs.schedule', sourceId: FEED.source_id, attribution: PROVENANCE },
        { ref: 'transit.access_buffer_min', factId: COMPARE_CITATIONS[1].fact_id },
        { ref: 'gtfs_rt.alerts', sourceId: ALERT_CITATION.source_id, attribution: PROVENANCE },
      ]);
      expect(trip.meta?.citations).toEqual(['gtfs.schedule', 'transit.access_buffer_min', 'gtfs_rt.alerts']);
      expect(degradedOf(trip)).toEqual(['co2_transit_distance_unavailable', 'cost_unavailable', 'traffic_not_configured']);
      expect(trip.nudgeMessage).toContain(`about 23 min on route ${ROUTE_SHORT_NAME}`);

      expect(agent.calls('/v1/compare')).toEqual([
        {
          method: 'GET',
          path: '/v1/compare',
          query: { origin_stop_id: STOPS.origin.id, dest_stop_id: STOPS.scheduled.id, date, arrive_by: hhmm },
        },
      ]);
      expect(agent.calls('/v1/stops/nearest')).toEqual([]);
      // Both ends share one read of the stop list (none at all if this bundle's daily copy is already warm), and a
      // second trip reads it no more.
      expect(agent.calls('/v1/stops').length - stopReads).toBeLessThanOrEqual(1);
      const afterFirstTrip = agent.calls('/v1/stops').length;
      await postTrip(app, tripRequest(STOPS.origin, STOPS.scheduled, hhmm));
      expect(agent.calls('/v1/stops')).toHaveLength(afterFirstTrip);
      expect(agent.calls('/v1/alerts', { route_id: ROUTE_ID }).length).toBeGreaterThanOrEqual(1);
      expect(agent.calls('/v1/alerts').every((call) => call.query.route_id === ROUTE_ID)).toBe(true);
    });

    test('lat/lng only: each point maps to its nearest stop', async () => {
      const compares = agent.calls('/v1/compare', { dest_stop_id: STOPS.scheduled.id }).length;
      const trip = await postTrip(app, tripRequest({ ...STOPS.origin, lat: STOPS.origin.lat + 0.0001 }, STOPS.scheduled, hhmm, 'none'));
      expect(trip.comparison?.transit.basis).toBe('scheduled');
      expect(trip.travelTime).toBe(23);
      const nearest = agent.calls('/v1/stops/nearest');
      expect(nearest).toHaveLength(2);
      expect(nearest.every((call) => call.query.limit === '1')).toBe(true);
      expect(agent.calls('/v1/compare', { origin_stop_id: STOPS.origin.id, dest_stop_id: STOPS.scheduled.id })).toHaveLength(compares + 1);
    });

    test('a reason from the schedule: shown as the reason, no minutes, no phantom alternatives', async () => {
      const trip = await postTrip(app, tripRequest(STOPS.origin, STOPS.noBoardableTrip, hhmm));
      expectNoTrip(trip);
      expect(trip.comparison?.transit.reason).toBe('no_boardable_trip');
      expect(trip.comparison?.transit.routing).toBe('direct_only');
      expect(trip.comparison?.transit.targetAt).toBe(expected.target);
      expect(trip.meta?.citations).toEqual(['gtfs.schedule', 'transit.access_buffer_min']);
      expect(degradedOf(trip)).toEqual(['co2_transit_distance_unavailable', 'cost_unavailable', 'traffic_not_configured']);
    });

    test('no trip and no reason: unavailable, flagged', async () => {
      const trip = await postTrip(app, tripRequest(STOPS.origin, STOPS.noTripNoReason, hhmm));
      expectNoTrip(trip);
      expect(trip.comparison?.transit.reason).toBeUndefined();
      expect(trip.meta?.degraded).toContain('transit_schedule_unavailable');
    });

    test.each([
      ['malformed', STOPS.malformed, 'data_agent_unavailable', 'malformed'],
      ['503', STOPS.unavailable, 'transit_schedule_unavailable', 'unavailable'],
      ['never-answering', STOPS.timeout, 'data_agent_unavailable', 'timeout'],
    ] as const)('a %s schedule answer degrades the trip, never invents one', async (_name, destination, code, reason) => {
      const started = Date.now();
      const trip = await postTrip(app, tripRequest(STOPS.origin, destination, hhmm));
      expectNoTrip(trip);
      expect(trip.meta?.degraded).toContain(code);
      expect(trip.meta?.sources).toBeUndefined();
      expect(agent.calls('/v1/compare', { dest_stop_id: destination.id })).toHaveLength(1);
      expect(upstreamFailures(app)).toContainEqual(expect.objectContaining({ endpoint: '/v1/compare', reason }));
      if (reason === 'timeout') expect(Date.now() - started).toBeLessThan(10_000); // the app's 3 s deadline fired
    });

    test('feed identity: an answer from another feed version is not used (one bounded re-read)', async () => {
      const stopReads = agent.calls('/v1/stops').length;
      const trip = await postTrip(app, tripRequest(STOPS.origin, STOPS.feedChanged, hhmm));
      expectNoTrip(trip);
      expect(trip.meta?.degraded).toContain('stop_mapping_feed_changed');
      expect(agent.calls('/v1/stops')).toHaveLength(stopReads + 1);
      expect(agent.calls('/v1/compare', { dest_stop_id: STOPS.feedChanged.id })).toHaveLength(1);
    });

    test('a stop id is never trusted away from its point, and an unknown id is never looked up', async () => {
      const compares = agent.calls('/v1/compare').length;
      const elsewhere = await postTrip(app, {
        ...tripRequest(STOPS.origin, STOPS.scheduled, hhmm),
        departure: point(STOPS.noBoardableTrip),
      });
      expectNoTrip(elsewhere);
      expect(elsewhere.meta?.degraded).toContain('stop_mapping_mismatch');

      const unknown = await postTrip(app, tripRequest(STOPS.origin, STOPS.scheduled, hhmm, { departureStopId: 'SYN-IT-NOPE' }));
      expectNoTrip(unknown);
      expect(unknown.comparison?.transit.reason).toBe('unknown_stop');
      expect(unknown.meta?.degraded).toContain('stop_mapping_unknown_stop');
      expect(agent.calls('/v1/compare')).toHaveLength(compares);
    });

    test('/api/stats and /dashboard: only the cited stat, from bounded shared reads; no old figures', async () => {
      const stats = await getJson(app, '/api/stats');
      expect(stats.status).toBe(200);
      expect(StatsResponseSchema.parse(stats.body)).toEqual({
        available: true,
        items: [
          {
            id: CITED_STAT.id,
            label: CITED_STAT.label,
            valueNum: 4242,
            valueText: null,
            unit: 'trips',
            period: CITED_STAT.period,
            citations: [{ ref: 'synthetic.it.ridership', sourceId: 'synthetic-it-facts', attribution: PROVENANCE, retrieved: '2026-10-01', factId: 990201 }],
          },
        ],
        degraded: [],
      });
      expect(stats.headers.get('cache-control')).toContain('s-maxage=3600');

      const page = await getPage(app, '/dashboard');
      expect(page.text).toContain('Headline figures from approved, cited sources only.');
      expect(page.text).toContain(CITED_STAT.label);
      expect(page.text).toContain('4,242 trips');
      expect(page.text).toContain('Period: 2026-09-01 to 2026-09-30');
      expect(page.text).toContain(`Sources synthetic.it.ridership: ${PROVENANCE} (retrieved 2026-10-01)`);
      expect(page.text).not.toContain('Data unavailable');
      expect(page.html).not.toContain(UNCITED_STAT.label);
      expect(page.html).not.toMatch(/1,?313/);
      for (const figure of OLD_UNCITED_FIGURES) expect(page.html).not.toMatch(figure);

      // The hourly cache is per server bundle in a production build (this route and this page each keep one), so the
      // bound is one read per bundle per hour: a repeat request never reads again.
      await getJson(app, '/api/stats');
      const reads = agent.calls('/v1/stats').length;
      expect(reads).toBeGreaterThanOrEqual(1);
      expect(reads).toBeLessThanOrEqual(2);
      await getPage(app, '/dashboard');
      expect(agent.calls('/v1/stats')).toHaveLength(reads);
    });

    test('/safety-cost-comparison and /emissions-stats: the approved synthetic facts, each cited', async () => {
      const cost = await getPage(app, '/safety-cost-comparison');
      for (const value of ['$4.321', '23.4 mpg', '$0.1234', '$0.31', '$0.88', '$13.57', '$9.87']) expect(cost.text).toContain(value);
      expect(cost.text).toContain(`CARTA base fare: ${PROVENANCE} (retrieved 2026-10-01)`);
      expect(cost.text).toContain(`Gasoline price: ${PROVENANCE}`);
      // Only the safety section, which has no approved figures at all, says so.
      expect(cost.text.match(/Data unavailable/g)).toHaveLength(1);
      expect(cost.text).not.toContain(FALLBACK_NOTE);

      const emissions = await getPage(app, '/emissions-stats');
      for (const value of ['432 g CO2', '1.2 persons', '360 g CO2', '210 g CO2', '150 g CO2']) expect(emissions.text).toContain(value);
      expect(emissions.text).toContain(`Car CO2 per mile: ${PROVENANCE}`);
      expect(emissions.text).not.toContain('Data unavailable');
      expect(emissions.text).not.toContain(FALLBACK_NOTE);
    });

    test('upstream: contract-valid requests only, shared caches never read per request, nothing left loopback', () => {
      expect(agent.violations).toEqual([]);
      // A dozen trips and four page views: at most one assumptions read per bundle that loads them (the trip route and
      // the two fact pages), never one per request.
      expect(agent.calls('/v1/assumptions').length).toBeGreaterThanOrEqual(1);
      expect(agent.calls('/v1/assumptions').length).toBeLessThanOrEqual(3);
      expect(agent.requests.every((request) => request.method === 'GET')).toBe(true);
      expectCleanServerOutput(app);
    });
  });

  describe.each([
    ['unavailable', 'unavailable'],
    ['malformed', 'malformed'],
    ['timeout', 'timeout'],
    ['reset', 'unreachable'],
  ] as Array<[AgentMode, string]>)('data agent enabled but %s', (mode, reason) => {
    let agent: SyntheticDataAgent;
    let app: NextApp;

    beforeAll(async () => {
      agent = await startSyntheticDataAgent(mode);
      app = await startNextApp(mode, { enabled: true, baseUrl: agent.url });
    });
    afterAll(async () => {
      await app?.stop();
      await agent?.close();
    });

    test('stops: the saved CARTA stop export, cited to its feed, never fake stops', async () => {
      const stops = await getJson(app, '/api/stops');
      expect(stops.status).toBe(200);
      expectSavedStops(StopsResponseSchema.parse(stops.body));
      expect(stops.headers.get('cache-control')).toBe('public, max-age=60');
    });

    test('stats and dashboard: data unavailable, no old figures', async () => {
      await expectStatsUnavailable(app);
    });

    test('trip: degraded, with no schedule asked for and nothing invented', async () => {
      const { hhmm } = arrivalTarget();
      const trip = await postTrip(app, tripRequest(STOPS.origin, STOPS.scheduled, hhmm));
      expectNoTrip(trip);
      expect(degradedOf(trip)).toEqual(LOCAL_FALLBACK_DEGRADED);
      expect(trip.meta?.sources).toBeUndefined();
      expect(agent.calls('/v1/compare')).toEqual([]);
    });

    test('fact pages: the flagged 05 §2 fallback, labeled as such', async () => {
      await expectFactPagesOnFallback(app);
    });

    test(`each failure is classified as "${reason}"; nothing left loopback`, () => {
      const failures = upstreamFailures(app);
      expect(failures.length).toBeGreaterThan(0);
      expect(failures.every((line) => line.reason === reason)).toBe(true);
      // The app did call the agent (it is enabled); `reset` drops connections before any request is read.
      if (mode !== 'reset') expect(agent.requests.length).toBeGreaterThan(0);
      expect(agent.violations).toEqual([]);
      expectCleanServerOutput(app);
    });
  });

  describe('data agent disabled (DATA_AGENT_ENABLED=false, base URL set)', () => {
    let agent: SyntheticDataAgent;
    let app: NextApp;

    beforeAll(async () => {
      agent = await startSyntheticDataAgent('healthy');
      app = await startNextApp('disabled', { enabled: false, baseUrl: agent.url });
    });
    afterAll(async () => {
      await app?.stop();
      await agent?.close();
    });

    test('health: the pinned env holds (no LLM or traffic provider)', async () => {
      await expectHealthWithoutProviders(app);
    });

    test('stops: the saved CARTA stop export, cited to its feed', async () => {
      const stops = await getJson(app, '/api/stops');
      expect(stops.status).toBe(200);
      expectSavedStops(StopsResponseSchema.parse(stops.body));
    });

    test('trip: degraded (the P1 rollback path), never invented; a bad request is a 400', async () => {
      const { hhmm } = arrivalTarget();
      const trip = await postTrip(app, tripRequest(STOPS.origin, STOPS.scheduled, hhmm));
      expectNoTrip(trip);
      expect(degradedOf(trip)).toEqual(LOCAL_FALLBACK_DEGRADED);

      const bad = await httpRequest(app.url, '/api/transit-insights', { method: 'POST', json: { departure: { lat: 999, lng: 0 } } });
      expect(bad.status).toBe(400);
      expect(JSON.parse(bad.text)).toEqual(expect.objectContaining({ error: 'Invalid request' }));
    });

    test('stats, dashboard and fact pages: unavailable or the flagged fallback', async () => {
      await expectStatsUnavailable(app);
      await expectFactPagesOnFallback(app);
    });

    test('demo off: no demo banner, no rewards, the demo route is closed', async () => {
      const incentives = await getPage(app, '/incentives');
      expect(incentives.text).toContain('No rewards are offered right now.');
      expect(incentives.text).not.toMatch(/e-gift card|Demo data|Demo mode/);
      const home = await getPage(app, '/');
      expect(home.text).not.toMatch(/Demo data|Demo mode/);
      const demo = await httpRequest(app.url, '/api/transit-insights-demo', { method: 'POST', json: {} });
      expect(demo.status).toBe(404);
    });

    test('zero upstream calls, and nothing left loopback', () => {
      expect(agent.requests).toEqual([]);
      expect(upstreamFailures(app)).toEqual([]);
      expectCleanServerOutput(app);
    });
  });
});
