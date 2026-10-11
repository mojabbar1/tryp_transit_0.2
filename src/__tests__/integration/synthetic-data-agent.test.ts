/**
 * The synthetic data agent behind `npm run test:integration` (synthetic-data-agent.ts) must answer in the committed
 * contract's shapes, or the integration checks would prove nothing. Its bodies are checked three ways: the generated
 * OpenAPI types (at compile time, in the fixture module), the OpenAPI JSON itself (strictly, below), and the app's own
 * runtime guards in src/lib/api/data-agent.ts, over loopback HTTP. Also covers the child guard the harness preloads.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import openapi from '../../../contracts/data-agent.openapi.json';
import {
  clearDataAgentCaches,
  compareTrip,
  getAlerts,
  getAssumptions,
  getStats,
  listStops,
  nearestStops,
} from '@/lib/api/data-agent';
import { BLOCK_MARKER } from './next-app';
import {
  ALERTS,
  ASSUMPTIONS,
  type AgentMode,
  compareBody,
  compareReply,
  FACTS,
  FEED,
  MALFORMED_BODY,
  nearestPage,
  PROVENANCE,
  ROUTE_ID,
  startSyntheticDataAgent,
  STATS,
  stopPage,
  STOPS,
  type SyntheticDataAgent,
} from './synthetic-data-agent';

const guard = require('./child-guard.cjs') as { BLOCK_MARKER: string };
const GUARD_PATH = path.join(__dirname, 'child-guard.cjs');

// ---------------------------------------------------------------------------------------------------------------
// A strict reader of the OpenAPI JSON Schema subset the contract uses. Stricter than the API in one way on purpose:
// every declared property must be present, because P4a serializes every field of its models (nulls included).

type JsonSchema = {
  $ref?: string;
  anyOf?: JsonSchema[];
  type?: string;
  const?: unknown;
  enum?: unknown[];
  format?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
};

const components = (openapi as unknown as { components: { schemas: Record<string, JsonSchema> } }).components.schemas;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function check(schema: JsonSchema, value: unknown, at: string, errors: string[]): void {
  if (schema.$ref) {
    const name = schema.$ref.replace('#/components/schemas/', '');
    const target = components[name];
    if (!target) throw new Error(`unknown $ref ${schema.$ref}`);
    check(target, value, at, errors);
    return;
  }
  if (schema.anyOf) {
    const matches = schema.anyOf.some((branch) => {
      const branchErrors: string[] = [];
      check(branch, value, at, branchErrors);
      return branchErrors.length === 0;
    });
    if (!matches) errors.push(`${at}: matches no anyOf branch`);
    return;
  }
  if ('const' in schema && value !== schema.const) errors.push(`${at}: expected ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: not in enum`);
  switch (schema.type) {
    case 'null':
      if (value !== null) errors.push(`${at}: expected null`);
      return;
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${at}: expected boolean`);
      return;
    case 'integer':
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value))) {
        errors.push(`${at}: expected ${schema.type}`);
      } else if ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum)) {
        errors.push(`${at}: out of range`);
      }
      return;
    case 'string':
      if (typeof value !== 'string') {
        errors.push(`${at}: expected string`);
        return;
      }
      if (schema.format === 'date' && !(DATE.test(value) && Number.isFinite(Date.parse(value)))) errors.push(`${at}: expected a date`);
      if (schema.format === 'date-time' && !(DATE_TIME.test(value) && Number.isFinite(Date.parse(value)))) errors.push(`${at}: expected a date-time`);
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${at}: pattern`);
      if ((schema.minLength !== undefined && value.length < schema.minLength) || (schema.maxLength !== undefined && value.length > schema.maxLength)) {
        errors.push(`${at}: length`);
      }
      return;
    case 'array':
      if (!Array.isArray(value)) {
        errors.push(`${at}: expected array`);
        return;
      }
      value.forEach((item, index) => schema.items && check(schema.items, item, `${at}[${index}]`, errors));
      return;
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        errors.push(`${at}: expected object`);
        return;
      }
      const record = value as Record<string, unknown>;
      const properties = schema.properties ?? {};
      for (const name of Object.keys(properties)) {
        if (!(name in record)) errors.push(`${at}.${name}: missing`);
      }
      for (const [name, item] of Object.entries(record)) {
        if (properties[name]) check(properties[name], item, `${at}.${name}`, errors);
        else if (typeof schema.additionalProperties === 'object') check(schema.additionalProperties, item, `${at}.${name}`, errors);
        else if (schema.additionalProperties !== true) errors.push(`${at}.${name}: not in the contract`);
      }
      return;
    }
    default:
      if (schema.type !== undefined) throw new Error(`unhandled schema type ${schema.type}`);
  }
}

function contractErrors(path200: string, body: unknown): string[] {
  const operation = (openapi as unknown as { paths: Record<string, { get: { responses: Record<string, { content: Record<string, { schema: JsonSchema }> }> } }> })
    .paths[path200].get;
  const errors: string[] = [];
  check(operation.responses['200'].content['application/json'].schema, body, '$', errors);
  return errors;
}

// ---------------------------------------------------------------------------------------------------------------

describe('synthetic data agent fixtures: the committed OpenAPI contract', () => {
  const date = '2030-10-03';
  const samples: Array<[string, string, unknown]> = [
    ['stop list', '/v1/stops', stopPage(null, 2000)],
    ['stop search', '/v1/stops', stopPage('stop B', 10)],
    ['nearest stops', '/v1/stops/nearest', nearestPage(STOPS.origin.lat, STOPS.origin.lng, 1)],
    ['scheduled trip', '/v1/compare', compareBody(date, '08:30', 'scheduled')],
    ['no boardable trip', '/v1/compare', compareBody(date, '08:30', 'no_boardable_trip')],
    ['no trip, no reason', '/v1/compare', compareBody(date, '08:30', 'no_trip_no_reason')],
    ['another feed version', '/v1/compare', compareBody(date, '08:30', 'other_feed')],
    ['assumptions', '/v1/assumptions', ASSUMPTIONS],
    ['stats', '/v1/stats', STATS],
    ['alerts', '/v1/alerts', ALERTS],
  ];

  test.each(samples)('%s matches %s 200 exactly', (_name, route, body) => {
    expect(contractErrors(route, body)).toEqual([]);
  });

  test('the checker is not vacuous: malformed bodies are rejected', () => {
    expect(contractErrors('/v1/stops', MALFORMED_BODY).length).toBeGreaterThan(0);
    const malformed = compareReply(STOPS.malformed.id, date, '08:30');
    expect(malformed).not.toBe('hold');
    expect(contractErrors('/v1/compare', (malformed as { body: unknown }).body)).toContain('$.transit: matches no anyOf branch');
    expect(contractErrors('/v1/stats', { items: [], extra: 1 })).toEqual(['$.extra: not in the contract']);
    const noFeed: Record<string, unknown> = { ...stopPage(null, 1) };
    delete noFeed.feed;
    expect(contractErrors('/v1/stops', noFeed)).toEqual(['$.feed: missing']);
  });

  test('trips are internally consistent, arrive by the target, and carry local times with offsets as P4a prints them', () => {
    const body = compareBody(date, '08:30');
    const target = Date.parse(body.target);
    for (const trip of [body.transit!, ...body.alternatives]) {
      expect(Date.parse(trip.arrival) - Date.parse(trip.departure)).toBe(trip.in_vehicle_min * 60_000);
      expect(Date.parse(trip.departure) - Date.parse(trip.leave_by!)).toBe(body.access_buffer_min * 60_000);
      expect(Date.parse(trip.arrival)).toBeLessThanOrEqual(target);
      expect(trip.departure).toMatch(/^2030-10-03T\d{2}:\d{2}:00-04:00$/); // local time with its offset, as P4a prints
    }
    expect(body.target).toBe('2030-10-03T08:30:00-04:00');
    expect(compareBody('2030-12-03', '08:30').target).toBe('2030-12-03T08:30:00-05:00');
  });

  test('everything is labeled synthetic', () => {
    expect(PROVENANCE).toMatch(/^SYNTHETIC .*not CARTA data, not a human approval/);
    expect(FEED.source_id).toMatch(/^synthetic-/);
    expect(FEED.attribution).toBe(PROVENANCE);
    for (const stop of Object.values(STOPS)) {
      expect(stop.id).toMatch(/^SYN-IT-/);
      expect(stop.name).toMatch(/^Synthetic .*not a CARTA stop/);
    }
    for (const fact of FACTS) {
      expect(fact.id).toBeGreaterThanOrEqual(990_000);
      expect(fact.method).toBe(PROVENANCE);
      expect(fact.sources.every((source) => source.attribution === PROVENANCE)).toBe(true);
    }
    expect(STATS.items.every((stat) => stat.label.startsWith('SYNTHETIC'))).toBe(true);
    expect(ALERTS.items.every((alert) => alert.header_text?.startsWith('SYNTHETIC'))).toBe(true);
  });
});

describe('synthetic data agent over loopback HTTP: the app client accepts exactly what it should', () => {
  let agent: SyntheticDataAgent | undefined;
  const envFor = (target: SyntheticDataAgent) => ({ dataAgentEnabled: true, dataAgentBaseUrl: target.url });
  const start = async (mode: AgentMode) => {
    agent = await startSyntheticDataAgent(mode);
    return agent;
  };

  beforeEach(() => {
    clearDataAgentCaches();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await agent?.close();
    agent = undefined;
  });

  test('healthy: every endpoint passes the runtime guards, and the served bytes match the contract', async () => {
    const target = await start('healthy');
    const env = envFor(target);
    const stops = await listStops(env);
    expect(stops.ok && stops.data.items.map((stop) => stop.id)).toEqual(Object.values(STOPS).map((stop) => stop.id));
    const nearest = await nearestStops(env, STOPS.scheduled, 1);
    expect(nearest.ok && nearest.data.items[0]).toEqual(expect.objectContaining({ id: STOPS.scheduled.id, distance_m: 0 }));

    const ask = (dest: string) => compareTrip(env, { originStopId: STOPS.origin.id, destStopId: dest, date: '2030-10-03', arriveBy: '08:30' });
    const scheduled = await ask(STOPS.scheduled.id);
    expect(scheduled.ok && scheduled.data.transit?.basis).toBe('scheduled');
    const reason = await ask(STOPS.noBoardableTrip.id);
    expect(reason.ok && reason.data.reason).toBe('no_boardable_trip');
    expect(await ask(STOPS.malformed.id)).toEqual({ ok: false, reason: 'malformed', status: 200 });
    expect(await ask(STOPS.unavailable.id)).toEqual({ ok: false, reason: 'unavailable', status: 503 });

    const assumptions = await getAssumptions(env);
    expect(assumptions.ok && assumptions.data.items.map((item) => item.key)).toEqual(FACTS.map((fact) => fact.key));
    expect((await getStats(env)).ok).toBe(true);
    expect((await getAlerts(env, ROUTE_ID)).ok).toBe(true);

    for (const [route, query] of [
      ['/v1/stops', '?limit=2000'],
      ['/v1/stops/nearest', `?lat=${STOPS.origin.lat}&lng=${STOPS.origin.lng}&limit=1`],
      ['/v1/compare', `?origin_stop_id=${STOPS.origin.id}&dest_stop_id=${STOPS.scheduled.id}&date=2030-10-03&arrive_by=08:30`],
      ['/v1/assumptions', ''],
      ['/v1/stats', ''],
      ['/v1/alerts', `?route_id=${ROUTE_ID}`],
    ]) {
      const response = await fetch(`${target.url}${route}${query}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('x-fixture-provenance')).toBe(PROVENANCE);
      expect(contractErrors(route, await response.json())).toEqual([]);
    }
    expect(target.violations).toEqual([]);
  });

  test.each([
    ['unavailable', { ok: false, reason: 'unavailable', status: 503 }],
    ['malformed', { ok: false, reason: 'malformed', status: 200 }],
    ['reset', { ok: false, reason: 'unreachable' }],
  ] as const)('%s mode fails every call the way the app classifies it', async (mode, expected) => {
    const target = await start(mode);
    expect(await listStops(envFor(target))).toEqual(expected);
    expect(await getStats(envFor(target))).toEqual(expected);
  });

  test('requests outside the contract are recorded as violations', async () => {
    const target = await start('healthy');
    expect((await fetch(`${target.url}/v1/unknown`)).status).toBe(404);
    expect((await fetch(`${target.url}/v1/stats?extra=1`)).status).toBe(422);
    expect((await fetch(`${target.url}/v1/compare?origin_stop_id=${STOPS.origin.id}&dest_stop_id=X&date=2030-10-03&depart_at=08:30`)).status).toBe(422);
    expect((await fetch(`${target.url}/v1/stats`, { method: 'POST' })).status).toBe(405);
    expect(target.violations).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------------------------------------------

/** A minimal env with the guard preloaded (typed loosely: NODE_ENV is deliberately absent). */
const guardedEnv = (extra: Record<string, string>) =>
  ({ PATH: process.env.PATH ?? '', NODE_OPTIONS: `--require ${JSON.stringify(GUARD_PATH)}`, ...extra }) as unknown as NodeJS.ProcessEnv;

function runNode(script: string, env: Record<string, string>): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script], {
      env: guardedEnv(env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

describe('integration child guard', () => {
  test('shares its block marker with the harness', () => {
    expect(guard.BLOCK_MARKER).toBe(BLOCK_MARKER);
  });

  test('blocks a non-loopback connection before it leaves, and allows loopback', async () => {
    const server = http.createServer((_req, res) => res.end('loopback-ok'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      // 192.0.2.1 is TEST-NET-1 (RFC 5737): never routed, so even an unguarded attempt reaches nobody.
      const script = `
        fetch('http://192.0.2.1/').then(() => console.log('remote-reached'), (error) => console.log('remote-' + (error.cause && error.cause.code)))
          .then(() => fetch('http://127.0.0.1:${port}/')).then((response) => response.text()).then((text) => console.log(text));`;
      const result = await runNode(script, { INTEGRATION_BLOCK_NETWORK: '1' });
      expect(result.stdout).toContain('remote-ECONNREFUSED');
      expect(result.stdout).toContain('loopback-ok');
      expect(result.stderr).toContain(`${BLOCK_MARKER} 192.0.2.1`);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('a child of the harness exits on its own when the harness pipe closes', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      env: guardedEnv({ INTEGRATION_PARENT_PID: String(process.pid) }),
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    const exited = new Promise<NodeJS.Signals | number | null>((resolve) => child.on('exit', (code, signal) => resolve(signal ?? code)));
    const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
    child.stdin.end(); // what the OS does when the harness dies, however it dies
    expect(await exited).toBe('SIGTERM');
    clearTimeout(timer);
  });
});
